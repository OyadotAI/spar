package ai.oya.keel.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/**
 * The `--settings` JSON handed to `claude`: the allowlist, and a PreToolUse hook that is one
 * `curl` line. Why curl and not a Keel binary: a JVM per tool call is a second of startup each
 * time. Why it fails open: `-f` prints nothing on a non-2xx, `|| true` forces exit 0, and an
 * empty stdout means "no opinion" to Claude Code, which then applies the allowlist. A guardrail
 * that can wedge the agent is one people switch off.
 */
public final class Hook {
    private Hook() {}

    /** The tools a person can meaningfully widen. Reads and edits stay out — edits are `acceptEdits`. */
    public static final String HOOKED_TOOLS = "Bash|WebSearch|WebFetch|AskUserQuestion|Write|Edit|MultiEdit";
    public static final int DAEMON_WAIT_SECONDS = 240;
    public static final int CURL_MAX_TIME = 250;
    public static final int HOOK_TIMEOUT = 270;

    public static String settingsJson(ObjectMapper json, int port, String lane, List<String> allow, boolean trusted) {
        ObjectNode root = json.createObjectNode();
        ArrayNode rules = root.putObject("permissions").putArray("allow");
        for (String r : allow) rules.add(r);
        if (trusted) for (String t : HOOKED_TOOLS.split("\\|")) rules.add(t);
        rules.add("mcp__keel__ask_user");
        ObjectNode hook = json.createObjectNode();
        hook.put("type", "command");
        hook.put("command", command(port, lane));
        hook.put("timeout", HOOK_TIMEOUT);
        ObjectNode entry = json.createObjectNode();
        entry.put("matcher", HOOKED_TOOLS);
        entry.putArray("hooks").add(hook);
        root.putObject("hooks").putArray("PreToolUse").add(entry);
        try { return json.writeValueAsString(root); }
        catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException(e); }
    }

    /** Lane names are validated `[A-Za-z0-9._-]+` upstream, so the URL needs no quoting a shell could misread. */
    public static String command(int port, String lane) {
        String url = "http://127.0.0.1:" + port + "/api/approve/ask?lane=" + java.net.URLEncoder.encode(lane, java.nio.charset.StandardCharsets.UTF_8);
        return "curl -fsS --max-time " + CURL_MAX_TIME + " -H 'Content-Type: application/json' --data-binary @- '" + url + "' || true";
    }

    public static String mcpConfig(int port, String lane) {
        return "{\"mcpServers\":{\"keel\":{\"type\":\"http\",\"url\":\"http://127.0.0.1:" + port + "/mcp?lane="
                + java.net.URLEncoder.encode(lane, java.nio.charset.StandardCharsets.UTF_8) + "\"}}}";
    }
}
