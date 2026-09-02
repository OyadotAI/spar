package ai.oya.keel.agent;

import ai.oya.keel.ApiError;
import ai.oya.keel.Events;
import ai.oya.keel.Proc;
import ai.oya.keel.State;
import ai.oya.keel.git.Git;
import ai.oya.keel.git.Lanes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * One turn = one `claude -p`, streamed to the window line for line. The daemon owns the process:
 * one turn per lane at a time, a snapshot before, the files it moved and a checkpoint commit
 * after, and Stop is SIGINT (SIGTERM makes the CLI exit 143 and abandon the turn).
 */
@RestController
public class ClaudeRunner {
    /** Something that runs after the agent has stopped and before the commit — the gate lives here. */
    public interface AfterTurn { void afterTurn(String job, Path cwd, Turns.Record record, List<String> files); }

    private record Running(Process process, String turn, AtomicBoolean clientGone) {}

    private final State state;
    private final Events events;
    private final Approvals approvals;
    private final Turns turns;
    private final Lanes lanes;
    private final Prompts prompts;
    private final ObjectMapper json;
    private final WebServerApplicationContext server;
    private final List<AfterTurn> afterTurns;
    private final Map<String, Running> running = new ConcurrentHashMap<>();
    private final Map<String, String> sessions = new ConcurrentHashMap<>();

    public ClaudeRunner(State state, Events events, Approvals approvals, Turns turns, Lanes lanes, Prompts prompts,
                        ObjectMapper json, WebServerApplicationContext server, List<AfterTurn> afterTurns) {
        this.state = state; this.events = events; this.approvals = approvals; this.turns = turns; this.lanes = lanes;
        this.prompts = prompts; this.json = json; this.server = server; this.afterTurns = afterTurns;
    }

    private int port() { return server.getWebServer().getPort(); }

    @GetMapping("/api/chat")
    public SseEmitter chat(@RequestParam String job, @RequestParam(defaultValue = "debug") String mode, @RequestParam String prompt,
                           @RequestParam(required = false) String session, @RequestParam(required = false) String run,
                           @RequestParam(defaultValue = "acceptEdits") String permission, @RequestParam(required = false) String model) {
        if (!job.matches("[A-Za-z0-9._-]+")) throw ApiError.badRequest("job names are letters, digits, dot, dash, underscore");
        if (prompt.isBlank()) throw ApiError.badRequest("an empty prompt");
        String lane = mode.equals("debug") ? job + "~debug" : job;
        if (running.containsKey(lane)) throw ApiError.conflict("a turn is already running for " + job);
        SseEmitter e = new SseEmitter(0L);
        AtomicBoolean gone = new AtomicBoolean(false);
        e.onCompletion(() -> gone.set(true));
        e.onTimeout(() -> gone.set(true));
        e.onError(t -> gone.set(true));
        String resume = session != null && !session.isBlank() ? session : sessions.get(lane);
        Thread.ofVirtual().name("turn-" + lane).start(() -> turn(e, gone, lane, job, mode, prompt, resume, run, permission, model));
        return e;
    }

    @PostMapping("/api/chat/stop")
    public Map<String, Object> stop(@RequestParam String job, @RequestParam(defaultValue = "debug") String mode) {
        String lane = mode.equals("debug") ? job + "~debug" : job;
        Running r = running.get(lane);
        if (r == null) return Map.of("stopped", false);
        interrupt(r.process());
        return Map.of("stopped", true);
    }

    /** SIGINT where there is one; Windows has no interrupt for a child, so a kill is the best available. */
    static void interrupt(Process p) {
        boolean win = System.getProperty("os.name", "").toLowerCase().contains("win");
        if (!win && Proc.run(null, 5, null, "kill", "-INT", Long.toString(p.pid())).ok()) {
            Thread.ofVirtual().start(() -> {
                try { Thread.sleep(5000); } catch (InterruptedException ignored) { return; }
                if (p.isAlive()) { p.descendants().forEach(ProcessHandle::destroyForcibly); p.destroyForcibly(); }
            });
        } else { // ponytail: Windows stop is a kill, not an interrupt; GenerateConsoleCtrlEvent via JNA if it matters
            p.descendants().forEach(ProcessHandle::destroyForcibly);
            p.destroyForcibly();
        }
    }

