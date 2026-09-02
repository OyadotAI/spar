package ai.oya.keel.testing;

import ai.oya.keel.ApiError;
import ai.oya.keel.Proc;
import ai.oya.keel.State;
import ai.oya.keel.codegen.Dag;
import ai.oya.keel.codegen.PySpark;
import ai.oya.keel.engine.Engine;
import ai.oya.keel.local.Project;
import ai.oya.keel.local.Samples;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Glue Studio's "Data preview" and "Output schema", without an interactive session.
 *
 * The upstream chain of one node runs on this machine — in the warm engine when it is up, in a
 * one-shot container when it is not — and the first rows plus the DataFrame schema come back.
 * It reads local samples when the job has them and the real source when it does not, and always
 * says which of the two it did. Cached by node, DAG rev and where the data came from.
 */
@RestController
public class Preview {
    private final Project project;
    private final Samples samples;
    private final Engine engine;
    private final State state;
    private final ObjectMapper json;
    private final Map<String, Map<String, Object>> cache = new ConcurrentHashMap<>();
    private final Map<String, Process> running = new ConcurrentHashMap<>();

    public Preview(Project project, Samples samples, Engine engine, State state, ObjectMapper json) {
        this.project = project; this.samples = samples; this.engine = engine; this.state = state; this.json = json;
    }

    @GetMapping("/api/jobs/{name}/preview/{node}")
    public Map<String, Object> cached(@PathVariable String name, @PathVariable String node) {
        for (String where : List.of("local", "aws")) {
            Map<String, Object> c = cache.get(key(name, node, where));
            if (c != null) return c;
        }
        return Map.of("cached", false);
    }

    @PostMapping("/api/jobs/{name}/preview/{node}")
    public Map<String, Object> preview(@PathVariable String name, @PathVariable String node,
                                       @RequestParam(defaultValue = "50") int rows,
                                       @RequestParam(defaultValue = "auto") String source) {
        Path d = project.dir(name);
        JsonNode dagJson = project.readJson(d.resolve("dag.json"));
        if (dagJson == null) throw ApiError.notFound("no dag.json");
        Dag dag = Dag.parse(dagJson);
        if (!dag.nodes.containsKey(node)) throw ApiError.notFound("no node " + node);
        List<String> missing = samples.missing(name, dag, node);
        boolean local = switch (source) {
            case "local" -> true;
            case "aws" -> false;
            default -> missing.isEmpty(); // local first: samples win whenever the job has them
        };
        if (local && !missing.isEmpty())
            throw new ApiError(400, "no local sample for " + String.join(", ", missing),
                    "capture one from the real source, or generate a synthetic one from the node's schema");
        String where = local ? "local" : "aws";
        Map<String, Object> hit = cache.get(key(name, node, where));
        if (hit != null) return hit;
        if (!local && state.profile() == null)
            throw new ApiError(400, "this preview needs the real source and no AWS profile is selected",
                    "pick a profile, or give the sources a local sample and preview offline");

        PySpark.Generated gen = PySpark.generate(dagJson);
        project.writeFile(name, "job.py", gen.script()); // preview always runs the code the DAG describes
        if (local) engine.copyShim(d);
        String script = previewScript(dag, gen.names(), node, Math.min(500, Math.max(1, rows)),
                local ? samples.shimManifest(name) : null);
        long t0 = System.currentTimeMillis();
        String out = run(name, d, script);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("node", node);
        result.put("rev", project.rev(name));
        result.put("ms", System.currentTimeMillis() - t0);
        result.put("cached", true);
        result.put("source", where);
        result.put("engine", engine.up());
        int i = out.indexOf("KEEL_PREVIEW_JSON:");
        if (i < 0) {
            result.put("error", tail(out, d));
            return result;
        }
        try {
            JsonNode r = json.readTree(out.substring(i + "KEEL_PREVIEW_JSON:".length()).strip());
            result.put("schema", r.get("schema"));
            result.put("rows", r.get("rows"));
            result.put("count", r.path("count").asLong(-1));
            result.put("elapsed", r.path("elapsed").asDouble());
            if (r.has("error")) { result.put("error", r.get("error").asText()); return result; }
        } catch (IOException e) { result.put("error", "unreadable preview output"); return result; }
        cache.put(key(name, node, where), result);
        return result;
    }

    /** Real rows from the real source, saved as the node's local sample. Everything after this is offline. */
    @PostMapping("/api/jobs/{name}/samples/{node}/capture")
    public Map<String, Object> capture(@PathVariable String name, @PathVariable String node,
                                       @RequestParam(defaultValue = "100") int rows) {
        cache.remove(key(name, node, "aws"));
        Map<String, Object> p = preview(name, node, rows, "aws");
        if (p.get("error") != null) throw new ApiError(502, "could not read the source", String.valueOf(p.get("error")));
        JsonNode got = json.valueToTree(p.get("rows"));
        Dag dag = Dag.parse(project.readJson(project.dir(name).resolve("dag.json")));
        Dag.Node n = dag.nodes.get(node);
        Map<String, Object> saved = samples.write(name, node, got, "captured", n == null ? null : n.type());
        cache.remove(key(name, node, "local"));
        return Map.of("node", node, "sample", saved, "status", samples.status(name));
    }

    @PostMapping("/api/jobs/{name}/preview/stop")
    public Map<String, Object> stop(@PathVariable String name) {
        Process p = running.get(name);
        if (p == null) return Map.of("stopped", false);
        Proc.run(null, 20, null, "docker", "kill", "keel-preview-" + name);
        p.destroyForcibly();
        return Map.of("stopped", true);
    }

