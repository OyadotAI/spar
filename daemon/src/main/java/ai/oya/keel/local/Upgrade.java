package ai.oya.keel.local;

import ai.oya.keel.ApiError;
import ai.oya.keel.aws.GlueService;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * Keel's own upgrade analysis. AWS's Spark Upgrade Analysis is a console feature with no public
 * API in this SDK, so this is not a wrapper: it reads the job definition and the script here,
 * applies the documented Glue 2/3/4 → 5 migration rules, and hands the findings to the agent, which
 * can then rewrite the script and prove it with the tests in the Glue 5 container. Every finding
 * names the file and line it came from.
 */
@RestController
public class Upgrade {
    record Rule(Pattern pattern, String severity, String title, String detail) {}

    /** From "Migrating AWS Glue for Spark jobs to AWS Glue version 5.0" and the Spark 3.5 migration notes. */
    static final List<Rule> RULES = List.of(
            new Rule(Pattern.compile("(?i)\\bfrom\\s+pyspark\\.sql\\.functions\\s+import\\s+\\*"), "info", "Star import from pyspark.sql.functions",
                    "Spark 3.5 renamed and removed functions; a star import hides which ones you use. Import them by name."),
            new Rule(Pattern.compile("\\.toPandas\\(\\)"), "warn", "toPandas()", "Glue 5 ships pandas 2; `toPandas()` output types changed (nullable ints, datetime resolution). Check downstream code."),
            new Rule(Pattern.compile("(?i)spark\\.sql\\.legacy\\."), "warn", "A legacy Spark flag", "Legacy flags are a bridge, not a destination; several were dropped in Spark 3.5. Confirm each one still exists."),
            new Rule(Pattern.compile("(?i)datasource\\s*=|\\bDataSource\\d"), "info", "Classic generated identifiers", "Glue's classic code generator named frames `DataSource0`/`Transform0`. Keel regenerates from the DAG with node-named functions."),
            new Rule(Pattern.compile("(?i)\\bglueparquet\\b"), "info", "glueparquet writer", "The glueparquet format is still supported but has no local test path; plain `parquet` behaves the same for most jobs."),
            new Rule(Pattern.compile("(?i)\\bjson\\.loads\\(.*\\.collect\\(\\)"), "warn", "collect() into the driver", "Glue 5's driver defaults are unchanged, but a collect of a large frame is the most common OOM on a smaller worker."),
            new Rule(Pattern.compile("(?i)\\bpython_?version\\s*=\\s*[\"']2"), "error", "Python 2", "Glue 5 is Python 3.11 only."),
            new Rule(Pattern.compile("(?i)\\bfindspark|\\bpy4j\\.java_gateway"), "warn", "Direct JVM gateway use", "Internal Spark APIs move between versions; prefer the public DataFrame API."),
            new Rule(Pattern.compile("(?i)\\bfrom\\s+awsglue\\.transforms\\s+import\\s+\\*"), "info", "Star import from awsglue.transforms", "Import the transforms you use so a removed one fails at import, not at runtime."),
            new Rule(Pattern.compile("(?i)create_dynamic_frame_from_"), "info", "Deprecated helper name", "`create_dynamic_frame_from_options/catalog` still work; the documented form is `glueContext.create_dynamic_frame.from_*`."),
            new Rule(Pattern.compile("(?i)\\bsc\\s*=\\s*SparkContext\\(\\)"), "info", "SparkContext()", "In Glue 5 use `SparkContext.getOrCreate()`; a second context in one JVM throws."));

    private final Project project;
    private final GlueService glue;

    public Upgrade(Project project, GlueService glue) { this.project = project; this.glue = glue; }

