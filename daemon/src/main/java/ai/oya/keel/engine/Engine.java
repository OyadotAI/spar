package ai.oya.keel.engine;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import ai.oya.keel.Proc;
import ai.oya.keel.State;
import ai.oya.keel.testing.TestRunner;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * One warm container per project: the Glue 5 image, holding a live SparkSession and GlueContext,
 * running a script we POST to it.
 *
 * Spark costs about 6 s to start and another 4 s to reach its first action, which is most of what
 * a "10 second" preview actually is. Held open, the same preview is about a second — the
 * difference between a tool you query and a tool you wait on. It idles out after ten minutes
 * because a Spark JVM is not something to leave running on a laptop by accident.
 */
@RestController
public class Engine {
    private static final Logger log = LoggerFactory.getLogger(Engine.class);
    public static final String IMAGE = TestRunner.IMAGE;
    private static final Duration IDLE = Duration.ofMinutes(10);

    private final State state;
    private final Events events;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    private volatile String container;
    private volatile int port;
    private volatile long lastUse;
    private volatile String starting;

    public Engine(State state, Events events, ObjectMapper json) { this.state = state; this.events = events; this.json = json; }

    public boolean up() { return container != null && port > 0; }

    @GetMapping("/api/engine")
    public Map<String, Object> get() { return status(); }

    /** Warming it up is worth doing before the first preview, so the app offers a button for it. */
    @PostMapping("/api/engine/start")
    public Map<String, Object> start() { ensure(); return status(); }

