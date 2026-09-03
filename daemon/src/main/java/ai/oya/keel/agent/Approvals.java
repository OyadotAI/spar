package ai.oya.keel.agent;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import ai.oya.keel.State;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The gate. Claude Code blocks on the PreToolUse hook; the hook POSTs here; this waits (up to
 * {@link Hook#DAEMON_WAIT_SECONDS}) for the person to answer in the app. Every way that wait can
 * fail returns an empty body, which the hook turns into "no opinion" — failing open to the
 * allowlist, exactly like v1. A question (`AskUserQuestion`, or the `ask_user` MCP tool) travels
 * the same queue and comes back as a deny whose reason is the answer, never short-circuited by
 * trust, because a question is not a permission.
 */
@RestController
public class Approvals {
    public record HookInput(@JsonProperty("tool_name") String toolName, @JsonProperty("tool_input") JsonNode toolInput,
                            @JsonProperty("tool_use_id") String toolUseId, @JsonProperty("session_id") String sessionId) {}

    public record Pending(String id, String lane, String tool, String command, List<String> rules, JsonNode input,
                          String sessionId, Instant createdAt) {}

    public record Answer(String id, String decision, List<String> rules, String scope, String answer) {}

    record Decision(boolean allow, String reason, String answer) {}

    private final State state;
    private final Events events;
    private final ObjectMapper json;
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();
    private final Map<String, CompletableFuture<Decision>> waiters = new ConcurrentHashMap<>();
    private final Map<String, List<String>> sessionRules = new ConcurrentHashMap<>();

    public Approvals(State state, Events events, ObjectMapper json) {
        this.state = state; this.events = events; this.json = json;
    }

    @PostMapping(value = "/api/approve/ask", produces = "application/json")
    public ResponseEntity<String> ask(@RequestParam(defaultValue = "") String lane, @RequestBody HookInput in) {
        String tool = in.toolName() == null ? "" : in.toolName();
        JsonNode input = in.toolInput() == null ? json.createObjectNode() : in.toolInput();
        String command = tool.equals("Bash") ? input.path("command").asText("") : "";
        List<String> rules = rulesFor(tool, input);
        boolean question = tool.equals("AskUserQuestion");
        if (!question) {
            if (trusted()) return ResponseEntity.ok("");
            List<String> allowed = new ArrayList<>(projectRules());
            if (in.sessionId() != null) allowed.addAll(sessionRules.getOrDefault(in.sessionId(), List.of()));
            for (String r : allowed) if (matches(r, tool, command)) return ResponseEntity.ok(allowJson("allowed by rule " + r));
        }
        Decision d = wait(new Pending(UUID.randomUUID().toString(), lane, tool, command, rules, input,
                in.sessionId() == null ? "" : in.sessionId(), Instant.now()));
        if (d == null) return ResponseEntity.ok(""); // nobody answered: defer to the allowlist, say nothing
        if (question) return ResponseEntity.ok(denyJson(d.answer() == null || d.answer().isBlank() ? "The person did not answer." : d.answer()));
        return ResponseEntity.ok(d.allow() ? allowJson("approved in Keel") : denyJson("The person declined this in Keel" + (d.reason() == null || d.reason().isBlank() ? "." : ": " + d.reason())));
    }

    /** Blocks the calling (virtual) thread until answered or the wait runs out. Package-private for the MCP tool. */
    Decision wait(Pending p) {
        CompletableFuture<Decision> f = new CompletableFuture<>();
        waiters.put(p.id(), f);
        pending.put(p.id(), p);
        events.emit("pending", Map.of("lane", p.lane(), "id", p.id()));
        try {
            return f.get(Hook.DAEMON_WAIT_SECONDS, TimeUnit.SECONDS);
        } catch (TimeoutException | InterruptedException | ExecutionException e) {
            return null;
        } finally {
            waiters.remove(p.id());
            pending.remove(p.id());
            events.emit("pending", Map.of("lane", p.lane(), "id", p.id(), "gone", true));
        }
    }

    @GetMapping("/api/approve/poll")
    public List<Pending> poll(@RequestParam(defaultValue = "") String lane) { // no-blocking: memory only
        List<Pending> out = new ArrayList<>();
        for (Pending p : pending.values()) if (lane.isEmpty() || lane.equals(p.lane()) || p.lane().isEmpty()) out.add(p);
        out.sort((a, b) -> a.createdAt().compareTo(b.createdAt()));
        return out;
    }

    @PostMapping("/api/approve/answer")
    public Map<String, Object> answer(@RequestBody Answer a) {
        CompletableFuture<Decision> f = waiters.get(a.id());
        if (f == null) throw ApiError.notFound("that question is no longer waiting");
        boolean allow = "allow".equals(a.decision());
        if (allow && a.rules() != null && !a.rules().isEmpty()) {
            Pending p = pending.get(a.id());
            if ("session".equals(a.scope())) {
                if (p == null || p.sessionId().isEmpty()) throw ApiError.badRequest("a session-scoped rule needs a conversation to belong to");
                sessionRules.computeIfAbsent(p.sessionId(), k -> new java.util.concurrent.CopyOnWriteArrayList<>()).addAll(a.rules());
            } else if ("trust".equals(a.scope())) {
                setTrusted(true);
            } else {
                addProjectRules(a.rules());
            }
        }
        f.complete(new Decision(allow, a.answer(), a.answer()));
        return Map.of("ok", true);
    }

    // ---- rules --------------------------------------------------------------------------------------

    /** The rule that would let this exact call through next time, in Claude Code's own syntax. */
    public static List<String> rulesFor(String tool, JsonNode input) {
        if (!tool.equals("Bash")) return List.of(tool);
        String cmd = input.path("command").asText("").strip();
        if (cmd.isEmpty()) return List.of("Bash");
        String[] words = cmd.split("\\s+");
        List<String> out = new ArrayList<>();
        if (words.length >= 2 && !words[1].startsWith("-") && !words[1].contains("/")) out.add("Bash(" + words[0] + " " + words[1] + "*)");
        out.add("Bash(" + words[0] + "*)");
        return out;
    }

    static boolean matches(String rule, String tool, String command) {
        if (rule.equals(tool)) return true;
        int paren = rule.indexOf('(');
        if (paren < 0 || !rule.endsWith(")") || !rule.substring(0, paren).equals(tool)) return false;
        String pattern = rule.substring(paren + 1, rule.length() - 1);
        if (!tool.equals("Bash")) return true;
        if (pattern.endsWith("*")) return command.startsWith(pattern.substring(0, pattern.length() - 1));
        return command.equals(pattern);
    }

    public List<String> allowRulesFor(String sessionId) {
        List<String> out = new ArrayList<>(projectRules());
        if (sessionId != null) out.addAll(sessionRules.getOrDefault(sessionId, List.of()));
        return out;
    }

    private Path permissionsFile() { return state.sparDir().resolve("permissions.json"); }

    private synchronized ObjectNode permissions() {
        try {
            Path f = permissionsFile();
            if (Files.exists(f)) return (ObjectNode) json.readTree(Files.readString(f));
        } catch (IOException | ClassCastException ignored) { }
        ObjectNode n = json.createObjectNode();
        n.putArray("allow");
        n.put("trusted", false);
        return n;
    }

    private synchronized void save(ObjectNode n) {
        try {
            Files.createDirectories(permissionsFile().getParent());
            Files.writeString(permissionsFile(), json.writerWithDefaultPrettyPrinter().writeValueAsString(n));
        } catch (IOException e) { throw new ApiError(500, "cannot write permissions.json: " + e.getMessage()); }
    }

    public List<String> projectRules() {
        List<String> out = new ArrayList<>();
        for (JsonNode r : permissions().path("allow")) out.add(r.asText());
        return out;
    }

    public boolean trusted() { return permissions().path("trusted").asBoolean(false); }

    public void setTrusted(boolean t) { ObjectNode n = permissions(); n.put("trusted", t); save(n); events.emit("state.changed", state.asMap()); }

    private void addProjectRules(List<String> rules) {
        ObjectNode n = permissions();
        ArrayNode allow = n.withArray("allow");
        List<String> have = new ArrayList<>();
        allow.forEach(x -> have.add(x.asText()));
        for (String r : rules) if (!have.contains(r)) allow.add(r);
        save(n);
    }

    private String allowJson(String reason) { return decision("allow", reason); }
    private String denyJson(String reason) { return decision("deny", reason); }

    private String decision(String d, String reason) {
        ObjectNode out = json.createObjectNode();
        ObjectNode h = out.putObject("hookSpecificOutput");
        h.put("hookEventName", "PreToolUse");
        h.put("permissionDecision", d);
        h.put("permissionDecisionReason", reason);
        return out.toString();
    }
}