    @GetMapping("/api/jobs/{name}/upgrade")
    public Map<String, Object> analyse(@PathVariable String name) {
        Project.validName(name);
        JsonNode def;
        try { def = glue.getJobJson(name); }
        catch (RuntimeException e) { def = project.readJson(project.dir(name).resolve("job.json")); }
        if (def == null) throw ApiError.notFound("no job definition for " + name);
        String version = def.path("GlueVersion").asText("");
        String worker = def.path("WorkerType").asText("");
        String command = def.path("Command").path("Name").asText("glueetl");
        String script = Project.readText(project.dir(name).resolve("job.py"));
        String source = "jobs/" + name + "/job.py";
        if (script == null) {
            String loc = def.path("Command").path("ScriptLocation").asText("");
            if (!loc.isEmpty()) { try { script = glue.getScript(loc); source = loc; } catch (RuntimeException ignored) { } }
        }
        List<Map<String, Object>> findings = new ArrayList<>();
        double target = 5.0;
        double current = parse(version);
        if (current > 0 && current < target) {
            findings.add(finding("error", "Glue " + version + " → 5.0", null, 0,
                    "Glue 5.0 is Spark 3.5.4 / Python 3.11. From " + version + " that means: Spark's ANSI-adjacent casting changes, "
                            + "pandas 2, and Java 17. Jobs on 2.0/3.0 also lose their old default of Python 3.6/3.7."));
        } else if (current >= target) {
            findings.add(finding("ok", "Already on Glue " + version, null, 0, "Nothing to migrate; the checks below still apply to the script."));
        }
        if (command.equals("pythonshell")) findings.add(finding("info", "Python shell job", null, 0, "Python shell jobs are not Spark; the Spark 3.5 notes below do not apply."));
        if (worker.equals("Standard")) findings.add(finding("error", "Standard worker type", null, 0, "Glue 3.0+ removed the Standard worker. Move to G.1X or G.2X and set NumberOfWorkers."));
        if (def.has("MaxCapacity") && def.hasNonNull("WorkerType")) findings.add(finding("warn", "MaxCapacity and WorkerType together", null, 0, "Glue rejects both; keep WorkerType + NumberOfWorkers."));
        JsonNode args = def.path("DefaultArguments");
        if (args.has("--enable-glue-datacatalog") && !"true".equals(args.path("--enable-glue-datacatalog").asText())) findings.add(finding("info", "Data Catalog as metastore is off", null, 0, "Fine, but catalog reads then need explicit connections."));
        if (!args.has("--enable-metrics")) findings.add(finding("info", "Job metrics are off", null, 0, "Without `--enable-metrics` the Metrics tab has nothing to draw."));
        if (!args.has("--enable-continuous-cloudwatch-log")) findings.add(finding("info", "Continuous logging is off", null, 0, "Logs only arrive at the end of the run, and the console tab stays empty while it runs."));
        if (script != null) {
            String[] lines = script.split("\n");
            for (int i = 0; i < lines.length; i++) {
                for (Rule r : RULES) if (r.pattern().matcher(lines[i]).find()) findings.add(finding(r.severity(), r.title(), source, i + 1, r.detail()));
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("job", name); out.put("glueVersion", version); out.put("target", "5.0"); out.put("workerType", worker); out.put("command", command);
        out.put("script", source); out.put("hasScript", script != null); out.put("findings", findings);
        out.put("counts", Map.of("error", count(findings, "error"), "warn", count(findings, "warn"), "info", count(findings, "info")));
        out.put("prompt", prompt(name, version, findings));
        out.put("note", "This is Keel's own analysis, not the AWS console's Spark Upgrade Analysis (that one has no public API). "
                + "The agent can apply it: it edits the DAG or the script, regenerates, and runs the tests in the Glue 5 container before anything is deployed.");
        return out;
    }

    static String prompt(String job, String version, List<Map<String, Object>> findings) {
        StringBuilder b = new StringBuilder("Upgrade the Glue job `").append(job).append("` from Glue ").append(version.isEmpty() ? "its current version" : version)
                .append(" to Glue 5.0. Work through these findings, smallest change first, and prove each one with the tests:\n\n");
        for (Map<String, Object> f : findings) {
            if ("ok".equals(f.get("severity"))) continue;
            b.append("- [").append(f.get("severity")).append("] ").append(f.get("title"));
            if (f.get("line") != null && !f.get("line").equals(0)) b.append(" (").append(f.get("file")).append(':').append(f.get("line")).append(')');
            b.append(" — ").append(f.get("detail")).append('\n');
        }
        b.append("\nSet GlueVersion to 5.0 in job.json, keep WorkerType/NumberOfWorkers, regenerate, run the tests, and tell me what you changed and what you could not verify locally. Do not deploy.");
        return b.toString();
    }

    private static Map<String, Object> finding(String severity, String title, String file, int line, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("severity", severity); m.put("title", title); m.put("file", file); m.put("line", line); m.put("detail", detail);
        return m;
    }

    private static long count(List<Map<String, Object>> f, String severity) { return f.stream().filter(x -> severity.equals(x.get("severity"))).count(); }

    private static double parse(String v) { try { return Double.parseDouble(v); } catch (RuntimeException e) { return 0; } }
}
