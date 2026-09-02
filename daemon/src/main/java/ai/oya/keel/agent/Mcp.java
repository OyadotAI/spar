package ai.oya.keel.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Keel's own MCP server over Streamable HTTP, hand-rolled as in v1 (three methods, no SDK). One
 * tool: `ask_user`, which puts a question card in the window and blocks until it is answered — the
 * way a headless `claude -p` can ask a person anything.
 */
@RestController
public class Mcp {
    static final String PROTOCOL = "2025-06-18";
    private final Approvals approvals;
    private final ObjectMapper json;

    public Mcp(Approvals approvals, ObjectMapper json) { this.approvals = approvals; this.json = json; }

    @PostMapping(value = "/mcp", produces = "application/json")
    public ResponseEntity<String> rpc(@RequestParam(defaultValue = "") String lane, @RequestBody JsonNode req) {
        String method = req.path("method").asText("");
        JsonNode id = req.get("id");
        if (method.startsWith("notifications/")) return ResponseEntity.accepted().body("");
        return switch (method) {
            case "initialize" -> ok(id, json.createObjectNode()
                    .put("protocolVersion", PROTOCOL)
                    .<ObjectNode>set("capabilities", json.createObjectNode().set("tools", json.createObjectNode()))
                    .set("serverInfo", json.createObjectNode().put("name", "keel").put("version", "2")));
            case "ping" -> ok(id, json.createObjectNode());
            case "tools/list" -> ok(id, json.createObjectNode().set("tools", json.createArrayNode().add(schema())));
            case "tools/call" -> call(lane, id, req.path("params"));
            default -> err(id, -32601, "unknown method " + method);
        };
    }

    private ResponseEntity<String> call(String lane, JsonNode id, JsonNode params) {
        if (!"ask_user".equals(params.path("name").asText())) return err(id, -32602, "no such tool");
        JsonNode args = params.path("arguments");
        ObjectNode input = json.createObjectNode();
        input.set("questions", args.path("questions"));
        Approvals.Decision d = approvals.wait(new Approvals.Pending(UUID.randomUUID().toString(), lane, "AskUserQuestion", "",
                List.of(), input, "", Instant.now()));
        String text = d == null || d.answer() == null || d.answer().isBlank()
                ? "Nobody answered within " + Hook.DAEMON_WAIT_SECONDS + " seconds. Make the most reasonable choice yourself and say which you made."
                : d.answer();
        ObjectNode result = json.createObjectNode();
        result.putArray("content").add(json.createObjectNode().put("type", "text").put("text", text));
        return ok(id, result);
    }

    ObjectNode schema() {
        ObjectNode t = json.createObjectNode();
        t.put("name", "ask_user");
        t.put("description", "Ask the person a question with options and wait for their answer. Use it when two readings of the request lead to materially different work, or when a decision is theirs (a bucket, a join key, a trade-off). One call may carry up to four questions. The answer comes back as text: the chosen option label(s), or free text.");
        ObjectNode s = t.putObject("inputSchema");
        s.put("type", "object");
        ObjectNode qs = s.putObject("properties").putObject("questions");
        qs.put("type", "array"); qs.put("minItems", 1); qs.put("maxItems", 4);
        ObjectNode item = qs.putObject("items");
        item.put("type", "object");
        ObjectNode ip = item.putObject("properties");
        ip.putObject("question").put("type", "string");
        ip.putObject("header").put("type", "string").put("description", "a short label, max 12 chars");
        ObjectNode opts = ip.putObject("options");
        opts.put("type", "array");
        ObjectNode op = opts.putObject("items"); op.put("type", "object");
        op.putObject("properties").putObject("label").put("type", "string");
        op.path("properties").withObject("description").put("type", "string");
        ((ArrayNode) op.putArray("required")).add("label");
        ip.putObject("multiSelect").put("type", "boolean");
        ((ArrayNode) item.putArray("required")).add("question").add("options");
        ((ArrayNode) s.putArray("required")).add("questions");
        return t;
    }

    private ResponseEntity<String> ok(JsonNode id, JsonNode result) {
        ObjectNode r = json.createObjectNode(); r.put("jsonrpc", "2.0"); r.set("id", id); r.set("result", result);
        return ResponseEntity.ok(r.toString());
    }

    private ResponseEntity<String> err(JsonNode id, int code, String message) {
        ObjectNode r = json.createObjectNode(); r.put("jsonrpc", "2.0"); r.set("id", id);
        r.putObject("error").put("code", code).put("message", message);
        return ResponseEntity.ok(r.toString());
    }
}
