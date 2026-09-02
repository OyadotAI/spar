package ai.oya.keel.testing;

import ai.oya.keel.ApiError;
import ai.oya.keel.Proc;
import ai.oya.keel.State;
import ai.oya.keel.codegen.Dag;
import ai.oya.keel.codegen.PySpark;
import ai.oya.keel.local.Project;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
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
 * Glue Studio's "Data preview" and "Output schema", without an interactive session: the upstream
 * chain of one node runs inside the Glue 5 container on this machine, against the real S3 data
 * (the profile's credentials are mounted read-only), and the first rows plus the DataFrame schema
 * come back. Cached by node and DAG rev, so clicking around is free once a node has been sampled.
 */
@RestController
public class Preview {
    private final Project project;
    private final State state;
    private final ObjectMapper json;
    private final Map<String, Map<String, Object>> cache = new ConcurrentHashMap<>();
    private final Map<String, Process> running = new ConcurrentHashMap<>();

    public Preview(Project project, State state, ObjectMapper json) { this.project = project; this.state = state; this.json = json; }

    @GetMapping("/api/jobs/{name}/preview/{node}")
    public Map<String, Object> cached(@PathVariable String name, @PathVariable String node) {
        Map<String, Object> c = cache.get(name + "/" + node + "@" + project.rev(name));
        return c == null ? Map.of("cached", false) : c;
    }

    @PostMapping("/api/jobs/{name}/preview/{node}")
    public Map<String, Object> preview(@PathVariable String name, @PathVariable String node, @RequestParam(defaultValue = "50") int rows) {
        String key = name + "/" + node + "@" + project.rev(name);
        Map<String, Object> hit = cache.get(key);
        if (hit != null) return hit;
        Path d = project.dir(name);
        JsonNode dagJson = project.readJson(d.resolve("dag.json"));
        if (dagJson == null) throw ApiError.notFound("no dag.json");
        Dag dag = Dag.parse(dagJson);
        if (!dag.nodes.containsKey(node)) throw ApiError.notFound("no node " + node);
        PySpark.Generated gen = PySpark.generate(dagJson);
        project.writeFile(name, "job.py", gen.script()); // preview always runs the code the DAG describes
        String script = previewScript(dag, gen.names(), node, Math.min(500, Math.max(1, rows)));
        project.writeFile(name, ".preview.py", script);
        if (running.containsKey(name)) throw ApiError.conflict("a preview is already running for " + name);
        if (!Proc.run(null, 10, null, "docker", "info").ok()) throw new ApiError(503, "Docker is not running", "start Docker; previews run in " + TestRunner.IMAGE);
        List<String> cmd = new ArrayList<>(List.of("docker", "run", "-i", "--rm", "--name", "keel-preview-" + name,
                "-v", Path.of(System.getProperty("user.home"), ".aws") + ":/home/hadoop/.aws:ro",
                "-v", d.toAbsolutePath() + ":/home/hadoop/workspace", "-w", "/home/hadoop/workspace"));
        if (state.profile() != null) { cmd.add("-e"); cmd.add("AWS_PROFILE=" + state.profile()); }
        if (state.region() != null) { cmd.add("-e"); cmd.add("AWS_REGION=" + state.region()); }
        cmd.add(TestRunner.IMAGE); cmd.add("-c"); cmd.add("spark-submit --master 'local[2]' .preview.py 2>.preview.err");
        long t0 = System.currentTimeMillis();
        Process p;
        try { p = Proc.start(d, null, cmd.toArray(String[]::new)); } catch (IOException e) { throw new ApiError(500, "cannot start docker: " + e.getMessage()); }
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
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("node", node); result.put("rev", project.rev(name)); result.put("ms", System.currentTimeMillis() - t0); result.put("cached", true);
        String text = out.toString();
        int i = text.indexOf("KEEL_PREVIEW_JSON:");
        if (i < 0) {
            String err = Project.readText(d.resolve(".preview.err"));
            List<String> lines = err == null ? List.of() : Proc.lines(err);
            List<String> tail = lines.stream().filter(l -> !l.contains(" INFO ") && !l.contains("WARN")).toList();
            result.put("error", tail.isEmpty() ? "the preview produced no rows and no error" : String.join("\n", tail.subList(Math.max(0, tail.size() - 30), tail.size())));
            return result;
        }
        try {
            JsonNode r = json.readTree(text.substring(i + "KEEL_PREVIEW_JSON:".length()).strip());
            result.put("schema", r.get("schema")); result.put("rows", r.get("rows")); result.put("count", r.path("count").asLong(-1)); result.put("elapsed", r.path("elapsed").asDouble());
            if (r.has("error")) result.put("error", r.get("error").asText());
        } catch (IOException e) { result.put("error", "unreadable preview output"); }
        cache.put(key, result);
        return result;
    }

    @PostMapping("/api/jobs/{name}/preview/stop")
    public Map<String, Object> stop(@PathVariable String name) {
        Process p = running.get(name);
        if (p == null) return Map.of("stopped", false);
        Proc.run(null, 20, null, "docker", "kill", "keel-preview-" + name); p.destroyForcibly();
        return Map.of("stopped", true);
    }

    /** Runs every ancestor of `target` in topological order with its S3 paths as written, then samples the target. */
    static String previewScript(Dag dag, Map<String, String> names, String target, int rows) {
        java.util.Set<String> need = new java.util.HashSet<>();
        java.util.Deque<String> q = new java.util.ArrayDeque<>(List.of(target));
        while (!q.isEmpty()) { String id = q.poll(); if (need.add(id)) q.addAll(dag.nodes.get(id).inputs()); }
        StringBuilder b = new StringBuilder("import json, sys, time\nfrom awsglue.context import GlueContext\nfrom pyspark.context import SparkContext\nimport job\n\n")
            .append("glueContext = GlueContext(SparkContext.getOrCreate())\nt0 = time.time()\nout = {}\ntry:\n");
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