    /**
     * A preview belongs to one node, one DAG revision and one data source; a local one also
     * belongs to the samples it read, so capturing a new sample invalidates it.
     */
    private String key(String name, String node, String where) {
        String suffix = "local".equals(where) ? "/" + Integer.toHexString(samples.manifest(name).toString().hashCode()) : "";
        return name + "/" + node + "@" + project.rev(name) + "/" + where + suffix;
    }

    /** The warm engine when it is up, a one-shot container when it is not. Same script either way. */
    private String run(String name, Path d, String script) {
        try {
            return engine.exec(d, script, Duration.ofMinutes(10));
        } catch (ApiError e) {
            if (e.status == 500) throw e; // the script itself blew up; a second attempt changes nothing
        }
        return oneShot(name, d, script);
    }

    private String oneShot(String name, Path d, String script) {
        project.writeFile(name, ".preview.py", script);
        if (running.containsKey(name)) throw ApiError.conflict("a preview is already running for " + name);
        if (!Proc.run(null, 10, null, "docker", "info").ok())
            throw new ApiError(503, "Docker is not running", "start Docker; previews run in " + Engine.IMAGE);
        List<String> cmd = new ArrayList<>(List.of("docker", "run", "-i", "--rm", "--name", "keel-preview-" + name,
                "-v", Path.of(System.getProperty("user.home"), ".aws") + ":/home/hadoop/.aws:ro",
                "-v", d.toAbsolutePath() + ":/home/hadoop/workspace", "-w", "/home/hadoop/workspace"));
        if (state.profile() != null) { cmd.add("-e"); cmd.add("AWS_PROFILE=" + state.profile()); }
        if (state.region() != null) { cmd.add("-e"); cmd.add("AWS_REGION=" + state.region()); }
        cmd.add(Engine.IMAGE); cmd.add("-c"); cmd.add("spark-submit --master 'local[2]' .preview.py 2>.preview.err");
        Process p;
        try { p = Proc.start(d, null, cmd.toArray(String[]::new)); }
        catch (IOException e) { throw new ApiError(500, "cannot start docker: " + e.getMessage()); }
        running.put(name, p);
        StringBuilder out = new StringBuilder();
        try {
            Thread a = Proc.drain(p.getInputStream(), l -> { synchronized (out) { out.append(l).append('\n'); } });
            Thread b = Proc.drain(p.getErrorStream(), l -> { });
            boolean done = p.waitFor(10, TimeUnit.MINUTES);
            if (!done) { Proc.run(null, 20, null, "docker", "kill", "keel-preview-" + name); p.destroyForcibly(); throw new ApiError(504, "the preview took more than 10 minutes"); }
            a.join(5000); b.join(5000);
        } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new ApiError(500, "interrupted"); }
        finally { running.remove(name); }
        return out.toString();
    }

    /** What to show when the run produced no rows: the Python traceback, not Spark's INFO log. */
    private static String tail(String out, Path d) {
        String err = Project.readText(d.resolve(".preview.err"));
        String text = (out == null ? "" : out) + (err == null ? "" : "\n" + err);
        List<String> lines = Proc.lines(text).stream().filter(l -> !l.contains(" INFO ") && !l.contains("WARN")).toList();
        if (lines.isEmpty()) return "the preview produced no rows and no error";
        return String.join("\n", lines.subList(Math.max(0, lines.size() - 30), lines.size()));
    }

    /**
     * Runs every ancestor of `target` in topological order, then samples the target. With a
     * manifest, the source shim is installed first, so every read comes from a local file.
     */
    static String previewScript(Dag dag, Map<String, String> names, String target, int rows, String manifest) {
        java.util.Set<String> need = new java.util.HashSet<>();
        java.util.Deque<String> q = new java.util.ArrayDeque<>(List.of(target));
        while (!q.isEmpty()) { String id = q.poll(); if (need.add(id)) q.addAll(dag.nodes.get(id).inputs()); }
        StringBuilder b = new StringBuilder("import json, sys, time\nfrom awsglue.context import GlueContext\nfrom pyspark.context import SparkContext\nimport job\n\n")
            .append("glueContext = GlueContext(SparkContext.getOrCreate())\n");
        if (manifest != null) {
            b.append("sys.path.insert(0, \"").append(Engine.SHIM_DIR).append("\")\nsys.path.insert(0, \".\")\n")
             .append("import keel_local\nkeel_local.install(glueContext, ").append(PySpark.pyString(manifest)).append(", \"out\", \".\")\n");
        }
        b.append("t0 = time.time()\nout = {}\ntry:\n");
        for (Dag.Node n : dag.topo()) {
            if (!need.contains(n.id())) continue;
            if (n.isTarget()) { b.append("    f_").append(names.get(n.id())).append(" = f_").append(names.get(n.inputs().get(0))).append("  # a target's preview is its input\n"); continue; }
            b.append("    f_").append(names.get(n.id())).append(" = job.").append(names.get(n.id())).append("(glueContext");
            for (String in : n.inputs()) b.append(", f_").append(names.get(in));
            b.append(")\n");
        }
        b.append("    df = f_").append(names.get(target)).append(".toDF()\n")
         .append("    schema = [{\"Name\": f.name, \"Type\": f.dataType.simpleString()} for f in df.schema.fields]\n")
         .append("    rows = [r.asDict(recursive=True) for r in df.limit(").append(rows).append(").collect()]\n")
         .append("    out = {\"schema\": schema, \"rows\": json.loads(json.dumps(rows, default=str)), \"count\": len(rows), \"elapsed\": time.time() - t0}\n")
         .append("except Exception as e:\n    out = {\"error\": str(e)[:4000], \"elapsed\": time.time() - t0}\n")
         .append("print(\"KEEL_PREVIEW_JSON:\" + json.dumps(out))\nsys.stdout.flush()\n");
        return b.toString();
    }
}
