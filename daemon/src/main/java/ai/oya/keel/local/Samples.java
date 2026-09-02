package ai.oya.keel.local;

import ai.oya.keel.ApiError;
import ai.oya.keel.codegen.Dag;
import ai.oya.keel.codegen.TestGen;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The data a job reads when it runs on this machine.
 *
 * A source node's `transformation_ctx` is its DAG node id, so a manifest keyed by node id is
 * enough for the shim to serve every read from a file — catalog, JDBC and S3 sources alike,
 * without emulating any of them. Samples come from the real source (captured once, then never
 * again) or from the node's own declared schema when there is no AWS at all.
 *
 * Captured rows are somebody's production data, so `samples/` is gitignored unless they say
 * otherwise, one fixture at a time.
 */
@RestController
public class Samples {
    /** What `jobs/.gitignore` must contain for a capture to be safe by default. */
    static final List<String> IGNORE = List.of("__pycache__/", ".pytest_cache/", ".junit.xml", ".ranges.json",
            ".preview.py", ".preview.err", ".local.py", "keel_local.py", "*/samples/**", "*/out/**");

    private final Project project;
    private final ObjectMapper json;

    public Samples(Project project, ObjectMapper json) { this.project = project; this.json = json; }

    @GetMapping("/api/jobs/{name}/samples")
    public Map<String, Object> get(@PathVariable String name) { return status(name); }

    @PostMapping("/api/jobs/{name}/samples/{node}/synthetic")
    public Map<String, Object> synthetic(@PathVariable String name, @PathVariable String node, @RequestParam(defaultValue = "20") int rows) {
        return Map.of("node", node, "sample", synthesise(name, node, rows), "status", status(name));
    }

    @DeleteMapping("/api/jobs/{name}/samples/{node}")
    public Map<String, Object> delete(@PathVariable String name, @PathVariable String node) {
        Map<String, Object> r = new LinkedHashMap<>(clear(name, node));
        r.put("status", status(name));
        return r;
    }

    @PostMapping("/api/jobs/{name}/samples/commit")
    public Map<String, Object> setCommitted(@PathVariable String name, @RequestParam boolean commit) {
        Map<String, Object> r = new LinkedHashMap<>(commit(name, commit));
        r.put("status", status(name));
        return r;
    }

    public Path dir(String job) { return project.dir(job).resolve("samples"); }
    public Path manifestPath(String job) { return dir(job).resolve("manifest.json"); }

    /** node id → {path, format, rows, captured, kind, from}. Missing file is an empty manifest, not an error. */
    public ObjectNode manifest(String job) {
        JsonNode n = project.readJson(manifestPath(job));
        return n != null && n.isObject() ? (ObjectNode) n : json.createObjectNode();
    }

