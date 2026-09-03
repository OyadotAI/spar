package ai.oya.keel.agent;

import ai.oya.keel.aws.GlueService;
import ai.oya.keel.aws.JobSummary;
import ai.oya.keel.aws.JobsCache;
import ai.oya.keel.aws.LogsService;
import ai.oya.keel.aws.RunInfo;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * What the agent is told before the person's first word. The daemon does the reading — job
 * definition, the selected run, its error log, the files on disk — so the agent starts with the
 * evidence in front of it instead of spending its first three tool calls finding it.
 */
@Component
public class Prompts {
    private static final Pattern SECRET = Pattern.compile("(?i)(secret|password|passwd|token|api[_-]?key|credential)");

    private final JobsCache cache;
    private final GlueService glue;
    private final LogsService logs;

    public Prompts(JobsCache cache, GlueService glue, LogsService logs) { this.cache = cache; this.glue = glue; this.logs = logs; }

    public String build(String mode, String job, String runId, Path cwd, Path root, int port, String profile, String region) {
        StringBuilder b = new StringBuilder();
        b.append("You are working inside SparData, a desktop tool for AWS Glue jobs. The person is a data engineer looking at the job `")
         .append(job).append("`.\n\n")
         .append("Environment:\n- Project root: ").append(root).append("\n- Working directory: ").append(cwd).append("\n")
         .append("- AWS profile `").append(profile).append("` in `").append(region).append("` is already exported (AWS_PROFILE, AWS_REGION); the `aws` CLI works as-is.\n")
         .append("- SparData's daemon is at http://127.0.0.1:").append(port).append(" (KEEL_PORT).\n")
         .append("- A PreToolUse hook may pause a command until the person approves it in SparData. If a call is declined, that is the answer; do not route around it with another tool or a background shell.\n")
         .append("- SparData commits your changes to git when the turn ends; do not commit yourself.\n")
         .append("- To ask the person something, use the `ask_user` tool rather than guessing.\n\n");
        if ("author".equals(mode)) author(b, job, cwd); else debug(b, job, runId, cwd);
        return b.toString();
    }

    private void debug(StringBuilder b, String job, String runId, Path cwd) {
        b.append("## Your role: debugging agent\nExplain what happened to a run, find the root cause in the logs and the code, and propose the fix as a concrete diff against the job script. ")
         .append("Do not start, stop or update jobs unless the person asks for that in this message. Cite log lines and line numbers.\n\n");
        JobSummary s = cache.get(job);
        b.append("## Job\n");
        if (s != null) {
            b.append(kv("Name", s.name())).append(kv("JobMode", s.jobMode())).append(kv("GlueVersion", s.glueVersion()))
             .append(kv("Command", s.commandName())).append(kv("ScriptLocation", s.scriptLocation()))
             .append(kv("Workers", s.workerType() == null ? null : s.workerType() + " x " + s.numberOfWorkers()))
             .append(kv("Timeout (min)", s.timeout())).append(kv("MaxRetries", s.maxRetries())).append(kv("ExecutionClass", s.executionClass()))
             .append(kv("Role", s.role()));
        }
        try {
            JsonNode j = glue.getJobJson(job);
            JsonNode args = j.path("DefaultArguments");
            if (args.isObject() && args.size() > 0) {
                b.append("DefaultArguments:\n");
                for (Iterator<Map.Entry<String, JsonNode>> it = args.fields(); it.hasNext();) {
                    Map.Entry<String, JsonNode> e = it.next();
                    b.append("  ").append(e.getKey()).append(" = ").append(SECRET.matcher(e.getKey()).find() ? "••••" : e.getValue().asText()).append('\n');
                }
            }
            if (j.has("CodeGenConfigurationNodes")) b.append("This is a visual AWS Glue job with ").append(j.path("CodeGenConfigurationNodes").size()).append(" DAG nodes.\n");
        } catch (RuntimeException e) {
            b.append("(the full job definition could not be read: ").append(e.getMessage()).append(")\n");
        }
        if (runId != null && !runId.isBlank()) {
            b.append("\n## Selected run\n");
            try {
                RunInfo r = glue.run(job, runId);
                b.append(kv("Id", r.id())).append(kv("Attempt", r.attempt())).append(kv("State", r.state())).append(kv("StateDetail", r.stateDetail()))
                 .append(kv("ErrorMessage", r.errorMessage())).append(kv("StartedOn", r.startedOn())).append(kv("CompletedOn", r.completedOn()))
                 .append(kv("ExecutionTime (s)", r.executionTime())).append(kv("DPUSeconds", r.dpuSeconds())).append(kv("LogGroupName", r.logGroupName()))
                 .append(kv("GlueVersion", r.glueVersion())).append(kv("Workers", r.workerType() == null ? null : r.workerType() + " x " + r.numberOfWorkers()));
                if (r.arguments() != null && !r.arguments().isEmpty()) {
                    b.append("Arguments:\n");
                    r.arguments().forEach((k, v) -> b.append("  ").append(k).append(" = ").append(SECRET.matcher(k).find() ? "••••" : v).append('\n'));
                }
                b.append("\n## Last error-log lines of this run (CloudWatch /aws-glue/jobs/error, newest last)\n```\n");
                int n = 0;
                for (LogsService.Line l : logs.tail(runId, 200, "error", null)) {
                    String m = l.message().replace("\n", " ");
                    b.append(java.time.Instant.ofEpochMilli(l.ts())).append(' ').append(l.stream()).append(' ').append(m.length() > 400 ? m.substring(0, 400) + "…" : m).append('\n');
                    n++;
                }
                if (n == 0) b.append("(no lines yet — the streams may not exist or the run is too young)\n");
                b.append("```\n");
            } catch (RuntimeException e) {
                b.append("(run details could not be read: ").append(e.getMessage()).append(")\n");
            }
        }
        Path local = cwd.resolve("jobs").resolve(job).resolve("job.py");
        b.append("\n## Local files\n");
        if (Files.exists(local)) b.append("The job's script is at `").append(cwd.relativize(local)).append("` — read it and cite line numbers.\n");
        else b.append("No local copy of the script. The deployed one is at the ScriptLocation above (`aws s3 cp <ScriptLocation> -`).\n");
        b.append("\n## Getting more\n- `aws logs filter-log-events --log-group-name /aws-glue/jobs/output --log-stream-name-prefix <runId>` (stdout/stderr)\n")
         .append("- `aws logs filter-log-events --log-group-name /aws-glue/jobs/error --log-stream-name-prefix <runId> --filter-pattern ERROR`\n")
         .append("- `aws glue get-job-run --job-name ").append(job).append(" --run-id <runId>`\n");
    }

