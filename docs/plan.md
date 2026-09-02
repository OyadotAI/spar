# keel-v2 — Keel for AWS Glue Studio

## Context

Keel v1 (`/Users/mk/Dev/oya/keel`) is a native macOS ADE: a Rust daemon drives the user's own `claude` CLI, a SwiftUI app shows each turn as one reviewable artifact (files, commands, gate, cost), every task gets a branch + worktree, and risky tool calls block on an in-app approval. Its audience is product engineers.

keel-v2 (`/Users/mk/Dev/oya/keel-v2`, currently an empty directory) re-targets that machine at **AWS Glue Studio** — Glue's visual ETL service where a job is a DAG of typed nodes (`CodeGenConfigurationNodes`) that Glue turns into a PySpark script. The audience becomes data engineers who own Glue jobs and are tired of the AWS console: no local tests, no diff, opaque failures buried in CloudWatch.

**User's decisions (asked and answered):**
- Backend: **Java 21 + Spring Boot + Maven** (replaces the Rust daemon).
- Frontend: **Electron**, so it runs on **macOS, Windows and Linux** (replaces v1's SwiftUI app; nothing from `keel/app` is compiled, but its decoder, layout and rules are ported).
- LLM: **drive the `claude` CLI** like v1 (subscription auth, no API key, v1's approval hook model carries over).
- Jobs live in a **local git repo per project**; deploy to AWS on demand.
- Authoring canvas: **full visual editor** (palette, drag-to-connect, inspector) *and* an agent that edits the same DAG.

**Three screens (user's spec):**
1. **Main page** — every Glue job in the chosen profile/region, with last-run state.
2. **Job → Console tab** — runs + live CloudWatch console in the middle; **debugging agent** on the right.
3. **Job → Authoring tab** — agent-first authoring that produces the Glue Studio DAG (visual), the corresponding PySpark code, and unit tests per node plus one for the whole pipeline.

## AWS Glue facts the design relies on (verified against docs, 2026-09-02)

- **Job**: `Name, JobMode SCRIPT|VISUAL|NOTEBOOK, Role, Command{Name glueetl|pythonshell|gluestreaming|glueray, ScriptLocation s3://…, PythonVersion}, GlueVersion (new default 5.1), WorkerType G.1X|G.2X|G.4X|G.8X|G.025X|Z.2X, NumberOfWorkers, DefaultArguments, Timeout, MaxRetries, ExecutionClass STANDARD|FLEX, CodeGenConfigurationNodes: Map<nodeId, node>`. Ops: `CreateJob, UpdateJob(JobName, JobUpdate), GetJob, GetJobs (paginated, 1000 max), ListJobs, BatchGetJobs, DeleteJob`.
- **Node** = object with exactly one key = the type. ~70 types (sources: S3Csv/Parquet/Json/CatalogSource, JDBC, Redshift, Kinesis, Kafka, Delta/Hudi/Iceberg…; transforms: ApplyMapping, SelectFields, DropFields, RenameField, Filter, Join, SplitFields, Union, Merge, Aggregate, DropDuplicates, DropNullFields, FillMissingValues, SparkSQL, CustomCode, PIIDetection, EvaluateDataQuality, DynamicTransform, Recipe, Route; targets: S3DirectTarget, S3GlueParquetTarget, S3CatalogTarget, Catalog/Redshift/JDBC/Snowflake/Delta/Hudi/Iceberg targets). Every node has `Name`; non-sources have `Inputs:[nodeId]` (Join exactly 2, most exactly 1); optional `OutputSchemas[{Columns[{Name,Type}]}]`.
- Passing `CodeGenConfigurationNodes` to Create/UpdateJob makes Glue **regenerate the script at `Command.ScriptLocation`**, overwriting it. There is no API to get Glue's generated script other than reading that S3 object.
- **JobRun**: `Id, Attempt, JobRunState STARTING|RUNNING|STOPPING|STOPPED|SUCCEEDED|FAILED|TIMEOUT|ERROR|WAITING|EXPIRED, ErrorMessage, StartedOn, CompletedOn, ExecutionTime(s), DPUSeconds, Arguments, LogGroupName, StateDetail`. Ops: `StartJobRun(JobName, Arguments, JobRunId=retry)`, `GetJobRun`, `GetJobRuns(JobName, MaxResults≤200, NextToken; newest first)`, `BatchStopJobRun(JobName, JobRunIds)`.
- **Logs**: Glue 5 → `/aws-glue/jobs/error` (system, Spark, glue logger) and `/aws-glue/jobs/output` (stdout/stderr); streams `<runId>-driver`, `<runId>-<executorN>`, `<runId>-progress-bar`. Glue ≤4 continuous logging → `/aws-glue/jobs/logs-v2`, stream `<runId>` / `<runId>-driver`. Security configs prefix the group name. Robust discovery: `DescribeLogStreams(prefix=runId)` across the three groups, then `GetLogEvents` with `nextForwardToken` polling.
- **Local test runtime**: `public.ecr.aws/glue/aws-glue-libs:5` (x86_64 + arm64, ~7 GB, Spark 3.5.4, Python 3.11, user `hadoop`): `docker run -i --rm -v ~/.aws:/home/hadoop/.aws -v $WS:/home/hadoop/workspace/ --workdir /home/hadoop/workspace -e AWS_PROFILE=$P public.ecr.aws/glue/aws-glue-libs:5 -c "python3 -m pytest --disable-warnings"`. Not supported locally: job bookmarks, Glue parquet writer, FillMissingValues, Data Quality, PII.
- **Java SDK v2** modules: `glue, cloudwatchlogs, s3, sts, sso, ssooidc` (the last two must be on the classpath for SSO profiles). This machine: AWS CLI 2.36, `~/.aws/sso/cache` (user uses SSO), no `~/.aws/config` profiles yet, Docker 29, JDK 17 default + Homebrew JDK 26 (needs `brew install openjdk@21`), Maven 3.9, `claude` 2.1.258. Node/pnpm presence to be checked in phase 0.

## Repository layout

```
keel-v2/
  daemon/          Java 21 · Spring Boot 3.5 · Maven, single module, no DB, no Lombok (records)
  app/             Electron · electron-vite · React 19 + TypeScript · React Flow · CodeMirror · xterm.js
  Makefile         check (mvn test + pnpm test) · dev (jar + electron dev) · dist (electron-builder mac/win/linux)
  CLAUDE.md        working agreement (port the v1 bar: never slow / never stuck / never weird)
```

Per-project state (in the user's Glue repo): `.keel/{state.json, permissions.json, turns/<job>/<turn>.json, worktrees/<job>/}`. Job folder contract:

```
jobs/<job-name>/
  job.json      Glue Job props verbatim minus CodeGenConfigurationNodes
  dag.json      CodeGenConfigurationNodes map verbatim ({nodeId: {"<Type>": {Name, Inputs?, ...}}})
  layout.json   {nodeId: {x, y}}   (positions are not in the AWS API)
  job.py        GENERATED from dag.json by the daemon; testable shape (one function per node + main)
  tests/conftest.py, tests/test_<node>.py, tests/test_pipeline.py, tests/fixtures/
```

## Part A — Java daemon (`daemon/`)

### A1. Build
- Parent `spring-boot-starter-parent` 3.5.x, `java.version=21`; deps: `spring-boot-starter-web` (MVC + Jackson), `spring-boot-starter-websocket` (terminal), `spring-boot-starter-test`; AWS BOM `software.amazon.awssdk:bom` 2.36.x with `glue, cloudwatchlogs, s3, sts, sso, ssooidc, sqs, eventbridge, cloudtrail`; `org.jetbrains.pty4j:pty4j` (terminal), `io.methvin:directory-watcher` (file watcher). Nothing else.
- `application.properties`: `server.address=127.0.0.1`, `server.port=0`, `spring.threads.virtual.enabled=true`, `spring.mvc.async.request-timeout=-1`, `logging.level.root=warn`.
- CLI: `java -jar keel-daemon.jar --project <dir> [--port N] [--exit-with-parent]`; `main` rewrites argv to Spring props and prints `KEEL_PORT=<n>` on `WebServerInitializedEvent` (Electron main reads it from stdout).
- JDK: `brew install openjdk@21`; Maven currently resolves to Homebrew JDK 26, which Boot 3.5 does not support, so `JAVA_HOME=$(/usr/libexec/java_home -v 21)` in the Makefile. The shipped app bundles its own JRE (see B1), so end users never install Java.

### A2. Packages (~2.9k LOC main, ~400 test)

| Package | Classes | Owns |
|---|---|---|
| `ai.oya.keel` | `KeelApplication`, `ParentWatch`, `Events`, `Proc`, `Errors`/`ApiError`, `State` | boot, `--exit-with-parent` (poll `ProcessHandle.parent()` 1s, kill children, exit), `GET /api/events` SSE bus with 15s comment heartbeat, `Proc.run/stream` (both pipes drained on virtual threads, timeouts, git env `GIT_TERMINAL_PROMPT=0`), `{error, fix?}` error JSON with SSO-expired → 401 + `fix: "aws sso login --profile X"`, `.keel/state.json {profile, region, scriptBucket}` |
| `ai.oya.keel.aws` | `AwsClients`, `Profiles`, `AwsErrors`, `GlueService`, `JobsCache`, `Sync`, `LiveEvents`, `LogsService` | per-profile SDK clients (`ProfileCredentialsProvider`, region from `~/.aws/config`), profile list + v1 `aws.rs` SSO writer port + `aws sso login` SSE, GetJobs/GetJobRuns/Start/Stop, get-job/create-job/update-job via `aws glue … --cli-input-json` (verbatim API JSON, no SDK model marshalling — `ponytail:` swap to SDK models if the CLI dependency bites), the in-memory job/run cache, **the near-real-time sync engine and the optional EventBridge→SQS push (A10)**, log discovery + tail |
| `ai.oya.keel.local` | `Project`, `Importer`, `Deployer`, `Watcher` | job folder I/O + dag validation (one type key per node, Inputs resolve, Join has 2), `rev` counter per job, import from AWS (VISUAL → job.json + dag.json + auto layout; SCRIPT → S3 script → job.py), deploy, and a filesystem watcher on `jobs/**` (`io.methvin:directory-watcher`, native FSEvents/inotify/ReadDirectoryChangesW) so a dag.json edited by an editor, a terminal `claude`, or `git checkout` bumps `rev` and emits `job.changed` — outside-Keel edits reach the canvas too |
| `ai.oya.keel.codegen` | `Dag`, `PySpark`, `TestGen`, `Layout` | topo sort (Kahn, id-ordered, cycle error), name sanitising, node-type → PySpark table, per-node line `ranges`, test scaffolds, auto-layout |
| `ai.oya.keel.testing` | `TestRunner`, `JUnitXml` | pytest in the Glue 5 container, SSE lines, junit parse |
| `ai.oya.keel.git` | `Git`, `Lanes` | `snapshot` (write-tree on a per-call temp index — v1 snapshot.rs), `changed(a,b)`, `commitAll` (`add -A`, `--no-verify`, gpgsign off), `status`, worktree per job at `.keel/worktrees/<job>` on `keel/<job>` |
| `ai.oya.keel.agent` | `ClaudeRunner`, `Hook`, `Approvals`, `Turns`, `Prompts`, `Mcp` | spawn/stream/after-turn, hook settings JSON, approval queue (240s, fail-open), turn records, the two system prompts, and a port of v1's 222-line hand-rolled MCP HTTP endpoint (`/mcp`: initialize, tools/list, tools/call) hosting `ask_user` |
| `ai.oya.keel.term` | `Terminals` | WebSocket `/ws/term?cwd=` → pty (see A9); v1's rule: a text frame is the tab title, binary frames are bytes |

### A3. HTTP API (`lane` == job name everywhere; errors `{error, fix?}`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/state` | `{project, port, os, profile, region, scriptBucket, profiles[{name, region, sso}], claude{installed, version}, docker{installed}, aws{cli}, git{installed}}` |
| POST | `/api/profile` | `{profile, region?, scriptBucket?}` → resets clients, clears cache, emits `state.changed` |
| POST | `/api/aws/sso` · GET `/api/aws/login?profile=` (SSE) | v1 SSO setup port; login streams the URL + code |
| GET | `/api/events` (SSE) | `connected {seq}` then `{seq, kind, data}`; kinds: `state.changed, jobs.changed {added[], removed[]}, job.changed {name, rev?, remote?: {lastModifiedOn}}, run.changed {job, run: GlueRun}` (carries the payload so a row updates without a refetch), `pending {lane}, turn {lane, turn, fact}, git.changed {lane}, aws.auth {fix}, live.changed {mode, detail}` |
| GET | `/api/live` | `{mode: push\|polling, sweepSeconds, throttled: bool, push: {enabled, queueUrl?, trail: present\|absent\|unknown, lastEventAt?}}` |
| POST | `/api/live/enable` · `/api/live/disable` | creates / deletes the SQS queue + two EventBridge rules (A10); returns the same shape as GET; errors carry the missing IAM action in `fix` |
| GET | `/api/glue/jobs?refresh=1` | `{refreshedAt, jobs[{name, jobMode, glueVersion, workerType, numberOfWorkers, commandName, scriptLocation, role, latestRun{id, state, startedOn, completedOn, executionTime, dpuSeconds, errorMessage}?, local{imported, lane}}]}` |
| GET | `/api/glue/jobs/{name}` | verbatim `get-job` Job JSON |
| GET | `/api/glue/jobs/{name}/runs?max=50&next=` | newest first |
| GET | `/api/glue/jobs/{name}/runs/{id}` | run detail |
| POST | `/api/glue/jobs/{name}/runs` | `{arguments?, retryOf?}` → `{runId}` |
| POST | `/api/glue/jobs/{name}/runs/{id}/stop` | BatchStopJobRun |
| GET | `/api/glue/jobs/{name}/runs/{id}/logs/tail?n=200&group=error` | initial console fill + prompt injection |
| GET | `/api/glue/jobs/{name}/runs/{id}/logs?group=all\|error\|output` (SSE) | `streams`, `line {ts, group, stream, message}`, `end {reason}` |
| GET | `/api/jobs` | local jobs `[{name, hasDag, hasScript, hasTests, lane{exists, branch, dirty}}]` |
| POST | `/api/jobs/{name}/import` | from AWS; idempotent |
| GET | `/api/jobs/{name}` | `{job, dag, layout, rev, script, ranges{nodeId: [startLine, endLine]}, tests[{path, content}]}` |
| PUT | `/api/jobs/{name}/dag` | `{dag, layout, rev}` → `{rev}`; validates; **409 on rev mismatch**; emits `job.changed {name, rev}` |
| PUT | `/api/jobs/{name}/layout` · `/job` · `/script` | no rev for layout |
| POST | `/api/jobs/{name}/generate` | `{tests: true, force: false}` → regenerates job.py, adds missing scaffolds only |
| GET | `/api/jobs/{name}/test` (SSE) | `line {text}`, `result {status, passed, failed, errors, skipped, cases[{name, node, status, message}]}`, `done {code}` |
| POST | `/api/jobs/{name}/deploy` | `{create?}` → `{jobName, scriptLocation, note}` |
| POST | `/api/jobs/{name}/lane` · GET `/git` · POST `/commit` | worktree ensure, status, commit |
| GET | `/api/turns?job=` | records newest first |
| GET | `/api/chat?job&mode=debug\|author&prompt&session?&run?&permission=acceptEdits\|plan&model?` (SSE) | `starting`, `msg` (raw stream-json line, verbatim), `fact`, `done {code}`, `fatal`, `err`; 15s heartbeat |
| POST | `/api/chat/stop?job=` | SIGINT on POSIX (never SIGTERM: exit 143 abandons the turn); Windows: `destroy()` (see A9) |
| POST | `/api/approve/ask?lane=` · GET `/api/approve/poll?lane=` · POST `/api/approve/answer` | v1 protocol: hook stdin JSON in, `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow\|deny","permissionDecisionReason"}}` out, empty body on defer/timeout |
| POST | `/mcp?lane=` | JSON-RPC `initialize` / `tools/list` / `tools/call`; tools: `ask_user` (v1) |
| WS | `/ws/term?cwd=` | pty bytes both ways; text frame = title |

**Log discovery** (`LogsService`): `DescribeLogStreams(logStreamNamePrefix=runId)` in `/aws-glue/jobs/error`, `/aws-glue/jobs/output`, `/aws-glue/jobs/logs-v2` (ResourceNotFound = skip); drop `*-progress-bar`; `GetLogEvents(startFromHead)` then poll `nextForwardToken` every 2s while the run is STARTING/RUNNING/STOPPING (re-check `GetJobRun` and re-discover streams every 15s), stop 30s after terminal.

**Deploy** (`Deployer`): ScriptLocation = `job.json.Command.ScriptLocation` or `s3://<scriptBucket>/scripts/<name>.py` (400 if neither). `JobUpdate` = job.json minus `Name, CreatedOn, LastModifiedOn, AllocatedCapacity, MaxCapacity (when WorkerType set), ProfileName` plus `CodeGenConfigurationNodes = dag`, `JobMode = VISUAL`; `update-job` (or `create-job`). Then PutObject job.py to ScriptLocation; after 5s GetObject and re-put if Glue's regeneration overwrote it (`ponytail:` regeneration timing unverified, measure in phase 7). Commit `deploy <name>`. Response `note`: a console Save regenerates the script from the DAG and discards the tested job.py.

### A4. claude spawn (port of v1 `agent.rs:765-840`)

```
claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages
       --permission-mode acceptEdits|plan
       --settings '<Hook.settingsJson>'
       --mcp-config '{"mcpServers":{"keel":{"type":"http","url":"http://127.0.0.1:PORT/mcp?lane=JOB"}}}'
       --append-system-prompt '<Prompts.debug|author>'
       [--resume <session>] [--model <m>] [--add-dir <projectRoot>]   # add-dir when cwd is a lane checkout
cwd = lane checkout (author) / project root (debug);  env += AWS_PROFILE, AWS_REGION;  never --bare
```

`Hook.settingsJson` — the hook is **curl, not a JVM** (no per-tool-call startup cost); fail-open by construction:
```json
{"permissions":{"allow":[…project+session rules…,
   "Bash(aws glue get-*)","Bash(aws glue list-*)","Bash(aws logs *)","Bash(aws s3 ls*)",
   "Bash(docker run*public.ecr.aws/glue/aws-glue-libs*)","Bash(curl -s* http://127.0.0.1:PORT/api/jobs/*)",
   "mcp__keel__ask_user"]},
 "hooks":{"PreToolUse":[{"matcher":"Bash|WebSearch|WebFetch|AskUserQuestion|Write|Edit|MultiEdit",
   "hooks":[{"type":"command",
     "command":"curl -fsS --max-time 250 -H 'Content-Type: application/json' --data-binary @- 'http://127.0.0.1:PORT/api/approve/ask?lane=JOB' || true",
     "timeout":270}]}]}}
```
Timeouts nest: daemon wait 240s < curl 250s < Claude hook 270s. `-f` prints nothing on non-2xx, `|| true` forces exit 0, so daemon-down / timeout / dropped socket all defer to the allowlist exactly like v1. Job names validated `[A-Za-z0-9._-]+` at import so the shell line needs no quoting tricks. `curl` ships with macOS, Windows 10+ (`System32\curl.exe`) and every Linux distro Claude Code supports.

**Stream loop** (`ClaudeRunner`, one virtual thread per turn, one turn per lane → 409 if busy):
1. emit `starting`; `Git.snapshot(cwd)`; Record{started, prompt[:200], snapshot}; emit `fact started`.
2. spawn; stderr drained to a 16 KB capped buffer on its own thread.
3. per stdout line: forward verbatim as `msg`; parse only when the line contains `"subtype":"init"` (session id) or `"type":"result"` (usage + `total_cost_usd`). Client gone → stop.
4. exit≠0 → `fatal` with last 8 stderr lines; then `done {code}`.
5. after-turn: `files = changed(before, after)`; author mode and `dag.json` in files → bump `rev`, regenerate job.py + missing scaffolds; `tests/` exists → `TestRunner` as the gate (`fact gate`); `commitAll("keel: <prompt[:60]>")` (`fact commit`); `fact ended`; write Record; emit `job.changed`, `git.changed`.

**Record**: `{turn, job, mode, prompt, session, started, ended, ms, snapshot, files[], gate{status, ms, passed, failed, failures[]}, commit, usage{input, output, cacheRead, cacheWrite, costUsd}, failed{code, tail}, approvals[{id, tool, command, decision}]}`.

### A5. System prompts (`Prompts`)
Shared preamble: project root, job folder, daemon URL, `aws` CLI is available with profile/region set, the hook may pause a command for approval and a refusal is an answer, Keel commits after the turn.

- **debug**: injected job summary (mode, Glue version, command, workers, timeout, retries, role, DefaultArguments with secret-looking keys masked), selected run (state, StateDetail, ErrorMessage, times, DPU, arguments, log group), **last 200 error-log lines** for that run, pointer to local `job.py` if imported, the `aws logs filter-log-events` / `aws glue get-job-run` commands for more. Rules: do not start/stop/update unless asked in this message; propose fixes as diffs.
- **author**: the folder contract verbatim; dag.json invariants; the 19 supported node types with field shapes and enums; "anything else: SparkSQL or CustomCode"; the loop: edit dag.json + layout.json → `curl -s -X POST …/generate` → edit tests → run the exact docker pytest command (allow-listed) → iterate to green; job.py is generated so custom logic lives in SparkSQL/CustomCode nodes; unsupported-locally list; current dag/job/layout inlined (≤30 KB); never deploy.

### A6. Codegen (`PySpark.generate(dag)`)
Shape: imports → CustomCode bodies at module level → one `def <snake>(glueContext, <inputs…>[, paths=|path=default]) -> DynamicFrame` per node in topo order → `main()` (getResolvedOptions, SparkContext, GlueContext, Job.init, calls in topo order, job.commit) → `if __name__ == "__main__": main()`. Every literal goes through one `py(JsonNode)` helper (never raw string concat). `snake()` handles keywords, digits, duplicates. The generator records each node's `[startLine, endLine]` as `ranges` for the code pane.

| Node | Body |
|---|---|
| S3CsvSource / S3ParquetSource / S3JsonSource | `create_dynamic_frame.from_options(connection_type="s3", format=…, format_options={withHeader, separator, quoteChar / multiline}, connection_options={"paths": paths, "recurse"})`; `paths=` default in the signature |
| S3CatalogSource / CatalogSource | `create_dynamic_frame.from_catalog(database, table_name)` |
| ApplyMapping | `ApplyMapping.apply(frame, mappings=[(from, type, to, toType)…])`, `Dropped` skipped |
| SelectFields / DropFields / RenameField / DropNullFields | the matching `awsglue.transforms` call |
| Filter | `Filter.apply(frame, f=lambda row: …)` with the full Operation enum mapped (EQ…NULL, LIKE/ILIKE via regex, BETWEEN, IN, Negated → `not`) |
| Join | equijoin/inner → `Join.apply(keys1, keys2)`; other JoinTypes → DataFrame join + `fromDF` |
| DropDuplicates / Aggregate / Union | DataFrame ops + `DynamicFrame.fromDF`; AggFunc maps 1:1 to `pyspark.sql.functions` |
| SparkSQL | temp views per `SqlAliases`, `spark_session.sql(SqlQuery)` |
| CustomCode | PYTHON3 only; `ClassName(glueContext, DynamicFrameCollection({...}))` |
| S3DirectTarget / S3GlueParquetTarget / S3CatalogTarget | `write_dynamic_frame.from_options / from_catalog`; `path=` default in the signature; returns the frame |
| anything else | 400: `node '<Name>' (<id>) is <Type>, which Keel cannot generate yet; express it as SparkSQL or CustomCode` |

`TestGen` (never overwrites): `conftest.py` (session `glueContext`, `dyf(rows)` helper, `sys.path` to the job dir), `test_<snake>.py` per node (sources read `tests/fixtures/<snake>.csv` generated from `OutputSchemas`; transforms build inputs with `dyf`; targets write to `tmp_path`, glueparquet/catalog skipped), `test_pipeline.py` (all non-targets in topo order, final count > 0). `Layout.auto`: depth = longest path from a source, `x = 80 + depth·260`, `y = 80 + index·140`.

### A7. Test runner
`docker run -i --rm --name keel-<job>-<ts> -v <home>/.aws:/home/hadoop/.aws:ro -v <jobDir>:/home/hadoop/workspace -w /home/hadoop/workspace -e AWS_PROFILE -e AWS_REGION public.ecr.aws/glue/aws-glue-libs:5 -c "python3 -m pytest --disable-warnings -q --junitxml=.junit.xml tests"`. Missing image → stream `docker pull` first ("~7 GB"). 20 min timeout → `docker kill` by name. Parse `.junit.xml` (DOM) → result object shared by the SSE `result` event and `Record.gate`. One runner per job (409). Paths come from `System.getProperty("user.home")` and `Path.toString()` so Windows mounts (`C:\Users\…`) work with Docker Desktop.

### A8. Daemon self-checks (JUnit 5)
| Test | Asserts |
|---|---|
| `PySparkTest.goldenSimplePipeline` | `fixtures/dag-simple.json` (Csv → ApplyMapping → Filter → Join(Catalog) → Aggregate → S3DirectTarget) renders byte-equal to `fixtures/job-simple.py`; `ranges` cover every node; unknown type message names id + Name + "SparkSQL" |
| `DagTest.topoIsInputOrderedAndStable` | order respects Inputs, deterministic, cycle lists ids; `snake` cases |
| `ClaudeStreamTest.decodesCapturedStream` | `fixtures/stream.jsonl` captured once from a real `claude -p "say hi"`: session id, usage/cost, every line forwarded, `done` last |
| `ApprovalsTest.timesOutFailOpen` / `answerReleases` | 200 ms wait → empty body, queue empty; allow completes the waiter and persists the rule |
| `HookTest.settingsCarryTheCurlHook` | matcher, `--data-binary @-`, `|| true`, `timeout > 250` |
| `LogsServiceTest.discoversAcrossGroups` | Mockito client: three groups, progress-bar dropped, ResourceNotFound skipped |
| `JUnitXmlTest.countsAndFailures` | 3 passed / 1 failed / 1 skipped |
| `GitTest.snapshotAndCommit` | temp repo: snapshot diff lists the edited file; clean tree → null; failing pre-commit hook does not block |
| `ProjectTest.dagPutRejectsStaleRev` | PUT with an old rev → 409, file untouched |
| `SyncTest.inventoryDiffAndTiers` | Mockito Glue: a name appearing/disappearing between two `ListJobs` answers emits `jobs.changed {added, removed}`; a job whose latest run is RUNNING is polled on the 3s tier and drops to the cold sweep after SUCCEEDED; a `ThrottlingException` doubles the interval and emits `live.changed {throttled}` |
| `LiveEventsTest.mapsMessagesToRefreshes` | an SQS message with `Glue Job State Change` triggers exactly one `GetJobRun` and emits `run.changed`; a CloudTrail `CreateJob` message triggers `GetJob` + `jobs.changed`; every message is deleted |
| `WatcherTest.outsideEditBumpsRev` | writing dag.json from the test (not via the API) emits `job.changed` with a new rev; the daemon's own PUT does not double-fire |

### A9. Cross-platform notes (Windows and Linux)
- **Process control**: Java has no `setpgid`. Stop = `SIGINT` via `kill -INT <pid>` on macOS/Linux (v1's rule: SIGTERM makes Claude Code exit 143 and abandon the turn), then `ProcessHandle.descendants().destroyForcibly()` after 5s. On Windows there is no SIGINT for a non-console child, so Stop = `destroy()` on the tree; the turn is abandoned rather than interrupted. `// ponytail: Windows stop is a kill, not an interrupt; GenerateConsoleCtrlEvent via JNA if it matters.`
- **Hook shell line**: Claude Code on Windows runs hooks through Git Bash (its Bash tool requires Git for Windows), so `|| true` and single quotes are fine; verify on a Windows VM in phase 0 and record the finding in CLAUDE.md. `curl.exe` is in `System32` on Windows 10+.
- **Paths**: never string-build paths; `Path.of(System.getProperty("user.home"), ".aws")`; git worktree paths are handed to git as absolute; Docker volume mounts use `Path.toAbsolutePath().toString()`.
- **Terminal**: the pty lives in the daemon, not in Electron, so the renderer is identical on every OS. Use `org.jline:jline` is not a pty; use **pty4j** (`org.jetbrains.pty4j:pty4j`, JetBrains' cross-platform pty, bundles native libs for mac/win/linux) → `/ws/term` WebSocket (`spring-boot-starter-websocket`). Shell = `$SHELL` / `%COMSPEC%` / `pwsh` if present.
- **`--exit-with-parent`**: `ProcessHandle.current().parent()` works on all three; Electron main is the parent.
- **Binary discovery**: `claude`, `aws`, `docker`, `git` resolved via `PATH` (+ `.cmd` shims on Windows: `claude.cmd` from npm). `/api/state` reports what is missing and the app's empty states say how to install it.

### A10. Near-real-time sync (jobs, runs and files changed outside Keel)

**Requirement**: a job created/updated/deleted in the AWS console or by any API caller, a run started or finished by anything, and a file edited outside Keel all show up in the app without a click, within seconds.

**What AWS can push (verified 2026-09-02)**: Glue emits EventBridge `Glue Job State Change` only for `SUCCEEDED | FAILED | TIMEOUT | STOPPED` (and `Glue Job Run Status` only when a delay threshold is set). Nothing native for STARTING/RUNNING, CreateJob, UpdateJob, DeleteJob. Those exist only as `AWS API Call via CloudTrail` events, which EventBridge delivers **only when the account has an active CloudTrail trail**. So: **polling is the baseline and push is an accelerator**, never the other way round.

**`Sync` — the polling engine** (one virtual thread per loop, one shared token bucket, everything emits diffs on the event bus):

| Loop | Call | Interval | Detects | Emits |
|---|---|---|---|---|
| Inventory | `ListJobs` (names only, 1000/page) | **5s** | jobs added / removed anywhere | `jobs.changed {added, removed}` after `BatchGetJobs` for the added names |
| Definitions | `BatchGetJobs` in chunks of 100, compare `LastModifiedOn` | **30s** all jobs; **5s** `GetJob` for the open job(s) | job edited in the console / by API | `job.changed {name, remote}`; a job with a local copy gets a "remote changed since import" badge, never a silent overwrite |
| Runs, hot tier | `GetJobRuns(MaxResults=1)` | **3s** | state changes for jobs whose latest run is non-terminal, plus any job the user has open (`MaxResults=20`) | `run.changed {job, run}` |
| Runs, cold sweep | `GetJobRuns(MaxResults=1)` per idle job, spread evenly across the interval | adaptive: `max(5s, jobs / 8 per second)` — 40 jobs → 5s, 200 jobs → 25s | a run started outside Keel on an idle job (which then moves to the hot tier) | `run.changed` |
| Throttling | `ThrottlingException` / 429 on any loop | back off ×2 to 60s with jitter, then recover | | `live.changed {throttled: true}` (status bar says "polling slowed by AWS throttling") |

Cost at idle with 100 jobs ≈ 10 req/s peak, well under Glue's default TPS; the token bucket (8/s, burst 16) is the ceiling. Every loop pauses when no `/api/events` subscriber exists (app minimised on another profile) and resumes on the next subscriber.

**`LiveEvents` — optional push, one click in Settings → Live updates → Enable** (idempotent, per install id stored in `.keel/state.json`), created in the selected profile/region:
1. SQS queue `keel-live-<installId8>` (retention 1 day, policy allowing `events.amazonaws.com` for the two rules' ARNs).
2. EventBridge rule `keel-live-<installId8>-glue` on the default bus: `{"source":["aws.glue"],"detail-type":["Glue Job State Change","Glue Job Run Status"]}` → the queue.
3. EventBridge rule `keel-live-<installId8>-api`: `{"source":["aws.glue"],"detail-type":["AWS API Call via CloudTrail"],"detail":{"eventName":["CreateJob","UpdateJob","DeleteJob","StartJobRun","BatchStopJobRun"]}}` → the queue. Delivers only if a trail exists; the daemon checks `cloudtrail:DescribeTrails` (best effort) and reports `trail: present|absent|unknown` so the UI can say "job create/start events need a CloudTrail trail; run completions are live regardless".
4. A virtual thread long-polls `ReceiveMessage(WaitTimeSeconds=20, MaxNumberOfMessages=10)`; each message → one targeted call (`GetJobRun` for a run event, `GetJob` for Create/Update, cache removal for Delete) → `run.changed` / `jobs.changed` / `job.changed` within ~1–2s → `DeleteMessage`. While push is healthy the cold sweep relaxes to 60s and the definitions loop to 120s; a receive error for 60s drops back to full polling and says so.
5. Disable deletes both rules' targets, the rules, and the queue. IAM needed, listed verbatim in the Settings card: `sqs:CreateQueue, GetQueueAttributes, SetQueueAttributes, ReceiveMessage, DeleteMessage, DeleteQueue`, `events:PutRule, PutTargets, RemoveTargets, DeleteRule, DescribeRule`, `sts:GetCallerIdentity`, optional `cloudtrail:DescribeTrails`. SDK modules added: `sqs`, `eventbridge`, `cloudtrail`.

**`Watcher` — the local side**: `directory-watcher` on `<project>/jobs` and every lane worktree's `jobs/`; a change to `dag.json` / `layout.json` / `job.py` / `tests/**` not caused by Keel's own write (compare content hash against the last write) bumps `rev` and emits `job.changed {name, rev}` — the canvas, code and tests panes reload. Debounced 200 ms.

**What the user sees**: status bar shows `Live · push` or `Live · polling 5s` (tooltip: last event time, next sweep, throttled). Main-page rows and the open job's runs list update in place from `run.changed` payloads, a job created in the console appears within ≤5s, a run finished outside Keel raises the same OS notification as one started from Keel.

## Part B — Electron app (`app/`)

### B1. Stack and shape (lazy: libraries for everything that is not the product)
- **electron-vite** (main / preload / renderer in one config), **Electron 3x**, **React 19 + TypeScript**, **Zustand** (stores, `useSyncExternalStore` under the hood), plain CSS with the v1 `Theme` tokens ported to CSS variables (light/dark via `prefers-color-scheme`). No Tailwind, no component library.
- **DAG editor: `@xyflow/react` v12 (React Flow)** — palette drag-in, ports (handles), drag-to-connect, selection, marquee, pan/zoom, minimap, delete, keyboard, all in the box. Auto-layout: **`@dagrejs/dagre`** (`rankdir: LR`), ~30 lines. Hand-rolling a canvas is the wrong rung once we are in a browser.
- **Code panes: CodeMirror 6** (`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-python`, `@uiw/react-codemirror`), read-only with a highlighted line range and `scrollIntoView`. Lighter than Monaco (v1 deleted 14 MB of Monaco for a reason).
- **Terminal: `@xterm/xterm` + `@xterm/addon-fit`** connected to the daemon's `/ws/term` (pty in Java, A9). No `node-pty`, no native module in Electron.
- **Chat rendering: `react-markdown` + `remark-gfm`**, and a TypeScript port of keel-viewer's `Decoder.swift`/`Turn.swift` (stream-json → turns with steps; ~400 lines) — the one piece of v1 that is genuinely worth porting line for line.
- **Packaging: electron-builder** → `dmg` (mac, signed + notarised, reuse v1's identity/notarytool secrets), `nsis` (Windows), `AppImage` + `deb` (Linux). The daemon jar plus a **jlink'd JRE per platform** (`jdk.httpserver`-free; modules `java.base, java.net.http, java.sql, java.xml, java.naming, java.management, java.desktop`-less list determined by `jdeps`) go in `extraResources/`. Users install nothing. `electron-updater` replaces Sparkle (same GitHub-releases feed model as v1's `keel-releases`).
- **Security defaults**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the renderer talks to the daemon over `fetch`/`EventSource`/`WebSocket` directly (CSP `connect-src http://127.0.0.1:* ws://127.0.0.1:*`). Preload exposes only `keel.port()`, `keel.openExternal(url)`, `keel.pickFolder()`, `keel.onMenu(cb)`, `keel.platform`.

### B2. Directory layout (~5.5k LOC TS/TSX + ~600 test)
```
app/
  package.json  electron.vite.config.ts  electron-builder.yml  tsconfig*.json
  src/main/     index.ts (window, menu, single-instance), daemon.ts (spawn jar with bundled JRE, read KEEL_PORT, kill on quit,
                restart with backoff + "daemon died" IPC), menu.ts (Jobs: Run ⌘R, Stop ⌘., Deploy ⇧⌘D; View: zoom, auto-layout; Edit: undo/redo)
  src/preload/  index.ts (contextBridge, ~40 lines)
  src/renderer/
    api/        client.ts (fetch with 90s timeout → Result<T, Fault>), sse.ts (EventSource wrapper: reconnect, lastEventAt/lastProgressAt clocks, 60s-silence → dead), ws.ts
    wire/       types.ts (GlueJob, GlueRun, LogLine, TestResult, JobReply, StateReply, Pending, Fact), decoder.ts (stream-json → Turn/Step, port of keel-viewer), turn.ts
    stores/     app.ts (state, profile, connection status), glue.ts (jobs list, auth: ok|noProfile|expired), lanes.ts (open jobs, active tab, restore from localStorage),
                job.ts (per job: runs, selectedRun, log ring buffer cap 5,000, logState), chat.ts (per lane: turns, running, pending approvals),
                dag.ts (raw dag + layout + rev, selection, undo/redo cap 50, debounced PUT, 409 → reload prompt), authoring.ts (code, ranges, tests, results)
    events.ts   one EventSource on /api/events per window; `route(kind, data)` = the one door (v1 `Lanes.route`)
    pages/      JobsPage.tsx (main page), JobPage.tsx (tabs + rail + split panes), Settings.tsx
    console/    RunsList.tsx, RunDetail.tsx, LogConsole.tsx (virtualised with @tanstack/react-virtual, follow-tail), RunSheet.tsx
    chat/       ChatRail.tsx, TurnCard.tsx, Steps.tsx, Composer.tsx, ApprovalCard.tsx, WorkingBar.tsx
    dag/        DagEditor.tsx (ReactFlow + controls + minimap), nodes/KeelNode.tsx (custom node: name, type, category tint, handles), Palette.tsx,
                Inspector.tsx (schema-driven Form), editors/ (MappingTable, FilterExprs, JoinCols, StringList, Sql, Code, Json), schema.ts (19 types), layout.ts (dagre)
    authoring/  AuthoringTab.tsx, CodePane.tsx, TestsPane.tsx
    shell/      LaneTabs.tsx, ActivityRail.tsx, SidePanel.tsx (Runs·Changes·Git·Files·Monitors), StatusBar.tsx, Terminal.tsx (xterm), Palette (⌘K), EmptyState.tsx, SplitPane.tsx
    theme.css   tokens from v1 Theme.swift (K.C / K.F / K.S) as CSS variables
  test/         vitest + @testing-library/react; fixtures/ captured from the real daemon and a real `claude` stream
```

### B3. Layouts
`App` = `lanes.atStart ? <JobsPage/> : <JobPage/>` under `<LaneTabs/>` (tabs: ⌂ Jobs + one per open job, with a busy dot while a turn runs), `<Terminal/>` drawer (⌘⌥T), `<StatusBar/>` (`RECONNECTING` · profile · region · branch · cumulative cost).

**Main page**
```
toolbar: [profile ▾] [region ▾] [search] [⟳]
table (react-virtual rows): Name | Mode | Glue | Workers | Last run ● | Started | Duration     double-click → lanes.openJob ; context: Open, Run…, Copy name
EmptyState — exactly one of: "No AWS profile" [Add profile…] · "SSO for `dev` expired" [Sign in → runs `aws sso login --profile dev` in the Terminal drawer]
                              · "No Glue jobs in eu-west-1" · Fault("the Glue job list", why) [Try again] · "aws CLI not found" [how to install]
```

**Job → Console tab (default)**
```
ActivityRail(60) Runs·Changes·Git·Files·Monitors │ SidePanel (resizable) │ JobPage
JobPage: tabBar [Console][Authoring]                                   [▶ Run ⌘R][■ Stop][↻ Retry]
         SplitPane(horizontal)
           middle: RunsList (● SUCCEEDED 09:14 2m31s 12.4 DPU-s  err preview…)
                   SplitPane(vertical)
                   RunDetail (state · times · duration · DPU · args · error, expandable)
                   LogConsole [output|error] [follow] [search] [clear]   virtualised, cap 5,000 lines, FollowsTail
           right:  ChatRail(debug lane, placeholder "Ask why this run failed…")
```

**Job → Authoring tab**
```
tabBar [Console][Authoring]   [⊕ Add ▾][Auto-layout][fit]                                     [Deploy ⇧⌘D]
SplitPane(horizontal)
  middle: Palette(160) │ ReactFlow canvas (minimap, controls) │ Inspector(280)
          SplitPane(vertical)
          CodeTestsPane [Code][Tests] [▶ Run tests]
             Code:  CodeMirror(job.py, read-only, highlight ranges[selectedNode], scrollIntoView)
             Tests: CodeMirror(test_<node>.py or test_pipeline.py) · output tail · results list ✓/✗ per case
  right:  ChatRail(author lane, composer on top, placeholder "Describe the pipeline…")
```
Inspector hides below 900 px middle width, palette collapses to the "Add ▾" menu below 700 px.

### B4. Stores and event routing (Zustand)
- `glue`: `profile`/`region` (localStorage), `profiles`, `jobs`, `loaded`, `failure`, `auth`, `query`; `refresh()` via `client.get` (Result, never a bare `try`); 401 `{fix}` → `auth = expired(profile)`.
- `lanes`: `open: {job, tab, worktree, debugSession?, authorSession?}[]`, `active`, `atStart`; persisted to localStorage (title + worktree, as v1's `Lanes.remember`); `openJob(name)` = `POST /api/jobs/{name}/import` + `POST /api/jobs/{name}/lane` → push lane → `job.load`, `dag.load`, `authoring.refresh`.
- `job[name]`: `runs`, `selectedRun`, `lines` (ring buffer, drop 500 from the head past 5,000), `stream`, `follow`, `search`, `logState: idle|streaming|stalled(reason)|ended`, `busy`; `select(run)` restarts the log SSE; 60 s silence → `stalled` + Reconnect; a running row's duration ticks with a `setInterval` in the row component only (`testTheMainPageDoesNotPoll` equivalent: one vitest asserting no store owns a timer).
- `chat[lane]`: `turns` (decoder output), `running`, `pending[]`, `lastEventAt`/`lastProgressAt`; `send(prompt)` opens `/api/chat` SSE with `mode`, `job`, `run`, `session`; `msg` → decoder, `fact` → turn footer (files, gate, commit, cost), `pending` (from `/api/events`) → `GET /api/approve/poll?lane=` → cards; `answer(id, decision, rules, scope)`.
- `dag[name]`: `raw` (the truth, unknown fields preserved), derived `nodes`/`edges` (`to.Inputs ∋ from`), `layout`, `rev`, `selection`, `undo/redo` (JSON snapshots, cap 50). Mutations `connect` (refuse self/dup/into-source; `// ponytail: no cycle check, AWS rejects at deploy`), `disconnect`, `remove(ids)` (strips ids from every Inputs), `add(type, at)` (`node-<uuid8>`, `schema.template`), `setField`, `rename`, `move`. Save = 300 ms debounce → `PUT /api/jobs/{name}/dag {dag, layout, rev}`; 409 → "Changed elsewhere — Reload" banner, never a silent clobber; `job.changed {name, rev}` with a foreign rev → reload (deferred while a drag is live), `selection ∩ ids` kept. React Flow gets `nodes`/`edges` derived from the store and reports `onNodesChange` (position → `move`), `onConnect` (→ `connect`), `onEdgesDelete`, `onNodesDelete`.
- `authoring[name]`: `code`, `ranges`, `testPath`, `testSource`, `output` (cap 2,000), `results`, `running`; `refresh(node)`, `runTests()` (SSE `line`/`result`/`done`, one at a time).
- `events.route`: `jobs.changed {added, removed}` → `glue.refresh` (added rows animate in, removed rows drop; an open tab for a removed job shows "deleted in AWS"); `run.changed {job, run}` → patch the row in `glue.jobs` and the runs list in `job[job]` from the payload (no refetch), OS notification on terminal states; `job.changed {name, rev?, remote?}` → `dag[name].remoteChanged(rev)`, `authoring[name].refresh`, and a "remote changed since import" badge when `remote` is present; `live.changed` → status bar; `state.changed`/`aws.auth` → `glue.refresh`; `pending {lane}` → `chat[lane].poll`; `git.changed` → side panel; `connected` → all of the above (whatever happened in the gap is gone, v1's rule).
- `live` (in `app` store): mode, sweep seconds, throttled, push status; Settings → "Live updates" card with Enable/Disable, the IAM list, and the CloudTrail note from A10.

### B5. DAG editor specifics (React Flow)
- `KeelNode`: name, type subtitle, category tint bar (source / transform / target), one target `Handle` (hidden for sources), one source `Handle` (hidden for targets); selected → accent border; the selected node's edges are `animated`.
- `isValidConnection`: target is not a source node, no self, no duplicate; Join accepts at most 2 inputs; single-input transforms replace the existing input (with a toast) rather than adding a second.
- Palette rows are `draggable`; `onDrop` uses `screenToFlowPosition` → `dag.add(type, at)`. "Add ▾" menu adds at the viewport centre.
- Auto-layout: `dagre` graph with `rankdir: LR`, `nodesep: 40`, `ranksep: 120`, node size 180×56 → `layout` → save. Runs when `layout.json` is empty or on the toolbar button. Deterministic for the tests (dagre is).
- Keyboard: Delete/Backspace, ⌘A, ⌘Z / ⇧⌘Z (store undo, wired to the Edit menu via preload), ⌘+/−/0 (`zoomIn/zoomOut/fitView`).
- Inspector = schema-driven form: `schema.ts` holds the 19 supported types with `Kind = string | int | bool | enum | stringList | mappingTable | filterExprs | joinCols | sql | code | json`; keys **identical to the daemon's codegen field names**; unknown type → JSON editor (CodeMirror, Apply with inline parse error, never auto-apply). Edits commit on blur/Enter (one undo entry each).

### B6. App tests (vitest, ≈600 LOC, fixtures captured from the real daemon and a real `claude` stream)
`decoder.test.ts` (stream.jsonl → turns with the right steps, partial deltas, usage/cost; a truncated last line is withheld) · `dag.test.ts` (round-trip preserves unknown fields; remove strips Inputs; undo restores; cap 50; own-rev ignored; foreign rev reloads; single-input transform replaces) · `layout.test.ts` (same graph twice → identical; sources at rank 0, targets last; no overlap; a 2-node cycle terminates) · `schema.test.ts` (every palette type has a template; template keys ⊆ fields ∪ {Name, Inputs, OutputSchemas}) · `wire.test.ts` (`glue-jobs.json`, `glue-runs.json` with nulls, `tests-run.sse` → 3 lines + result, 401 body → `auth = expired`) · `job.test.ts` (ring buffer cap; 60 s silence → stalled; fake timers) · `no-polling.test.ts` (grep the stores for `setInterval`/`setTimeout`; allowed list = dag save debounce, sse reconnect backoff) · `main/daemon.test.ts` (parses `KEEL_PORT=` from a fake child; kills it on quit) · one Playwright smoke in CI on mac/win/linux: launch the packaged app against a stub daemon, screenshot the three pages, and assert no orphan `keel-daemon` process after quit (the v1 budget that mattered).

## Phases (each ends with `make check` green; daemon and app phases pair up)

| # | Daemon | App | Demoable |
|---|---|---|---|
| 0 | pom, boot, argv, loopback, `ParentWatch`, `Events`, `State`, `Errors`, `Proc`; Makefile + CLAUDE.md; Windows VM check of the hook line | electron-vite scaffold, `daemon.ts` spawn with `KEEL_PORT`, theme tokens, shell (tabs, rail, status bar, terminal drawer via `/ws/term`), `events.ts`, `client.ts`/`sse.ts` | app opens on mac + win + linux, `/api/state` on the status bar; daemon dies with the app |
| 1 | `aws.*`: profiles, SSO, `GlueService`, cache, **`Sync` (inventory 5s, definitions, tiered runs, throttle backoff)**, runs, start/stop, `LogsService` | `glue` store, `JobsPage`, profile/region pickers, Add-profile sheet (v1 `AwsSso` port), SSO-expired → terminal, `run.changed` row patching, status-bar Live indicator | **Main page** that reflects console/API changes within ≤5s |
| 2 | **`LiveEvents` (SQS + EventBridge push, enable/disable, trail check)** | `job` store, `JobPage` shell, `RunsList`, `RunDetail`, `LogConsole`, `RunSheet`, OS notification on run end, Settings → Live updates card | **Console tab**: runs, detail, log tail, Run/Stop/Retry; run completions arrive in ~1s with push on |
| 3 | `agent.*`: `ClaudeRunner`, `Hook`, `Approvals`, `Turns`, `Mcp(ask_user)`, `Prompts.debug` | `decoder.ts` port, `chat` store, `ChatRail`/`TurnCard`/`Steps`/`Composer`/`ApprovalCard` | **Debugging agent** with injected run context, approval cards, cost per turn |
| 4 | `local.*` + `git.*`: import, lanes, dag/layout/job endpoints with `rev`, **`Watcher`** | `lanes.openJob`, `dag` store load, `DagEditor` read-only + `KeelNode` + dagre layout, "remote changed" badge | Import a job, see its DAG, one worktree per job; an outside edit to dag.json reloads the canvas |
| 5 | (same) | connect/drag/delete/add, undo, `schema.ts`, `Inspector` + editors | **Full visual editor** round-tripping to dag.json |
| 6 | `codegen.*` + `testing.*`: generate (+ `ranges`), test SSE, gate in the turn | `authoring` store, `CodePane`, `TestsPane` | dag.json → job.py + per-node tests → green in the Glue 5 container |
| 7 | `Prompts.author`, post-turn regenerate, `Deployer` | Deploy button (streams into Monitors), `electron-builder` for dmg/nsis/AppImage with jlink JRE, `electron-updater`, CI matrix mac/win/linux | **Authoring agent** prompt → DAG + code + tests → deploy → Glue console shows the DAG and runs the tested script; installers for three OSes |

Deferred on purpose (say so in CLAUDE.md): MCP tools for AWS beyond `ask_user` (the agent uses the `aws` CLI under the hook for now), rewind, multi-writer lane claims, wrapper-aware rule derivation (`sudo`/`env`), SDK-model marshalling instead of `aws glue … --cli-input-json`, cycle detection in the canvas, Windows SIGINT-equivalent stop, code signing for Windows/Linux (unsigned installers first), Sentry/PostHog.

## Verification (end to end)
1. `make check` — `mvn -q test` (the 9 daemon self-checks) + `pnpm test` (vitest) + `pnpm typecheck`.
2. `make dev` → the app opens on a scratch git repo. Pick an SSO profile; if expired, the empty state's Sign in button runs `aws sso login` in the terminal drawer; after login the jobs table fills without a relaunch (`state.changed` → refresh).
2b. Near-real-time: with the app on the main page, create a job in the AWS console → the row appears within 5s without a click; start a run of an idle job from the console → the row shows STARTING within one cold sweep (≤5s for ≤40 jobs), then updates every 3s; edit the job's worker count in the console → the "remote changed" badge appears within 30s (5s if the job is open). Enable Live updates in Settings → a run that finishes shows SUCCEEDED/FAILED in ~1–2s and the status bar reads `Live · push`; disable → it reads `Live · polling`. Kill the daemon's network for a minute → status bar says throttled/reconnecting, never a stale green.
3. Open a real VISUAL job: Console tab lists runs; selecting a FAILED run tails `/aws-glue/jobs/error`; ask the debug agent "why did this fail" and confirm the answer cites the injected log lines; a `Bash` the agent tries outside the allowlist raises an approval card and blocks until answered; denial reaches the agent as a reason.
4. Authoring tab: the imported DAG renders with dagre layout; drag a node, connect an edge, edit a Filter in the inspector; confirm `jobs/<name>/dag.json` changed in the worktree, `Inputs` updated, unknown fields untouched (git diff); ⌘Z reverts and re-saves; edit dag.json from a terminal and confirm the canvas reloads on `job.changed`.
5. Ask the authoring agent for a new pipeline (e.g. "CSV orders from s3://… → keep status = 'paid' → aggregate revenue by day → parquet to s3://…"); confirm it writes dag.json + layout.json, calls `/generate`, job.py appears with one function per node and the selected node's range highlights, `tests/test_<node>.py` exist, Run tests streams pytest from `public.ecr.aws/glue/aws-glue-libs:5` and the results list shows per-node pass/fail; the turn card shows the gate verdict and the auto-commit.
6. Deploy: Glue console shows the visual DAG for the job; `aws s3 cp <ScriptLocation> -` equals the local job.py; Start run from the Console tab succeeds; the "console Save regenerates the script" note appears once.
7. Quit the app on each OS: no `keel-daemon` java process remains (Playwright smoke asserts the same in CI). On Windows: the hook line runs through Git Bash, approvals arrive, Stop kills the tree.

## Open assumptions (proceeding with these unless told otherwise)
- Deploy pushes **both** the DAG (so the AWS console stays visual) **and** our tested job.py to `ScriptLocation`, overwriting Glue's regenerated script. Trade-off: a Save in the AWS console regenerates the script and discards our version; Keel says so on every deploy.
- Scripts need an S3 bucket (`scriptBucket` in `.keel/state.json`) when a job has no `ScriptLocation` yet. Configured in Settings; deploy returns a clear 400 until it is set.
- Unit tests run in Docker (the official Glue image); no Docker → the Tests pane says so with the install link and everything else still works.
- Glue Spark jobs (`glueetl`) only in v1; Python shell / streaming / Ray jobs are listed and runnable from the Console tab but not authored.
- The renderer talks to the daemon directly over loopback (no IPC relay) — simplest, and identical to how v1's app used the Rust daemon. Off-loopback binding is not offered.
- Windows and Linux need `git`, `curl` and Claude Code installed like macOS does; the app's empty states name whichever is missing.