    @PostMapping("/api/engine/stop")
    public Map<String, Object> stopNow() { stop("you stopped it"); return status(); }

    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("up", up());
        m.put("starting", starting);
        m.put("container", container);
        m.put("port", port);
        m.put("idleSeconds", up() ? (System.currentTimeMillis() - lastUse) / 1000 : 0);
        m.put("idleStopSeconds", IDLE.toSeconds());
        return m;
    }

    /**
     * Runs a script in the engine and returns what it printed. Starts the engine if it is down;
     * the caller falls back to a one-shot `docker run` if this throws, so nothing that works
     * today depends on the engine being available.
     */
    public String exec(Path cwd, String script, Duration timeout) {
        ensure();
        lastUse = System.currentTimeMillis();
        Map<String, Object> body = Map.of("cwd", inContainer(cwd), "script", script);
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/run"))
                    .timeout(timeout)
                    .header("content-type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body), StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode n = json.readTree(res.body());
            if (n.hasNonNull("error")) throw new ApiError(500, "the engine could not run that", n.get("error").asText());
            lastUse = System.currentTimeMillis();
            return n.path("stdout").asText("");
        } catch (IOException e) {
            stop("the engine stopped answering");
            throw new ApiError(503, "the engine stopped answering: " + e.getMessage(), "it has been restarted; try again");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiError(500, "interrupted");
        }
    }

    /** The project root is mounted at /home/hadoop/workspace, so a host path becomes a container path. */
    private String inContainer(Path cwd) {
        Path root = state.project().toAbsolutePath().normalize();
        Path abs = cwd.toAbsolutePath().normalize();
        return abs.startsWith(root) ? "/home/hadoop/workspace/" + root.relativize(abs) : "/home/hadoop/workspace";
    }

    public synchronized void ensure() {
        if (up() && alive()) return;
        container = null; port = 0;
        Path root = state.project().toAbsolutePath().normalize();
        Path engineDir = root.resolve(".spar").resolve("engine");
        writeResources(engineDir);
        if (!Proc.run(null, 10, null, "docker", "info").ok())
            throw new ApiError(503, "Docker is not running", "start Docker Desktop; the local engine runs in " + IMAGE);
        if (!Proc.run(null, 20, null, "docker", "image", "inspect", IMAGE).ok()) {
            starting = "pulling " + IMAGE + " (about 7 GB, once)";
            events.emit("engine", Map.of("state", "pulling"));
            Proc.Result pull = Proc.run(null, 3600, null, "docker", "pull", IMAGE);
            starting = null;
            if (!pull.ok()) throw new ApiError(503, "could not pull " + IMAGE, pull.stderr().strip());
        }
        String name = "spar-engine-" + Integer.toHexString(root.toString().hashCode());
        Proc.run(null, 30, null, "docker", "rm", "-f", name); // a survivor from a previous daemon
        // The image already sets spark.eventLog.enabled with a log dir inside the container; mounting
        // that dir out is what gives a local run a real Spark UI, with no S3 and no --enable-spark-ui.
        Path eventLogs = eventsDir();
        try { Files.createDirectories(eventLogs); } catch (IOException e) { throw new ApiError(500, "cannot create " + eventLogs); }
        List<String> cmd = new ArrayList<>(List.of("docker", "run", "-d", "--rm", "--name", name,
                "-p", "127.0.0.1:0:8088",
                "-v", root + ":/home/hadoop/workspace",
                "-v", eventLogs + ":/var/log/spark/apps",
                "-w", "/home/hadoop/workspace"));
        Path aws = Path.of(System.getProperty("user.home"), ".aws");
        if (Files.isDirectory(aws)) { cmd.add("-v"); cmd.add(aws + ":/home/hadoop/.aws:ro"); }
        if (state.profile() != null) { cmd.add("-e"); cmd.add("AWS_PROFILE=" + state.profile()); }
        if (state.region() != null) { cmd.add("-e"); cmd.add("AWS_REGION=" + state.region()); }
        cmd.add(IMAGE); cmd.add("-c"); cmd.add("python3 .spar/engine/driver.py");
        starting = "starting the local engine";
        events.emit("engine", Map.of("state", "starting"));
        Proc.Result run = Proc.run(root, 120, null, cmd.toArray(String[]::new));
        starting = null;
        if (!run.ok()) throw new ApiError(503, "could not start the local engine", run.stderr().strip());
        int p = hostPort(name);
        if (p <= 0) { Proc.run(null, 20, null, "docker", "rm", "-f", name); throw new ApiError(503, "the local engine did not publish a port"); }
        if (!waitReady(p)) {
            String why = Proc.run(null, 20, null, "docker", "logs", "--tail", "20", name).stdout();
            Proc.run(null, 20, null, "docker", "rm", "-f", name);
            throw new ApiError(503, "the local engine did not come up", why.isBlank() ? null : why.strip());
        }
        container = name; port = p; lastUse = System.currentTimeMillis();
        log.info("engine {} up on 127.0.0.1:{}", name, p);
        events.emit("engine", Map.of("state", "up", "port", p));
    }

    private static int hostPort(String name) {
        String out = Proc.run(null, 20, null, "docker", "port", name, "8088").stdout(); // e.g. 127.0.0.1:53422
        int i = out.lastIndexOf(':');
        try { return i < 0 ? 0 : Integer.parseInt(out.substring(i + 1).strip().split("\\s")[0]); }
        catch (NumberFormatException e) { return 0; }
    }

    private boolean waitReady(int p) {
        long until = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < until) {
            try {
                HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + p + "/"))
                        .timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofString());
                if (r.statusCode() == 200) return true;
            } catch (IOException ignored) {
                // not listening yet
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); return false; }
            try { Thread.sleep(300); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return false; }
        }
        return false;
    }

    private boolean alive() {
        String c = container;
        return c != null && Proc.run(null, 15, null, "docker", "inspect", "-f", "{{.State.Running}}", c).stdout().strip().equals("true");
    }

    /** The driver and the source shim ship with the daemon; the project only ever holds a copy. */
    private void writeResources(Path dir) {
        try {
            Files.createDirectories(dir);
            for (String f : List.of("driver.py", "keel_local.py")) {
                try (InputStream in = Engine.class.getResourceAsStream("/engine/" + f)) {
                    if (in == null) throw new ApiError(500, "the daemon is missing engine/" + f);
                    Files.write(dir.resolve(f), in.readAllBytes());
                }
            }
            Path gi = dir.getParent().resolve(".gitignore");
            if (!Files.exists(gi)) Files.writeString(gi, "engine/\ncache/\nbookmarks/\nworktrees/\n");
        } catch (IOException e) { throw new ApiError(500, "cannot write the engine files: " + e.getMessage()); }
    }

    /** Spark event logs from local runs, on the host. The history server reads this directory. */
    public Path eventsDir() { return state.project().toAbsolutePath().normalize().resolve(".spar").resolve("spark-events"); }

    /** Where the container finds the source shim when the engine is running the script. */
    public static final String SHIM_DIR = "/home/hadoop/workspace/.spar/engine";

    /**
     * Copies `keel_local.py` next to the job. The engine reads it from `.keel/engine`, but a
     * one-shot container mounts only the job folder, so the local path is the one that always works.
     */
    public void copyShim(Path jobDir) {
        try (InputStream in = Engine.class.getResourceAsStream("/engine/keel_local.py")) {
            if (in == null) throw new ApiError(500, "the daemon is missing engine/keel_local.py");
            Files.createDirectories(jobDir);
            Files.write(jobDir.resolve("keel_local.py"), in.readAllBytes());
        } catch (IOException e) { throw new ApiError(500, "cannot write keel_local.py: " + e.getMessage()); }
    }

    public synchronized Map<String, Object> stop(String why) {
        String c = container;
        container = null; port = 0;
        if (c == null) return Map.of("stopped", false);
        Proc.run(null, 30, null, "docker", "rm", "-f", c);
        log.info("engine {} stopped: {}", c, why);
        events.emit("engine", Map.of("state", "down", "why", why));
        return Map.of("stopped", true);
    }

    @Scheduled(fixedRate = 60_000)
    void idleCheck() {
        if (up() && System.currentTimeMillis() - lastUse > IDLE.toMillis()) stop("idle for " + IDLE.toMinutes() + " minutes");
    }

    @PreDestroy
    void shutdown() { stop("the daemon is exiting"); }
}
