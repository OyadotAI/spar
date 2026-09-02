package ai.oya.keel.local;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import ai.oya.keel.State;
import ai.oya.keel.git.Git;
import ai.oya.keel.git.Lanes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Stream;
import org.springframework.stereotype.Component;

/**
 * A job's folder on disk: `jobs/<name>/{job.json, dag.json, layout.json, job.py, tests/}` in the
 * job's lane (or the project root before it has one). Every write bumps the job's `rev`, and a
 * write that carries a stale rev is refused — the canvas and the agent edit the same file, and a
 * silent overwrite is the bug nobody can see.
 */
@Component
public class Project {
    public static final String NAME = "[A-Za-z0-9._-]+";

    private final State state;
    private final Lanes lanes;
    private final Events events;
    private final ObjectMapper json;
    private final Map<String, AtomicLong> revs = new ConcurrentHashMap<>();
    /** content hashes of what Keel itself wrote last, so the watcher can tell our writes from outside ones */
    private final Map<Path, Integer> ownWrites = new ConcurrentHashMap<>();

    public Project(State state, Lanes lanes, Events events, ObjectMapper json) {
        this.state = state; this.lanes = lanes; this.events = events; this.json = json;
    }

    public static void validName(String job) {
        if (job == null || !job.matches(NAME)) throw ApiError.badRequest("job names are letters, digits, dot, dash, underscore");
    }

    public Path dir(String job) { validName(job); return lanes.dirFor(job).resolve("jobs").resolve(job); }
    public boolean exists(String job) { return Files.isDirectory(dir(job)); }
    public long rev(String job) { return revs.computeIfAbsent(job, k -> new AtomicLong(1)).get(); }
    public long bump(String job) { return revs.computeIfAbsent(job, k -> new AtomicLong(1)).incrementAndGet(); }
    public boolean wasOwnWrite(Path p, String content) { Integer h = ownWrites.get(p); return h != null && h == content.hashCode(); }

    public List<Map<String, Object>> list() {
        List<Map<String, Object>> out = new ArrayList<>();
        List<Path> roots = new ArrayList<>();
        roots.add(state.project().resolve("jobs"));
        Path wts = state.keelDir().resolve("worktrees");
        if (Files.isDirectory(wts)) { try (Stream<Path> s = Files.list(wts)) { s.forEach(w -> roots.add(w.resolve("jobs"))); } catch (IOException ignored) { } }
        Map<String, Map<String, Object>> byName = new LinkedHashMap<>();
        for (Path r : roots) {
            if (!Files.isDirectory(r)) continue;
            try (Stream<Path> s = Files.list(r)) {
                for (Path d : s.filter(Files::isDirectory).toList()) {
                    String name = d.getFileName().toString();
                    if (!name.matches(NAME)) continue;
                    if (!d.equals(dir(name))) continue; // the lane wins over the root copy
                    byName.put(name, summary(name));
                }
            } catch (IOException ignored) { }
        }
        out.addAll(byName.values());
        return out;
    }

    public Map<String, Object> summary(String job) {
        Path d = dir(job);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", job);
        m.put("imported", Files.isDirectory(d));
        m.put("hasDag", Files.exists(d.resolve("dag.json")));
        m.put("hasScript", Files.exists(d.resolve("job.py")));
        m.put("hasTests", Files.isDirectory(d.resolve("tests")));
        Map<String, Object> lane = new LinkedHashMap<>();
        lane.put("exists", lanes.exists(job));
        if (lanes.exists(job)) { lane.put("branch", Git.branch(lanes.dir(job))); lane.put("dirty", Git.status(lanes.dir(job)).size()); }
        m.put("lane", lane);
        return m;
    }

    /** Everything the app needs to draw a job: definition, DAG, layout, script (+ node line ranges), tests. */
    public Map<String, Object> read(String job) {
        Path d = dir(job);
        if (!Files.isDirectory(d)) throw ApiError.notFound("no local folder for " + job + "; import it first");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", job);
        m.put("dir", d.toString());
        m.put("rev", rev(job));
        m.put("job", readJson(d.resolve("job.json")));
        m.put("dag", readJson(d.resolve("dag.json")));
        m.put("layout", readJson(d.resolve("layout.json")));
        m.put("script", readText(d.resolve("job.py")));
        m.put("ranges", readJson(d.resolve(".ranges.json")));
        List<Map<String, String>> tests = new ArrayList<>();
        Path t = d.resolve("tests");
        if (Files.isDirectory(t)) {
            try (Stream<Path> s = Files.list(t)) {
                for (Path f : s.filter(Files::isRegularFile).sorted().toList()) {
                    if (!f.getFileName().toString().endsWith(".py")) continue;
                    tests.add(Map.of("path", "tests/" + f.getFileName(), "content", readText(f)));
                }
            } catch (IOException ignored) { }
        }
        m.put("tests", tests);
        m.put("summary", summary(job));
        return m;
    }

    // ---- writes ----------------------------------------------------------------------------------