    /** Every source in the job, with whether it can be read locally. This is what the app draws. */
    public Map<String, Object> status(String job) {
        ObjectNode m = manifest(job);
        JsonNode dagJson = project.readJson(project.dir(job).resolve("dag.json"));
        List<Map<String, Object>> sources = new ArrayList<>();
        if (dagJson != null) {
            Dag dag = Dag.parse(dagJson);
            for (Dag.Node n : dag.topo()) {
                if (!n.isSource()) continue;
                Map<String, Object> s = new LinkedHashMap<>();
                s.put("node", n.id());
                s.put("name", n.name());
                s.put("type", n.type());
                JsonNode e = m.get(n.id());
                s.put("sample", e == null ? null : json.convertValue(e, Map.class));
                s.put("ready", e != null && Files.exists(project.dir(job).resolve(e.path("path").asText())));
                sources.add(s);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sources", sources);
        out.put("ready", !sources.isEmpty() && sources.stream().allMatch(s -> Boolean.TRUE.equals(s.get("ready"))));
        out.put("committed", committed(job));
        return out;
    }

    /**
     * True when this job's fixtures are tracked. Git cannot re-include a file whose parent
     * directory is excluded, so the default pattern excludes the *contents*
     * (`*​/samples/**`) and one job opts back in with a negation of the same shape.
     */
    public boolean committed(String job) {
        String gi = Project.readText(project.dir(job).getParent().resolve(".gitignore"));
        return gi != null && gi.contains("!" + project.dir(job).getFileName() + "/samples/**");
    }

    /** The manifest as the shim wants it: node id → {path, format}, paths relative to the job folder. */
    public String shimManifest(String job) {
        ObjectNode m = manifest(job);
        ObjectNode out = json.createObjectNode();
        m.fields().forEachRemaining(e -> {
            ObjectNode v = json.createObjectNode();
            v.put("path", e.getValue().path("path").asText());
            v.put("format", e.getValue().path("format").asText("json"));
            out.set(e.getKey(), v);
        });
        return out.toString();
    }

    /** Which sources feeding `node` (itself included) have no sample yet. Empty means a local run can go. */
    public List<String> missing(String job, Dag dag, String node) {
        ObjectNode m = manifest(job);
        List<String> out = new ArrayList<>();
        Set<String> need = new java.util.HashSet<>();
        java.util.Deque<String> q = new java.util.ArrayDeque<>(List.of(node));
        while (!q.isEmpty()) { String id = q.poll(); if (need.add(id)) { Dag.Node n = dag.nodes.get(id); if (n != null) q.addAll(n.inputs()); } }
        for (String id : need) {
            Dag.Node n = dag.nodes.get(id);
            if (n == null || !n.isSource()) continue;
            JsonNode e = m.get(id);
            if (e == null || !Files.exists(project.dir(job).resolve(e.path("path").asText()))) out.add(id);
        }
        return out;
    }

    /** Rows straight from a preview or a capture, written as JSON lines and recorded in the manifest. */
    public Map<String, Object> write(String job, String node, JsonNode rows, String kind, String from) {
        if (rows == null || !rows.isArray() || rows.isEmpty()) throw ApiError.badRequest("no rows to save for " + node);
        StringBuilder b = new StringBuilder();
        for (JsonNode r : rows) b.append(r.toString()).append('\n');
        Path d = dir(job);
        try { Files.createDirectories(d); } catch (IOException e) { throw new ApiError(500, "cannot create " + d); }
        ensureIgnored(job);
        project.writeFile(job, "samples/" + node + ".json", b.toString());
        ObjectNode m = manifest(job);
        ObjectNode e = json.createObjectNode();
        e.put("path", "samples/" + node + ".json");
        e.put("format", "json");
        e.put("rows", rows.size());
        e.put("captured", Instant.now().toString());
        e.put("kind", kind);
        if (from != null) e.put("from", from);
        m.set(node, e);
        project.writeFile(job, "samples/manifest.json", m.toPrettyString());
        return json.convertValue(e, Map.class);
    }

    /** No AWS, no captured file: rows invented from the node's own OutputSchemas. */
    public Map<String, Object> synthesise(String job, String node, int rows) {
        JsonNode dagJson = project.readJson(project.dir(job).resolve("dag.json"));
        if (dagJson == null) throw ApiError.notFound("no dag.json");
        Dag dag = Dag.parse(dagJson);
        Dag.Node n = dag.nodes.get(node);
        if (n == null) throw ApiError.notFound("no node " + node);
        Map<String, String> cols = TestGen.columns(n, dag, new java.util.HashSet<>());
        // A downstream Filter comparing a column to a constant would drop every invented row, so
        // invented rows carry that constant: synthetic data that reaches the end of the pipeline.
        Map<String, String> hints = TestGen.hints(dag);
        // A CSV source is all strings until an ApplyMapping casts it, and "order_id-1" casts to
        // null. Invented rows use the type the mapping will cast to, so the whole DAG stays legible.
        Map<String, String> casts = casts(dag);
        ArrayNode arr = json.createArrayNode();
        for (int i = 1; i <= Math.max(1, Math.min(1000, rows)); i++) {
            ObjectNode r = json.createObjectNode();
            for (Map.Entry<String, String> c : cols.entrySet()) {
                String hint = hints.get(c.getKey());
                String type = TestGen.isNumeric(c.getValue()) ? c.getValue() : casts.getOrDefault(c.getKey(), c.getValue());
                if (hint != null && !TestGen.isNumeric(type)) r.put(c.getKey(), hint);
                else put(r, c.getKey(), c.getValue(), i, type);
            }
            arr.add(r);
        }
        return write(job, node, arr, "synthetic", null);
    }

    /** column → the type some ApplyMapping downstream will cast it to. */
    private static Map<String, String> casts(Dag dag) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Dag.Node n : dag.nodes.values()) {
            if (!n.type().equals("ApplyMapping")) continue;
            for (JsonNode m : n.body().path("Mapping")) {
                String from = m.path("FromPath").isArray() && !m.path("FromPath").isEmpty()
                        ? m.path("FromPath").get(m.path("FromPath").size() - 1).asText() : m.path("FromPath").asText();
                String to = m.path("ToType").asText("");
                if (!from.isEmpty() && !to.isEmpty()) out.putIfAbsent(from, to);
            }
        }
        return out;
    }