    private void turn(SseEmitter e, AtomicBoolean gone, String lane, String job, String mode, String prompt, String session,
                      String runId, String permission, String model) {
        send(e, gone, "starting", Map.of("lane", lane, "mode", mode));
        Turns.Record rec = new Turns.Record();
        rec.turn = UUID.randomUUID().toString();
        rec.job = job; rec.mode = mode; rec.session = session;
        rec.prompt = prompt.length() > 200 ? prompt.substring(0, 200) : prompt;
        rec.started = Instant.now().toString();
        Path root = state.project();
        Path cwd;
        try {
            cwd = mode.equals("author") ? lanes.ensure(job) : lanes.dirFor(job);
        } catch (RuntimeException ex) {
            send(e, gone, "fatal", Map.of("text", "cannot prepare the working tree: " + ex.getMessage()));
            e.complete();
            return;
        }
        boolean repo = Git.isRepo(cwd);
        rec.snapshot = repo ? Git.snapshot(cwd) : null;
        turns.emit(rec, "started", Map.of("started", rec.started, "snapshot", rec.snapshot == null ? "" : rec.snapshot, "prompt", rec.prompt));

        String profile = state.profile() == null ? "" : state.profile();
        String region = state.region() == null ? "" : state.region();
        String system;
        try { system = prompts.build(mode, job, runId, cwd, root, port(), profile, region); }
        catch (RuntimeException ex) { system = "Keel could not gather context: " + ex.getMessage(); }

        List<String> cmd = new ArrayList<>(List.of(claudeExe(), "-p", prompt, "--output-format", "stream-json", "--verbose",
                "--include-partial-messages", "--permission-mode", permission.equals("plan") ? "plan" : "acceptEdits",
                "--settings", Hook.settingsJson(json, port(), lane, approvals.allowRulesFor(session), approvals.trusted()),
                "--mcp-config", Hook.mcpConfig(port(), lane),
                "--append-system-prompt", system));
        if (!cwd.equals(root)) { cmd.add("--add-dir"); cmd.add(root.toString()); }
        if (session != null && !session.isBlank()) { cmd.add("--resume"); cmd.add(session); }
        if (model != null && !model.isBlank()) { cmd.add("--model"); cmd.add(model); }
        Map<String, String> env = new HashMap<>();
        if (!profile.isEmpty()) env.put("AWS_PROFILE", profile);
        if (!region.isEmpty()) env.put("AWS_REGION", region);
        env.put("KEEL_PORT", Integer.toString(port()));
        env.put("KEEL_JOB", job);

        Process p;
        try { p = Proc.start(cwd, env, cmd.toArray(String[]::new)); }
        catch (IOException ex) {
            send(e, gone, "fatal", Map.of("text", "could not start claude: " + ex.getMessage() + ". Is Claude Code installed and on PATH?"));
            e.complete();
            return;
        }
        running.put(lane, new Running(p, rec.turn, gone));
        Deque<String> stderr = new ArrayDeque<>();
        Thread te = Proc.drain(p.getErrorStream(), l -> { synchronized (stderr) { stderr.add(l); if (stderr.size() > 200) stderr.removeFirst(); } });
        Map<String, Object> usage = new LinkedHashMap<>();
        Thread to = Proc.drain(p.getInputStream(), line -> {
            if (gone.get()) { interrupt(p); return; }
            sendRaw(e, gone, "msg", line);
            decode(json, line, usage, sid -> { sessions.put(lane, sid); rec.session = sid; });
        });
        int code;
        try { code = p.waitFor(); } catch (InterruptedException ex) { Thread.currentThread().interrupt(); code = -1; }
        try { to.join(5000); te.join(5000); } catch (InterruptedException ignored) { }
        running.remove(lane);

        if (code != 0) {
            List<String> tail; synchronized (stderr) { tail = new ArrayList<>(stderr); }
            String text = tail.isEmpty() ? "claude exited with code " + code + " and printed nothing. Try `claude -p hi` in the terminal."
                    : "claude exited with code " + code + ":\n" + String.join("\n", tail.subList(Math.max(0, tail.size() - 8), tail.size()));
            rec.failed = Map.of("code", code, "tail", text);
            send(e, gone, "fatal", Map.of("text", text));
        }

        // after the turn: what moved, the gate, the checkpoint
        if (repo) {
            String after = Git.snapshot(cwd);
            rec.files = Git.changed(cwd, rec.snapshot, after);
            turns.emit(rec, "files", Map.of("files", rec.files));
            for (AfterTurn a : afterTurns) {
                try { a.afterTurn(job, cwd, rec, rec.files); if (rec.gate != null) turns.emit(rec, "gate", rec.gate); }
                catch (RuntimeException ex) { turns.emit(rec, "gate", Map.of("status", "error", "message", String.valueOf(ex.getMessage()))); }
            }
            boolean gateFailed = rec.gate != null && "failed".equals(rec.gate.get("status"));
            if (!rec.files.isEmpty() && !gateFailed) {
                try {
                    rec.commit = Git.commitAll(cwd, "keel: " + (prompt.length() > 60 ? prompt.substring(0, 60) + "…" : prompt).replace('\n', ' '));
                    if (rec.commit != null) turns.emit(rec, "commit", Map.of("commit", rec.commit));
                } catch (RuntimeException ex) { turns.emit(rec, "commit", Map.of("error", String.valueOf(ex.getMessage()))); }
            }
            events.emit("git.changed", Map.of("lane", job));
            if (rec.files.stream().anyMatch(f -> f.startsWith("jobs/"))) events.emit("job.changed", Map.of("name", job, "files", rec.files));
        }
        if (!usage.isEmpty()) { rec.usage = usage; turns.emit(rec, "usage", usage); }
        rec.ended = Instant.now().toString();
        rec.ms = Instant.parse(rec.ended).toEpochMilli() - Instant.parse(rec.started).toEpochMilli();
        turns.emit(rec, "ended", Map.of("ended", rec.ended, "ms", rec.ms, "code", code));
        Map<String, Object> done = new LinkedHashMap<>();
        done.put("code", code);
        done.put("session", rec.session == null ? "" : rec.session);
        send(e, gone, "done", done);
        e.complete();
    }

