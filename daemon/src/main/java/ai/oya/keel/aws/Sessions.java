package ai.oya.keel.aws;

import ai.oya.keel.ApiError;
import ai.oya.keel.State;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.glue.model.Session;
import software.amazon.awssdk.services.glue.model.Statement;

/**
 * AWS Glue interactive sessions: a real Spark session in the account, the thing Glue Studio's data
 * preview and its notebooks run on. Keel uses it for what the local container cannot reach — the
 * Data Catalog, JDBC and Redshift sources, VPC connections — and as a REPL beside the canvas.
 * Sessions bill by DPU-hour while they live, so the UI always shows the timeout and a Stop button.
 */
@RestController
public class Sessions {
    private final AwsClients aws;
    private final State state;

    public Sessions(AwsClients aws, State state) { this.aws = aws; this.state = state; }

    public record Create(String id, String role, String glueVersion, String workerType, Integer numberOfWorkers,
                         Integer idleTimeout, List<String> connections, Map<String, String> arguments, String description) {}

    @PostMapping("/api/glue/sessions")
    public Map<String, Object> create(@RequestBody Create c) {
        String role = c.role();
        if (role == null || role.isBlank()) throw new ApiError(400, "an interactive session needs an IAM role", "put the job's role in the field, or set one in Settings");
        String id = c.id() == null || c.id().isBlank() ? "keel-" + state.installId() + "-" + System.currentTimeMillis() % 100000 : c.id();
        Map<String, String> args = new LinkedHashMap<>();
        args.put("--enable-glue-datacatalog", "true");
        if (c.arguments() != null) args.putAll(c.arguments());
        Session s = aws.glue().createSession(b -> {
            b.id(id).role(role).command(x -> x.name("glueetl").pythonVersion("3"))
             .glueVersion(c.glueVersion() == null ? "5.0" : c.glueVersion())
             .workerType(c.workerType() == null ? "G.1X" : c.workerType())
             .numberOfWorkers(c.numberOfWorkers() == null ? 2 : c.numberOfWorkers())
             .idleTimeout(c.idleTimeout() == null ? 30 : c.idleTimeout())
             .defaultArguments(args)
             .description(c.description() == null ? "Keel interactive session" : c.description());
            if (c.connections() != null && !c.connections().isEmpty()) b.connections(x -> x.connections(c.connections()));
        }).session();
        return toMap(s);
    }

    @GetMapping("/api/glue/sessions")
    public List<Map<String, Object>> list(@RequestParam(defaultValue = "false") boolean mine) {
        List<Map<String, Object>> out = new ArrayList<>();
        String prefix = "keel-" + state.installId();
        var r = aws.glue().listSessions(b -> b.maxResults(50));
        for (Session s : r.sessions()) { if (mine && !s.id().startsWith(prefix)) continue; out.add(toMap(s)); }
        out.sort((a, b) -> String.valueOf(b.get("createdOn")).compareTo(String.valueOf(a.get("createdOn"))));
        return out;
    }

    @GetMapping("/api/glue/sessions/{id}")
    public Map<String, Object> get(@PathVariable String id) { return toMap(aws.glue().getSession(b -> b.id(id)).session()); }

    @PostMapping("/api/glue/sessions/{id}/stop")
    public Map<String, Object> stop(@PathVariable String id) {
        try { aws.glue().stopSession(b -> b.id(id)); } catch (software.amazon.awssdk.services.glue.model.IllegalSessionStateException ignored) { }
        return get(id);
    }

    @DeleteMapping("/api/glue/sessions/{id}")
    public Map<String, Object> delete(@PathVariable String id) { aws.glue().deleteSession(b -> b.id(id)); return Map.of("deleted", id); }

    public record Code(String code) {}

