package ai.oya.keel;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Which CLIs are on PATH. Cached a minute; the empty states that name a missing tool read this. */
@Component
public class Tools {
    public record Tool(boolean installed, String version) {}

    private Map<String, Tool> cache = Map.of();
    private Instant at = Instant.EPOCH;

    public synchronized Map<String, Tool> detect() {
        if (Instant.now().isBefore(at.plusSeconds(60))) return cache;
        Map<String, Tool> m = new LinkedHashMap<>();
        m.put("claude", probe("claude", "--version"));
        m.put("aws", probe("aws", "--version"));
        m.put("docker", probe("docker", "--version"));
        m.put("git", probe("git", "--version"));
        cache = m;
        at = Instant.now();
        return m;
    }

    public boolean has(String tool) { return detect().getOrDefault(tool, new Tool(false, null)).installed(); }

    private static Tool probe(String bin, String flag) {
        Proc.Result r = Proc.run(null, 10, null, bin, flag);
        if (r.code() == 127 || r.timedOut()) return new Tool(false, null);
        String v = (r.stdout() + r.stderr()).strip();
        int nl = v.indexOf('\n');
        return new Tool(true, nl > 0 ? v.substring(0, nl) : v);
    }
}
