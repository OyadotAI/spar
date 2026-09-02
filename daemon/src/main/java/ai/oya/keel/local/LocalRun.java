package ai.oya.keel.local;

import ai.oya.keel.ApiError;
import ai.oya.keel.State;
import ai.oya.keel.codegen.Dag;
import ai.oya.keel.codegen.PySpark;
import ai.oya.keel.engine.Engine;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * The whole job, run on this machine, against the samples: every node's row count, every file
 * written, and the physical plan for each target.
 *
 * This is the thing Glue makes you buy an interactive session to see. It is not a substitute for
 * a cloud run — a local run cannot exercise the catalog, Lake Formation, data quality or PII
 * detection, and it says so — but it answers "does my logic work" in a second instead of the
 * seventy-five a real run takes to fail on a typo.
 */
@RestController
public class LocalRun {
    private final Project project;
    private final Samples samples;
    private final Engine engine;
    private final State state;
    private final ObjectMapper json;

    public LocalRun(Project project, Samples samples, Engine engine, State state, ObjectMapper json) {
        this.project = project; this.samples = samples; this.engine = engine; this.state = state; this.json = json;
    }

    @GetMapping("/api/jobs/{name}/run/local")
    public SseEmitter run(@PathVariable String name, @RequestParam(defaultValue = "false") boolean bookmarks) {
        Path d = project.dir(name);
        JsonNode dagJson = project.readJson(d.resolve("dag.json"));
        if (dagJson == null) throw ApiError.notFound("no dag.json");
        Dag dag = Dag.parse(dagJson);
        List<String> missing = dag.nodes.values().stream().filter(Dag.Node::isSource)
                .map(Dag.Node::id).filter(id -> samples.missing(name, dag, id).contains(id)).toList();
        if (!missing.isEmpty())
            throw new ApiError(400, "no local sample for " + String.join(", ", missing),
                    "capture rows from the real source, or generate synthetic ones, under Local data");
        SseEmitter e = new SseEmitter(0L);
        AtomicBoolean alive = new AtomicBoolean(true);
        e.onCompletion(() -> alive.set(false)); e.onTimeout(() -> alive.set(false)); e.onError(t -> alive.set(false));
        Thread.ofVirtual().name("local-run-" + name).start(() -> {
            Map<String, Object> result = new LinkedHashMap<>();
            try {
                send(e, alive, "line", Map.of("text", "running " + name + " locally against samples/"));
                PySpark.Generated gen = PySpark.generate(dagJson);
                project.writeFile(name, "job.py", gen.script());
                engine.copyShim(d);
                ObjectNode bookmark = bookmarks ? bookmarkState(name) : null;
                String script = script(dag, gen.names(), samples.shimManifest(name), bookmark == null ? null : bookmark.toString());
                long t0 = System.currentTimeMillis();
                String out = engine.exec(d, script, Duration.ofMinutes(20));
                for (String l : out.split("\n")) if (!l.startsWith("KEEL_RUN_JSON:")) send(e, alive, "line", Map.of("text", l));
                int i = out.indexOf("KEEL_RUN_JSON:");
                if (i < 0) { result.put("status", "error"); result.put("message", out.isBlank() ? "the run produced no output" : out.strip()); }
                else {
                    JsonNode r = json.readTree(out.substring(i + "KEEL_RUN_JSON:".length()).strip());
                    result.put("status", r.hasNonNull("error") ? "failed" : "passed");
                    result.put("nodes", r.get("nodes"));
                    result.put("written", r.get("written"));
                    result.put("elapsed", r.path("elapsed").asDouble());
                    if (r.hasNonNull("error")) result.put("message", r.get("error").asText());
                    if (bookmarks && r.has("consumed")) result.put("bookmark", saveBookmark(name, r.get("consumed")));
                    result.put("bookmarksSimulated", bookmarks);
                }
                result.put("ms", System.currentTimeMillis() - t0);
                result.put("out", d.resolve("out").toString());
                result.put("notCovered", notCovered(dag));
            } catch (ApiError ex) {
                result.put("status", "error");
                result.put("message", ex.getMessage() + (ex.fix == null ? "" : " — " + ex.fix));
            } catch (Exception ex) {
                // Whatever went wrong, the stream must end: a client waiting on SSE has no timeout.
                result.put("status", "error");
                result.put("message", ex.getClass().getSimpleName() + ": " + ex.getMessage());
            }
            send(e, alive, "result", result);
            send(e, alive, "done", Map.of("code", "passed".equals(result.get("status")) ? 0 : 1));
            e.complete();
        });
        return e;
    }

