package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.Proc;
import ai.oya.keel.State;
import ai.oya.keel.testing.TestRunner;
import jakarta.annotation.PreDestroy;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Spark UI for a finished run, without asking AWS for anything: a Spark history server in the
 * Glue container, pointed at the job's event-log prefix in S3, served on localhost. Needs the job to
 * have run with `--enable-spark-ui` and a `--spark-event-logs-path`; the endpoint says so when it did not.
 */
@RestController
public class SparkUi {
    static final int PORT = 18080;
    static final String NAME = "keel-sparkui";

    private final GlueService glue;
    private final AwsClients aws;
    private final State state;
    private final ai.oya.keel.engine.Engine engine;
    private volatile String servingRun;

    public SparkUi(GlueService glue, AwsClients aws, State state, ai.oya.keel.engine.Engine engine) {
        this.glue = glue; this.aws = aws; this.state = state; this.engine = engine;
    }

    /**
     * The same history server, pointed at the local engine's event logs instead of S3. A local run
     * gets the Spark UI that a cloud run charges an interactive session for.
     */
    @PostMapping("/api/engine/sparkui")
    public Map<String, Object> local() {
        Path dir = engine.eventsDir();
        if (!java.nio.file.Files.isDirectory(dir) || isEmpty(dir))
            throw new ApiError(400, "no local Spark event logs yet", "run the job locally once, then open this again");
        return serve(dir, "Serving the local engine's event logs.", "local");
    }

    /**
     * Spark's own history server, in the Glue image, reading a directory on this machine.
     *
     * It answers only once the server is actually serving: the history server takes about twenty
     * seconds to bind and parse, and it exits outright on a bad configuration, so reporting success
     * and opening a browser on a timer produced exactly the failure this replaces — a page that
     * never loads and a container that is already gone.
     */
    private Map<String, Object> serve(Path dir, String note, String forRun) {
        stop();
        Proc.Result r = Proc.run(null, 60, null, "docker", "run", "-d", "--name", NAME,
                "-p", PORT + ":18080", "-v", dir.toAbsolutePath() + ":/logs:ro",
                "-e", "SPARK_HISTORY_OPTS=-Dspark.history.fs.logDirectory=file:///logs -Dspark.history.ui.port=18080",
                TestRunner.IMAGE, "-c", "$SPARK_HOME/bin/spark-class org.apache.spark.deploy.history.HistoryServer");
        if (!r.ok()) throw new ApiError(500, "could not start the history server: " + r.stderr().strip(), "is Docker running?");
        awaitReady();
        servingRun = forRun;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("url", "http://127.0.0.1:" + PORT);
        m.put("logs", dir.toString());
        m.put("ready", true);
        m.put("note", note);
        return m;
    }

    private static boolean isEmpty(Path dir) {
        try (var s = java.nio.file.Files.list(dir)) { return s.findAny().isEmpty(); }
        catch (java.io.IOException e) { return true; }
    }

