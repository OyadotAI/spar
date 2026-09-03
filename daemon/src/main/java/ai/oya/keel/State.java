package ai.oya.keel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The little that persists across launches, in `<project>/.keel/state.json`: which profile and
 * region the person picked, the bucket scripts go to, and an id for this install (the SQS queue
 * and EventBridge rules are named after it so two machines never share one).
 */
@Component
public class State {
    private final Path project;
    private final Path file;
    private final ObjectMapper json;
    private ObjectNode data;

    /** True when the daemon was started without a real project; every project-scoped path is refused. */
    private final boolean placeholder;

    public State(@Value("${keel.project}") String project, ObjectMapper json) {
        this.project = Path.of(project == null || project.isBlank() ? "." : project).toAbsolutePath().normalize();
        this.placeholder = project == null || project.isBlank() || isUnsafe(this.project);
        Path sparState = this.project.resolve(".spar").resolve("state.json");
        Path legacyState = this.project.resolve(".keel").resolve("state.json");
        this.file = Files.exists(sparState) || !Files.exists(legacyState) ? sparState : legacyState;
        this.json = json;
        this.data = load();
    }

    public Path project() {
        if (placeholder) throw new ApiError(400, "no project folder chosen", "choose a folder for your Glue jobs");
        return project;
    }

    public boolean hasProject() { return !placeholder; }

    /**
     * Somewhere SparData must never write. It creates `jobs/`, `.spar/` and a git repository in the
     * project, so a home directory or a filesystem root is a refusal, not a default.
     */
    static boolean isUnsafe(Path p) {
        Path home = Path.of(System.getProperty("user.home", "/")).toAbsolutePath().normalize();
        return p.equals(home) || p.getParent() == null || p.equals(p.getRoot());
    }
    /** `.spar/` with the `.gitignore` that keeps SparData's records out of the project's commits, made on first touch. */
    public Path sparDir() {
        Path d = project().resolve(".spar");
        Path gi = d.resolve(".gitignore");
        if (!Files.exists(gi)) {
            try { Files.createDirectories(d); Files.writeString(gi, "*\n"); } catch (IOException ignored) { /* a read-only project still works */ }
        }
        return d;
    }

    public Path keelDir() { return sparDir(); }

    public synchronized String profile() { return text("profile"); }
    public synchronized String region() { return text("region"); }
    public synchronized String scriptBucket() { return text("scriptBucket"); }
    public synchronized String installId() {
        String id = text("installId");
        if (id == null) {
            id = UUID.randomUUID().toString().substring(0, 8);
            if (placeholder) return id; // nothing is written until a project is chosen
            data.put("installId", id);
            save();
        }
        return id;
    }

    public synchronized void set(String profile, String region, String scriptBucket) {
        if (placeholder) throw new ApiError(400, "no project folder chosen", "choose a folder for your Glue jobs first");
        if (profile != null) data.put("profile", profile);
        if (region != null) data.put("region", region);
        if (scriptBucket != null) data.put("scriptBucket", scriptBucket);
        save();
    }

    /**
     * Which tiers of AWS access this install is allowed to use. Read is always on; the rest are
     * off until somebody turns them on, and the daemon refuses the matching calls before they
     * leave the machine — so a read-only install cannot mutate an account even with credentials
     * that would allow it.
     */
    public synchronized boolean tier(String name) {
        if ("read".equals(name)) return true;
        return data.path("tiers").path(name).asBoolean(false);
    }

    public synchronized Map<String, Object> tiers() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("read", true);
        for (String t : TIERS) m.put(t, tier(t));
        return m;
    }

    /** The optional tiers, in the order the UI shows them. */
    public static final java.util.List<String> TIERS = java.util.List.of("author", "operate", "live", "roleGrant");

    public synchronized void setTier(String name, boolean on) {
        if (!TIERS.contains(name)) throw ApiError.badRequest("no such tier: " + name);
        if (placeholder) throw new ApiError(400, "no project folder chosen", "choose a folder for your Glue jobs first");
        ObjectNode t = data.has("tiers") && data.get("tiers").isObject() ? (ObjectNode) data.get("tiers") : json.createObjectNode();
        t.put(name, on);
        data.set("tiers", t);
        save();
    }

    public synchronized Map<String, Object> asMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("project", placeholder ? null : project.toString());
        m.put("profile", profile());
        m.put("region", region());
        m.put("scriptBucket", scriptBucket());
        m.put("installId", installId());
        m.put("tiers", tiers());
        return m;
    }

    private String text(String k) { return data.hasNonNull(k) ? data.get(k).asText() : null; }

    private ObjectNode load() {
        try {
            if (!placeholder && Files.exists(file)) return (ObjectNode) json.readTree(Files.readString(file));
        } catch (IOException | ClassCastException ignored) {
            // a corrupt state file is a state file we start over from; nothing in it is precious
        }
        return json.createObjectNode();
    }

    private void save() {
        try {
            keelDir();
            Files.writeString(file, json.writerWithDefaultPrettyPrinter().writeValueAsString(data));
        } catch (IOException e) {
            throw new ApiError(500, "cannot write " + file + ": " + e.getMessage());
        }
    }
}
