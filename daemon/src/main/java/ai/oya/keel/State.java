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

    public State(@Value("${keel.project}") String project, ObjectMapper json) {
        this.project = Path.of(project).toAbsolutePath().normalize();
        this.file = this.project.resolve(".keel").resolve("state.json");
        this.json = json;
        this.data = load();
    }

    public Path project() { return project; }
    /** `.keel/` with the `.gitignore` that keeps Keel's records out of the project's commits, made on first touch. */
    public Path keelDir() {
        Path d = project.resolve(".keel");
        Path gi = d.resolve(".gitignore");
        if (!Files.exists(gi)) {
            try { Files.createDirectories(d); Files.writeString(gi, "*\n"); } catch (IOException ignored) { /* a read-only project still works */ }
        }
        return d;
    }

    public synchronized String profile() { return text("profile"); }
    public synchronized String region() { return text("region"); }
    public synchronized String scriptBucket() { return text("scriptBucket"); }
    public synchronized String installId() {
        String id = text("installId");
        if (id == null) { id = UUID.randomUUID().toString().substring(0, 8); data.put("installId", id); save(); }
        return id;
    }

    public synchronized void set(String profile, String region, String scriptBucket) {
        if (profile != null) data.put("profile", profile);
        if (region != null) data.put("region", region);
        if (scriptBucket != null) data.put("scriptBucket", scriptBucket);
        save();
    }

    public synchronized Map<String, Object> asMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("project", project.toString());
        m.put("profile", profile());
        m.put("region", region());
        m.put("scriptBucket", scriptBucket());
        m.put("installId", installId());
        return m;
    }

    private String text(String k) { return data.hasNonNull(k) ? data.get(k).asText() : null; }

    private ObjectNode load() {
        try {
            if (Files.exists(file)) return (ObjectNode) json.readTree(Files.readString(file));
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