    /** The two lines the daemon reads for itself: the session id at `init`, the usage and cost at `result`. */
    static void decode(ObjectMapper json, String line, Map<String, Object> usage, java.util.function.Consumer<String> session) {
        if (line.contains("\"subtype\":\"init\"")) {
            try { String sid = json.readTree(line).path("session_id").asText(""); if (!sid.isEmpty()) session.accept(sid); }
            catch (IOException ignored) { }
        } else if (line.contains("\"type\":\"result\"")) {
            try {
                JsonNode r = json.readTree(line);
                if (!"result".equals(r.path("type").asText())) return;
                JsonNode u = r.path("usage");
                usage.put("input", u.path("input_tokens").asLong());
                usage.put("output", u.path("output_tokens").asLong());
                usage.put("cacheRead", u.path("cache_read_input_tokens").asLong());
                usage.put("cacheWrite", u.path("cache_creation_input_tokens").asLong());
                usage.put("costUsd", r.path("total_cost_usd").asDouble());
                usage.put("durationMs", r.path("duration_ms").asLong());
                if (r.path("is_error").asBoolean(false)) usage.put("error", r.path("result").asText(""));
            } catch (IOException ignored) { }
        }
    }

    static String claudeExe() {
        return System.getProperty("os.name", "").toLowerCase().contains("win") ? "claude.cmd" : "claude";
    }

    private void send(SseEmitter e, AtomicBoolean gone, String name, Object data) {
        if (gone.get()) return;
        try { e.send(SseEmitter.event().name(name).data(data)); }
        catch (IOException | IllegalStateException ex) { gone.set(true); }
    }

    private void sendRaw(SseEmitter e, AtomicBoolean gone, String name, String line) {
        if (gone.get()) return;
        try { e.send(SseEmitter.event().name(name).data(line, org.springframework.http.MediaType.TEXT_PLAIN)); }
        catch (IOException | IllegalStateException ex) { gone.set(true); }
    }
}