    /**
     * What a local run cannot exercise, named before the cloud run rather than after it.
     *
     * A DynamicFrame round-trips through an RDD, so Spark's own plan shows `ExistingRDD` and says
     * nothing about pushdown — reporting it would be a number that looks like evidence and is not.
     * What can be said honestly is which nodes the container cannot exercise at all.
     */
    static List<String> notCovered(Dag dag) {
        java.util.List<String> out = new java.util.ArrayList<>();
        for (Dag.Node n : dag.nodes.values()) {
            if (n.type().contains("Catalog") || n.type().contains("Quality") || n.type().contains("PII")
                    || n.type().contains("FindMatches") || n.type().contains("Kinesis") || n.type().contains("Kafka")
                    || n.type().contains("Glueparquet"))
                out.add(n.name() + " (" + n.type() + ") — the local runtime cannot exercise this node type");
            if (n.body().hasNonNull("AdditionalOptions") && n.body().get("AdditionalOptions").has("push_down_predicate")
                    || n.body().hasNonNull("PushDownPredicate"))
                out.add(n.name() + " — its pushdown predicate reads a sample here, so it proves nothing about partition pruning in S3");
        }
        return out;
    }

    @GetMapping("/api/jobs/{name}/bookmark/local")
    public Map<String, Object> bookmark(@PathVariable String name) {
        ObjectNode b = bookmarkState(name);
        return Map.of("simulated", true, "state", b, "empty", b.isEmpty());
    }

    @DeleteMapping("/api/jobs/{name}/bookmark/local")
    public Map<String, Object> reset(@PathVariable String name) {
        try { Files.deleteIfExists(bookmarkPath(name)); } catch (IOException e) { throw new ApiError(500, "cannot reset: " + e.getMessage()); }
        return Map.of("reset", true, "simulated", true);
    }

    private Path bookmarkPath(String name) { return state.keelDir().resolve("bookmarks").resolve(name + ".json"); }

    private ObjectNode bookmarkState(String name) {
        JsonNode n = project.readJson(bookmarkPath(name));
        return n != null && n.isObject() ? (ObjectNode) n : json.createObjectNode();
    }

    private Map<String, Object> saveBookmark(String name, JsonNode consumed) {
        ObjectNode state0 = bookmarkState(name);
        consumed.fields().forEachRemaining(e -> {
            com.fasterxml.jackson.databind.node.ArrayNode arr = state0.withArray(e.getKey());
            for (JsonNode p : e.getValue()) {
                boolean have = false;
                for (JsonNode q : arr) if (q.asText().equals(p.asText())) { have = true; break; }
                if (!have) arr.add(p.asText());
            }
        });
        state0.put("updated", Instant.now().toString());
        try {
            Files.createDirectories(bookmarkPath(name).getParent());
            Files.writeString(bookmarkPath(name), state0.toPrettyString());
        } catch (IOException e) { throw new ApiError(500, "cannot write the local bookmark: " + e.getMessage()); }
        return Map.of("simulated", true, "state", state0);
    }

    /** The whole pipeline, node by node, with a row count after each one and the plan at each target. */
    static String script(Dag dag, Map<String, String> names, String manifest, String bookmark) {
        StringBuilder b = new StringBuilder("import json, sys, time, traceback\n")
                .append("from awsglue.context import GlueContext\nfrom pyspark.context import SparkContext\nimport job\n\n")
                .append("glueContext = GlueContext(SparkContext.getOrCreate())\n")
                .append("sys.path.insert(0, \"").append(Engine.SHIM_DIR).append("\")\nsys.path.insert(0, \".\")\nimport keel_local\n")
                .append("consumed = {}\n")
                .append("written = keel_local.install(glueContext, ").append(PySpark.pyString(manifest))
                .append(", \"out\", \".\", ").append(bookmark == null ? "None" : PySpark.pyString(bookmark)).append(", consumed)\n")
                .append("stats = []\nt0 = time.time()\nout = {}\ntry:\n");
        for (Dag.Node n : dag.topo()) {
            String v = "f_" + names.get(n.id());
            b.append("    ").append(v).append(" = job.").append(names.get(n.id())).append("(glueContext");
            for (String in : n.inputs()) b.append(", f_").append(names.get(in));
            b.append(")\n");
            b.append("    ").append(v).append(" = keel_local.watch(glueContext, stats, ").append(PySpark.pyString(n.id())).append(", ").append(v).append(")\n");
        }
        b.append("    out = {\"nodes\": stats, \"written\": written, \"consumed\": consumed, \"elapsed\": time.time() - t0}\n")
         .append("except Exception:\n")
         .append("    out = {\"error\": traceback.format_exc()[-6000:], \"nodes\": stats, \"written\": written, \"consumed\": consumed, \"elapsed\": time.time() - t0}\n")
         .append("print(\"KEEL_RUN_JSON:\" + json.dumps(out))\nsys.stdout.flush()\n");
        return b.toString();
    }

    private static void send(SseEmitter e, AtomicBoolean alive, String name, Object data) {
        if (!alive.get()) return;
        try { e.send(SseEmitter.event().name(name).data(data)); } catch (IOException | IllegalStateException ex) { alive.set(false); }
    }
}