    @GetMapping("/api/glue/sparkui")
    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        boolean up = Proc.run(null, 10, null, "docker", "ps", "--filter", "name=" + NAME, "--format", "{{.Names}}").stdout().contains(NAME);
        m.put("running", up);
        m.put("url", up ? "http://127.0.0.1:" + PORT : null);
        m.put("run", servingRun);
        return m;
    }

    @PostMapping("/api/glue/jobs/{name}/runs/{id}/sparkui")
    public Map<String, Object> start(@PathVariable String name, @PathVariable String id) {
        // Both reach a filesystem path below, so they are checked against the shapes AWS itself
        // uses before anything is resolved with them.
        if (!name.matches("[A-Za-z0-9._-]{1,255}")) throw ApiError.badRequest("that is not a job name");
        if (!id.matches("jr_[0-9a-f]{16,128}")) throw ApiError.badRequest("that is not a Glue run id");
        RunInfo run = glue.run(name, id);
        var job = glue.getJobJson(name);
        String base = run.arguments() == null ? null : run.arguments().get("--spark-event-logs-path");
        boolean fromJob = base == null || base.isBlank();
        if (fromJob) base = job.path("DefaultArguments").path("--spark-event-logs-path").asText(null);
        boolean onNow = "true".equals(job.path("DefaultArguments").path("--enable-spark-ui").asText(null))
                || (run.arguments() != null && "true".equals(run.arguments().get("--enable-spark-ui")));
        if (base == null || base.isBlank())
            throw new ApiError(400, "this job has no Spark UI logs path",
                    "turn on \"Spark UI (event logs)\" on the Job details tab — the button in this pane sets both — then run it again");
        String dir = base.endsWith("/") ? base : base + "/";

        // Two shapes exist in the wild: Glue 5 writes one event-log object per run, named after the
        // run id, directly under the configured path; older versions wrote a directory per run.
        List<String> keys = new ArrayList<>(list(dir + id + "/"));
        boolean nested = !keys.isEmpty();
        if (!nested) for (String k : list(dir)) if (k.endsWith("/" + id) || k.endsWith("/" + id + ".inprogress")) keys.add(k);
        // Spark writes `<log>.inprogress` while the run is live and renames it at the end. Both can
        // survive; fetching both would land the unfinished one on top and the UI would show a run
        // that never completed.
        keys.removeIf(k -> k.endsWith(".inprogress") && keys.contains(k.substring(0, k.length() - ".inprogress".length())));

        // The job's arguments describe the job *now*, not this run. A flag turned on after a run
        // finished cannot make that run have written anything, and pointing a history server at an
        // empty prefix produces a container that exits and a browser tab that never loads.
        if (keys.isEmpty())
            throw new ApiError(400, "this run wrote no Spark event logs",
                    (onNow && fromJob
                            ? "Spark UI is on for the job now, but it was off when this run started. Run it again and open the Spark UI for the new run."
                            : "turn on \"Spark UI (event logs)\" with a logs path, then run it again.")
                            + " A local run gives you a Spark UI straight away, with no S3 at all.");

        // The event logs are fetched here rather than read by the history server. The Glue image
        // ships no S3A filesystem, so `s3a://` inside the container dies with a ClassNotFound before
        // it binds a port — and fetching them means the server starts the same way for a cloud run
        // as for a local one, with the daemon's own credentials (SSO included).
        Path holder = state.keelDir().resolve("spark-events-cloud");
        Path local = holder.resolve(id).normalize();
        if (!local.startsWith(holder.normalize())) throw ApiError.badRequest("that is not a Glue run id");
        long bytes = fetch(dir, keys, local);
        return serve(local, "Serving " + keys.size() + " event log" + (keys.size() > 1 ? "s" : "")
                + " (" + (bytes / 1024) + " KB) fetched from " + dir + ".", id);
    }

    /** Object keys under an s3:// prefix. Empty when the prefix holds nothing or cannot be listed. */
    private List<String> list(String s3uri) {
        String rest = s3uri.replaceFirst("^s3a?://", "");
        int slash = rest.indexOf('/');
        if (slash < 0) return List.of();
        String bucket = rest.substring(0, slash), prefix = rest.substring(slash + 1);
        try {
            return aws.s3().listObjectsV2(b -> b.bucket(bucket).prefix(prefix).maxKeys(200)).contents()
                    .stream().filter(o -> o.size() > 0).map(software.amazon.awssdk.services.s3.model.S3Object::key).toList();
        } catch (RuntimeException e) {
            throw new ApiError(502, "cannot list " + s3uri + ": " + short_(e),
                    "the profile needs s3:ListBucket and s3:GetObject on the Spark UI logs path");
        }
    }

    /** Copies the run's event logs next to the project. Returns the bytes written. */
    private long fetch(String dir, List<String> keys, Path into) {
        String bucket = dir.replaceFirst("^s3a?://", "");
        bucket = bucket.substring(0, bucket.indexOf('/'));
        long total = 0;
        try {
            java.nio.file.Files.createDirectories(into);
            for (String key : keys) {
                String b = bucket;
                Path f = into.resolve(key.substring(key.lastIndexOf('/') + 1).replace(".inprogress", "")).normalize();
                if (!f.startsWith(into)) continue; // an object key is not allowed to name where it lands
                try (var in = aws.s3().getObject(x -> x.bucket(b).key(key))) {
                    total += java.nio.file.Files.copy(in, f, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
            }
        } catch (java.io.IOException | RuntimeException e) {
            throw new ApiError(502, "could not fetch the event logs: " + short_(e), null);
        }
        return total;
    }

    /** The first line of an AWS exception: the rest is a stack the person cannot act on. */
    private static String short_(Exception e) {
        String m = e.getMessage() == null ? e.toString() : e.getMessage();
        return m.length() > 200 ? m.substring(0, 200) + "…" : m;
    }

    /**
     * Waits for the server to answer before saying it is up.
     *
     * The history server takes about twenty seconds to bind and parse a log, and it exits outright
     * on a bad configuration. Reporting success and opening a browser on a timer produced exactly
     * the failure this replaces: a page that never loads and a container that is already gone.
     */
    private void awaitReady() {
        long until = System.currentTimeMillis() + 90_000;
        while (System.currentTimeMillis() < until) {
            if (!Proc.run(null, 10, null, "docker", "ps", "--filter", "name=" + NAME, "--format", "{{.Names}}").stdout().contains(NAME)) {
                String why = Proc.run(null, 20, null, "docker", "logs", "--tail", "12", NAME).stdout()
                        + Proc.run(null, 20, null, "docker", "logs", "--tail", "12", NAME).stderr();
                Proc.run(null, 20, null, "docker", "rm", "-f", NAME);
                throw new ApiError(502, "the history server stopped as it started", why.isBlank() ? null : why.strip());
            }
            if (Proc.run(null, 10, null, "curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:" + PORT).ok()) return;
            try { Thread.sleep(1000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return; }
        }
        throw new ApiError(504, "the history server did not come up in 90 seconds",
                "its container is still running; try opening " + "http://127.0.0.1:" + PORT + " yourself");
    }

    @PostMapping("/api/glue/sparkui/stop")
    @PreDestroy
    public Map<String, Object> stop() {
        Proc.run(null, 30, null, "docker", "rm", "-f", NAME);
        servingRun = null;
        return Map.of("stopped", true);
    }
}