    /** Runs one statement and waits for it, the way a notebook cell does. */
    @PostMapping("/api/glue/sessions/{id}/statements")
    public Map<String, Object> run(@PathVariable String id, @RequestBody Code c) {
        if (c.code() == null || c.code().isBlank()) throw ApiError.badRequest("nothing to run");
        double n = aws.glue().runStatement(b -> b.sessionId(id).code(c.code())).id();
        int statement = (int) n;
        long deadline = System.currentTimeMillis() + 15 * 60_000;
        while (System.currentTimeMillis() < deadline) {
            Statement s = aws.glue().getStatement(b -> b.sessionId(id).id(statement)).statement();
            String st = s.stateAsString();
            if ("AVAILABLE".equals(st) || "ERROR".equals(st) || "CANCELLED".equals(st)) return statementMap(s);
            try { Thread.sleep(1000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
        }
        return Map.of("id", statement, "state", "RUNNING", "note", "still running after 15 minutes; poll /statements/" + statement);
    }

    /**
     * Every statement this session has run, oldest first.
     *
     * Glue is the record while the session is alive, so the notebook is read back from the account
     * rather than living in the window — a reload keeps the history, and a session someone else
     * started can be opened and read.
     *
     * The catch, and it is why this returns an object rather than a list: Glue answers
     * ListStatements with a 400 once the session is anything but READY. The history of a stopped
     * session is not retrievable at all, so say that plainly instead of returning an empty list
     * that reads as "nothing ever ran here".
     */
    @GetMapping("/api/glue/sessions/{id}/statements")
    public Map<String, Object> statements(@PathVariable String id) {
        List<Map<String, Object>> out = new ArrayList<>();
        try {
            for (Statement s : aws.glue().listStatements(b -> b.sessionId(id)).statements()) out.add(statementMap(s));
        } catch (software.amazon.awssdk.services.glue.model.GlueException e) {
            // Glue answers "Session is not ready" as a plain 400, not always as
            // IllegalSessionStateException, so match on the status rather than the class.
            if (e.statusCode() != 400) throw e;
            return Map.of("readable", false, "statements", out,
                "why", "Glue serves a session's statement history only while the session is running.");
        }
        out.sort((a, b) -> Double.compare(((Number) a.get("id")).doubleValue(), ((Number) b.get("id")).doubleValue()));
        return Map.of("readable", true, "statements", out);
    }

    @GetMapping("/api/glue/sessions/{id}/statements/{sid}")
    public Map<String, Object> statement(@PathVariable String id, @PathVariable int sid) {
        return statementMap(aws.glue().getStatement(b -> b.sessionId(id).id(sid)).statement());
    }

    @PostMapping("/api/glue/sessions/{id}/statements/{sid}/cancel")
    public Map<String, Object> cancel(@PathVariable String id, @PathVariable int sid) {
        aws.glue().cancelStatement(b -> b.sessionId(id).id(sid));
        return Map.of("cancelled", sid);
    }

    static Map<String, Object> toMap(Session s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", s.id()); m.put("status", s.statusAsString()); m.put("errorMessage", s.errorMessage());
        m.put("createdOn", s.createdOn() == null ? null : s.createdOn().toString());
        m.put("role", s.role()); m.put("glueVersion", s.glueVersion()); m.put("workerType", s.workerTypeAsString());
        m.put("numberOfWorkers", s.numberOfWorkers()); m.put("idleTimeout", s.idleTimeout());
        m.put("dpuSeconds", s.dpuSeconds()); m.put("executionTime", s.executionTime()); m.put("description", s.description());
        return m;
    }

    static Map<String, Object> statementMap(Statement s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", s.id()); m.put("state", s.stateAsString()); m.put("code", s.code()); m.put("progress", s.progress());
        m.put("startedOn", s.startedOn()); m.put("completedOn", s.completedOn());
        if (s.output() != null) {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("status", s.output().statusAsString());
            o.put("errorName", s.output().errorName()); o.put("errorValue", s.output().errorValue());
            o.put("traceback", s.output().traceback());
            if (s.output().data() != null) o.put("text", s.output().data().textPlain());
            m.put("output", o);
        }
        return m;
    }
}