    private void author(StringBuilder b, String job, Path cwd) {
        Path dir = cwd.resolve("jobs").resolve(job);
        b.append("## Your role: authoring agent\nYou build and change this AWS Glue job as a visual DAG plus generated PySpark and unit tests. The person sees the DAG on a canvas beside you and edits it too.\n\n")
         .append("## The folder contract — `jobs/").append(job).append("/`\n")
         .append("- `job.json` — the Glue Job properties (Role, Command, GlueVersion, WorkerType, NumberOfWorkers, DefaultArguments, Timeout…) exactly as the Glue API shapes them, minus CodeGenConfigurationNodes.\n")
         .append("- `dag.json` — the `CodeGenConfigurationNodes` map, verbatim API shape: `{\"<nodeId>\": {\"<NodeType>\": {\"Name\": \"…\", \"Inputs\": [\"<nodeId>\"…], …type fields…}}}`. Exactly one type key per node. Ids unique (use `node-<8 chars>`). Every `Inputs` entry is an existing id. Sources have no `Inputs`. `Join` has exactly 2 inputs; most transforms and every target exactly 1. Add `OutputSchemas: [{\"Columns\":[{\"Name\",\"Type\"}]}]` on sources when you know the columns.\n")
         .append("- `layout.json` — `{\"<nodeId>\": {\"x\": n, \"y\": n}}`; add an entry for every node you add (sources left, targets right, ~260px per column, ~100px per row).\n")
         .append("- `job.py` — GENERATED from dag.json by SparData. Never edit it by hand; anything custom goes into a `SparkSQL` or `CustomCode` node. It has one function per node, `def <snake_name>(glueContext, <inputs>…) -> DynamicFrame`, and a `main()`.\n")
         .append("- `tests/` — pytest. `conftest.py` (a `glueContext` fixture and a `dyf(glueContext, rows)` helper), `test_<snake_name>.py` per node, `test_pipeline.py` for the whole flow, small CSV fixtures in `tests/fixtures/`. SparData scaffolds these once; you make them real.\n\n")
         .append("## Node types SparData can generate code for (anything else: use SparkSQL or CustomCode)\n")
         .append("Sources: `S3CsvSource{Paths[],Separator: comma|tab|pipe|semicolon|ctrla,QuoteChar: quote|quillemet|single_quote|disabled,WithHeader,Recurse,Escaper}`, `S3ParquetSource{Paths[],Compression,Recurse}`, `S3JsonSource{Paths[],JsonPath,Multiline,Recurse}`, `S3CatalogSource{Database,Table,PartitionPredicate}`, `CatalogSource{Database,Table}`.\n")
         .append("Transforms: `ApplyMapping{Mapping:[{ToKey,FromPath[],FromType,ToType,Dropped}]}`, `SelectFields{Paths[]}`, `DropFields{Paths[]}`, `RenameField{SourcePath[],TargetPath[]}`, `Filter{LogicalOperator: AND|OR, Filters:[{Operation: EQ|LT|GT|LTE|GTE|NE|REGEX|LIKE|ILIKE|IN|BETWEEN|CONTAINS|STARTS_WITH|ENDS_WITH|ZERO_LENGTH|NOT_NULL|NULL, Negated, Values:[{Type: COLUMNEXTRACTED|CONSTANT, Value:[\"…\"]}]}]}`, `Join{JoinType: equijoin|left|right|outer|leftsemi|leftanti, Columns:[{From:<inputId>,Keys:[[\"col\"]]},{From:<inputId>,Keys:[[\"col\"]]}]}`, `DropDuplicates{Columns:[[\"col\"]]}`, `DropNullFields{}`, `Aggregate{Groups:[[\"col\"]],Aggs:[{Column:[\"col\"],AggFunc: avg|count|countDistinct|first|last|kurtosis|max|min|skewness|stddev_samp|stddev_pop|sum|sumDistinct|var_samp|var_pop}]}`, `SparkSQL{SqlQuery,SqlAliases:[{From:<inputId>,Alias}]}`, `CustomCode{Code,ClassName}` (Python; the class takes `(glueContext, dfc)` and returns a DynamicFrameCollection), `Union{UnionType: ALL|DISTINCT}`.\n")
         .append("Targets: `S3DirectTarget{Path,Format: json|csv|avro|orc|parquet,Compression,PartitionKeys:[[\"col\"]]}`, `S3GlueParquetTarget{Path,Compression,PartitionKeys}`, `S3CatalogTarget{Database,Table,PartitionKeys}`.\n\n")
         .append("## The loop\n1. Edit `dag.json` and `layout.json` (and `job.json` for job properties).\n")
         .append("2. Regenerate: `curl -s -X POST http://127.0.0.1:$KEEL_PORT/api/jobs/").append(job).append("/generate` — rewrites `job.py` and adds test scaffolds that do not exist yet (it never overwrites a test you wrote). Read the response: it names any node it cannot generate.\n")
         .append("3. Write or fix the tests so they assert real behaviour on tiny fixtures.\n")
         .append("4. Run them in the official Glue 5 image: `docker run -i --rm -v \"$HOME/.aws:/home/hadoop/.aws:ro\" -v \"$PWD/jobs/").append(job).append(":/home/hadoop/workspace\" -w /home/hadoop/workspace -e AWS_PROFILE -e AWS_REGION public.ecr.aws/glue/aws-glue-libs:5 -c \"python3 -m pytest -q --disable-warnings tests\"` (first pull is ~7 GB). Or `curl -s -N http://127.0.0.1:$KEEL_PORT/api/jobs/").append(job).append("/test` which streams the same run.\n")
         .append("5. Iterate until green. Not available locally: job bookmarks, the `glueparquet` writer, FillMissingValues, Data Quality, PII detection — keep those out of tests.\n")
         .append("Never deploy; the person deploys from Keel. Keep the DAG valid at every step (the canvas reloads on each save).\n\n");
        b.append("## Current state of `jobs/").append(job).append("/`\n");
        int budget = 30_000;
        for (String f : new String[] {"job.json", "dag.json", "layout.json"}) {
            Path p = dir.resolve(f);
            if (!Files.exists(p)) { b.append("- `").append(f).append("`: does not exist yet\n"); continue; }
            try {
                String text = Files.readString(p);
                if (text.length() > budget) { b.append("- `").append(f).append("`: ").append(text.length()).append(" bytes, read it\n"); continue; }
                budget -= text.length();
                b.append("### ").append(f).append("\n```json\n").append(text.strip()).append("\n```\n");
            } catch (java.io.IOException e) { b.append("- `").append(f).append("`: unreadable\n"); }
        }
        Path tests = dir.resolve("tests");
        if (Files.isDirectory(tests)) {
            try (var s = Files.list(tests)) {
                b.append("- tests: ").append(String.join(", ", s.map(x -> x.getFileName().toString()).sorted().toList())).append('\n');
            } catch (java.io.IOException ignored) { }
        } else b.append("- tests: none yet\n");
        if (!Files.exists(dir)) b.append("\nThe folder does not exist: this is a new job. Ask the person what it should do if the request is unclear, then create job.json, dag.json and layout.json, regenerate, and write tests.\n");
    }

    private static String kv(String k, Object v) { return v == null ? "" : "- " + k + ": " + v + "\n"; }
}