    /** Written as the source's own type (a CSV column is a string) but shaped so the cast survives. */
    private static void put(ObjectNode r, String name, String declared, int i, String castTo) {
        boolean asText = declared != null && declared.toLowerCase().startsWith("string");
        String t = (castTo == null ? "string" : castTo).toLowerCase();
        if (asText) {
            if (t.contains("int") || t.equals("long") || t.equals("short") || t.equals("byte")) { r.put(name, String.valueOf(i)); return; }
            if (t.contains("double") || t.contains("float") || t.contains("decimal")) { r.put(name, i + ".5"); return; }
        }
        put(r, name, t, i);
    }

    private static void put(ObjectNode r, String name, String type, int i) {
        String t = type == null ? "string" : type.toLowerCase();
        if (t.contains("int") || t.equals("long") || t.equals("short") || t.equals("byte")) r.put(name, i);
        else if (t.contains("double") || t.contains("float") || t.contains("decimal")) r.put(name, i + 0.5);
        else if (t.equals("boolean")) r.put(name, i % 2 == 0);
        else if (t.equals("date")) r.put(name, "2024-01-" + String.format("%02d", 1 + (i % 28)));
        else if (t.contains("timestamp")) r.put(name, "2024-01-" + String.format("%02d", 1 + (i % 28)) + " 12:00:00");
        else r.put(name, name + "-" + i);
    }

    public Map<String, Object> clear(String job, String node) {
        ObjectNode m = manifest(job);
        JsonNode e = m.remove(node);
        if (e != null) {
            try { Files.deleteIfExists(project.dir(job).resolve(e.path("path").asText())); } catch (IOException ignored) { }
            project.writeFile(job, "samples/manifest.json", m.toPrettyString());
        }
        return Map.of("cleared", e != null);
    }

    /** Captured rows never reach a commit unless asked for; this is the "unless asked for". */
    public Map<String, Object> commit(String job, boolean commit) {
        Path gi = project.dir(job).getParent().resolve(".gitignore");
        String text = Project.readText(gi);
        List<String> lines = new ArrayList<>(text == null ? IGNORE : List.of(text.split("\n")));
        String mine = "!" + project.dir(job).getFileName() + "/samples/**";
        lines.removeIf(l -> l.strip().equals(mine));
        if (commit) lines.add(mine);
        project.write(gi, String.join("\n", lines).strip() + "\n");
        return Map.of("committed", commit);
    }

    /** Adds anything missing to `jobs/.gitignore` — an older project's file predates samples. */
    void ensureIgnored(String job) {
        Path gi = project.dir(job).getParent().resolve(".gitignore");
        String text = Project.readText(gi);
        List<String> lines = new ArrayList<>(text == null ? List.of() : List.of(text.split("\n")));
        boolean changed = false;
        for (String want : IGNORE) if (lines.stream().noneMatch(l -> l.strip().equals(want))) { lines.add(want); changed = true; }
        if (changed) project.write(gi, String.join("\n", lines).strip() + "\n");
    }
}
