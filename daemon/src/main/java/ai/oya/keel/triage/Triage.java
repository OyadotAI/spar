package ai.oya.keel.triage;

import ai.oya.keel.aws.GlueService;
import ai.oya.keel.aws.LogsService;
import ai.oya.keel.aws.RunInfo;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * A failed run, explained before anyone opens a log.
 *
 * Two things go out here. The first is the signature match: what the error really is, with the
 * line that proves it. The second is where this job's log lines actually go — the top-voted
 * unanswered question about Glue is "where did my print statement end up", and the answer depends
 * on flags the job itself carries, so it can be computed rather than recited.
 */
@RestController
public class Triage {
    private final GlueService glue;
    private final LogsService logs;

    public Triage(GlueService glue, LogsService logs) { this.glue = glue; this.logs = logs; }

    @GetMapping("/api/glue/jobs/{name}/runs/{id}/triage")
    public Map<String, Object> triage(@PathVariable String name, @PathVariable String id) {
        RunInfo run = glue.run(name, id);
        String tail = "";
        try {
            List<LogsService.Line> lines = logs.tail(id, 200, "error", null);
            StringBuilder b = new StringBuilder();
            for (LogsService.Line l : lines) b.append(l.message()).append('\n');
            tail = b.toString();
        } catch (RuntimeException e) {
            tail = "no log streams: " + e.getMessage(); // itself a signature
        }
        List<Map<String, Object>> matches = new ArrayList<>();
        for (Signatures.Match m : Signatures.match(run.errorMessage(), tail, run.state())) matches.add(m.asMap());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("run", id);
        out.put("state", run.state());
        out.put("error", run.errorMessage());
        out.put("matches", matches);
        out.put("logs", where(name, run));
        out.put("note", matches.isEmpty()
                ? "No rule recognised this failure. Ask the debugging agent — it has the run and its logs."
                : "Ranked by confidence. The evidence is the line each rule matched.");
        return out;
    }

    /** Where this job's output goes, from the job's own arguments rather than from the documentation. */
    @GetMapping("/api/glue/jobs/{name}/logs/where")
    public Map<String, Object> where(@PathVariable String name) { return where(name, null); }

    private Map<String, Object> where(String name, RunInfo run) {
        JsonNode def = glue.getJobJson(name);
        JsonNode args = def.path("DefaultArguments");
        String version = def.path("GlueVersion").asText(run == null ? "" : String.valueOf(run.glueVersion()));
        boolean continuous = "true".equals(args.path("--enable-continuous-cloudwatch-log").asText(null))
                || (run != null && run.arguments() != null && "true".equals(run.arguments().get("--enable-continuous-cloudwatch-log")));
        boolean modern = version != null && !version.isBlank() && version.compareTo("4.0") >= 0;
        List<Map<String, String>> rows = new ArrayList<>();
        if (continuous) {
            rows.add(row("print() and stdout", "/aws-glue/jobs/output", "the driver stream, named after the run id"));
            rows.add(row("logging / get_logger()", "/aws-glue/jobs/logs-v2", "the continuous stream, live while the run is going"));
            rows.add(row("stderr, Spark and the exception", "/aws-glue/jobs/error", "where a failure's traceback lands"));
        } else {
            rows.add(row("print() and stdout", "/aws-glue/jobs/output", "written when the run ends, not while it runs"));
            rows.add(row("stderr, Spark and the exception", "/aws-glue/jobs/error", "where a failure's traceback lands"));
            rows.add(row("logging / get_logger()", "/aws-glue/jobs/error", "without continuous logging, the Glue logger goes to the error group"));
        }
        rows.add(row("an executor's output", "same group, stream <run id>_g-<executor>", "one stream per executor; the suffix is the executor id, not a timestamp"));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("continuous", continuous);
        m.put("glueVersion", version);
        m.put("rows", rows);
        if (modern) m.put("note", "Glue 5.0 removed continuous CloudWatch logging. Setting the flag on a 5.0 job does nothing.");
        return m;
    }

    private static Map<String, String> row(String what, String group, String detail) {
        return Map.of("what", what, "group", group, "detail", detail);
    }
}