    public long writeDag(String job, JsonNode dag, JsonNode layout, Long rev) {
        if (rev != null && rev != rev(job)) throw ApiError.conflict("dag.json changed since you last read it (rev " + rev(job) + "); reload and try again");
        validateDag(dag);
        Path d = ensureDir(job);
        write(d.resolve("dag.json"), pretty(dag));
        if (layout != null && !layout.isNull()) write(d.resolve("layout.json"), pretty(layout));
        long next = bump(job);
        events.emit("job.changed", Map.of("name", job, "rev", next));
        return next;
    }

    public long writeLayout(String job, JsonNode layout) {
        write(ensureDir(job).resolve("layout.json"), pretty(layout));
        return rev(job); // layout is not part of the DAG's rev: moving a node never conflicts with an edit
    }

    public long writeJob(String job, JsonNode def) {
        ObjectNode n = def.deepCopy();
        n.remove("CodeGenConfigurationNodes");
        write(ensureDir(job).resolve("job.json"), pretty(n));
        long next = bump(job);
        events.emit("job.changed", Map.of("name", job, "rev", next));
        return next;
    }

    public long writeScript(String job, String script) {
        write(ensureDir(job).resolve("job.py"), script);
        long next = bump(job);
        events.emit("job.changed", Map.of("name", job, "rev", next));
        return next;
    }

    public void writeFile(String job, String relative, String content) {
        Path p = ensureDir(job).resolve(relative).normalize();
        if (!p.startsWith(dir(job))) throw ApiError.badRequest("path escapes the job folder");
        write(p, content);
    }

    public Path ensureDir(String job) {
        Path d = dir(job);
        try {
            Files.createDirectories(d);
            Path gi = d.getParent().resolve(".gitignore"); // derived and cached files never reach a commit
            if (!Files.exists(gi)) Files.writeString(gi, String.join("\n", Samples.IGNORE) + "\n");
        } catch (IOException e) { throw new ApiError(500, "cannot create " + d); }
        return d;
    }

    void write(Path p, String content) {
        try {
            Files.createDirectories(p.getParent());
            ownWrites.put(p, content.hashCode());
            Files.writeString(p, content.endsWith("\n") ? content : content + "\n");
        } catch (IOException e) { throw new ApiError(500, "cannot write " + p + ": " + e.getMessage()); }
    }

    // ---- validation ------------------------------------------------------------------------------

    /** The invariants Glue itself enforces at deploy time, checked here so the canvas never holds a DAG Glue would refuse. */
    public static void validateDag(JsonNode dag) {
        if (dag == null || !dag.isObject()) throw ApiError.badRequest("dag.json must be an object of nodeId → node");
        for (Iterator<Map.Entry<String, JsonNode>> it = dag.fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> e = it.next();
            JsonNode node = e.getValue();
            if (!node.isObject() || node.size() != 1) throw ApiError.badRequest("node '" + e.getKey() + "' must have exactly one key (its type)");
            String type = node.fieldNames().next();
            JsonNode body = node.get(type);
            if (!body.isObject()) throw ApiError.badRequest("node '" + e.getKey() + "' (" + type + ") body must be an object");
            if (!body.hasNonNull("Name") || body.get("Name").asText().isBlank()) throw ApiError.badRequest("node '" + e.getKey() + "' (" + type + ") needs a Name");
            JsonNode inputs = body.get("Inputs");
            if (inputs != null) {
                if (!inputs.isArray()) throw ApiError.badRequest("node '" + e.getKey() + "' Inputs must be an array");
                for (JsonNode in : inputs) if (!dag.has(in.asText())) throw ApiError.badRequest("node '" + e.getKey() + "' has input '" + in.asText() + "' which does not exist");
                if (type.equals("Join") && inputs.size() != 2) throw ApiError.badRequest("Join '" + body.get("Name").asText() + "' needs exactly 2 inputs, has " + inputs.size());
            }
            boolean source = type.endsWith("Source");
            if (!source && (inputs == null || inputs.isEmpty())) throw ApiError.badRequest("node '" + body.get("Name").asText() + "' (" + type + ") has no inputs");
            if (source && inputs != null && !inputs.isEmpty()) throw ApiError.badRequest("source '" + body.get("Name").asText() + "' cannot have inputs");
        }
    }

    // ---- io helpers ------------------------------------------------------------------------------

    public JsonNode readJson(Path p) {
        if (!Files.exists(p)) return null;
        try { return json.readTree(Files.readString(p)); }
        catch (IOException e) { throw new ApiError(500, p.getFileName() + " is not valid JSON: " + e.getMessage()); }
    }

    public static String readText(Path p) {
        if (!Files.exists(p)) return null;
        try { return Files.readString(p); } catch (IOException e) { return null; }
    }

    String pretty(JsonNode n) {
        try { return json.writerWithDefaultPrettyPrinter().writeValueAsString(n); }
        catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new ApiError(500, "cannot serialise: " + e.getMessage()); }
    }
}
