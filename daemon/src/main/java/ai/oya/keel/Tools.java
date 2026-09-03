package ai.oya.keel;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Which CLIs are on PATH. Cached a minute; the empty states that name a missing tool read this. */
@Component
public class Tools {
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Tool(boolean installed, String version, Boolean loggedIn, String authMethod) {
        public Tool(boolean installed, String version) {
            this(installed, version, null, null);
        }
    }

    private Map<String, Tool> cache = Map.of();
    private Instant at = Instant.EPOCH;

    public synchronized Map<String, Tool> detect() {
        if (Instant.now().isBefore(at.plusSeconds(60))) return cache;
        Map<String, Tool> m = new LinkedHashMap<>();
        m.put("claude", probeClaude());
        m.put("aws", probe("aws", "--version"));
        m.put("docker", probe("docker", "--version"));
        m.put("git", probe("git", "--version"));
        cache = m;
        at = Instant.now();
        return m;
    }

    public boolean has(String tool) { return detect().getOrDefault(tool, new Tool(false, null)).installed(); }

    public static String claudeExe() {
        return System.getProperty("os.name", "").toLowerCase().contains("win") ? "claude.cmd" : "claude";
    }

    private static Tool probeClaude() {
        String exe = claudeExe();
        Tool base = probe(exe, "--version");
        if (!base.installed()) return base;
        Proc.Result auth = Proc.run(null, 5, null, exe, "auth", "status");
        if (auth.timedOut() || auth.code() == 127) return base;
        String raw = (auth.stdout() + auth.stderr()).strip();
        Boolean loggedIn = null;
        String authMethod = null;
        if (raw.contains("\"loggedIn\": true") || raw.contains("\"loggedIn\":true")) {
            loggedIn = true;
        } else if (raw.contains("\"loggedIn\": false") || raw.contains("\"loggedIn\":false")) {
            loggedIn = false;
        }
        if (raw.contains("\"authMethod\":")) {
            java.util.regex.Matcher mat = java.util.regex.Pattern.compile("\"authMethod\"\\s*:\\s*\"([^\"]+)\"").matcher(raw);
            if (mat.find()) authMethod = mat.group(1);
        }
        return new Tool(true, base.version(), loggedIn, authMethod);
    }

    private static Tool probe(String bin, String flag) {
        Proc.Result r = Proc.run(null, 10, null, bin, flag);
        if (r.code() == 127 || r.timedOut()) return new Tool(false, null);
        String v = (r.stdout() + r.stderr()).strip();
        int nl = v.indexOf('\n');
        return new Tool(true, nl > 0 ? v.substring(0, nl) : v);
    }
}
