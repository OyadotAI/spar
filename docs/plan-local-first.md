# keel-v2 — local-first Glue: DX overhaul, error intelligence, IAM simplification

## Context

The feature build is done: `/Users/mk/Dev/oya/keel-v2` has a Java daemon (93 endpoints) and an Electron app that
reach Glue Studio parity on the surfaces that matter, verified against a real account (`docs/glue-studio-inventory.md`).
The user's verdict on this state: **"feature wise it almost complete now but the DX & UX is awful"**, plus three
instructions — address the real pain of debugging Glue, make the product **local-first as the differentiator**, and
**simplify the IAM**.

Two audits back that up.

**What the codebase does to a new user** (self-audit, file references in `docs/dx-audit.md` after this lands):
- First launch never asks for a project. `app/src/main/index.ts:20` returns `app.getPath('home')`, so the daemon
  points at `$HOME`, `Watcher` creates `~/jobs` and `~/.keel`, and the first job creation reaches
  `git/Lanes.java:31` which runs **`git init` and `git add -A` on the user's home directory**. This is the worst
  thing in the repo and it is one line.
- Three operations routinely outlive the client's hard 90 s timeout, so successful work is reported as failure:
  `Deployer.settle`+`verify` (110 s), `Preview` (10 min, and it pulls 7 GB inline with no progress),
  `Sessions.run` (15 min). `app/src/renderer/api/client.ts:10`.
- `⌘K` "Command Palette" is in the menu, sends an IPC message, and nothing handles it.
- Six top-level screens' entire no-credentials story is "Could not read X" and a dead Try again button; only the
  jobs page turns the 400 into a real call to action.
- Six irreversible AWS deletes are gated by native `window.confirm`; ~42 renderer call sites drop errors silently,
  including Run from the jobs table, the profile switch, and Save script bucket.
- No offline cache: a laptop that wakes with an expired token cannot show the *names* of jobs it listed a minute ago.
- The whole author → generate → test loop already needs **zero AWS**, and nothing in the product says so.

**What data engineers actually complain about** (~80 sources: Stack Overflow API, AWS re:Post, GitHub, HN, docs;
Reddit was unreachable, so community sentiment is under-weighted). The top-voted `aws-glue` questions of all time are
not transformation questions — #1 is "crawler created nothing and I can't find out why" and #4, at 88,868 views, is
"where did my log line go". A third of Glue questions asked since 2024 have **zero answers**. The ranked pain:

| # | Pain | Best evidence |
|---|---|---|
| 1 | **Errors name the wrong subsystem** — an IAM-worded crawler error fixed by configuring a VPC; `pyWriteDynamicFrame … Illegal empty schema` means the *read* returned nothing; `NullPointerException` means a missing Lake Formation grant | [re:Post crawler/VPC](https://repost.aws/questions/QURERSq8BWQyyMLIChAOptRw/) · AWS KC: *"'Command failed with exit code X' is a generic error message"* |
| 2 | **Log lines scatter across up to 8 destinations**; executors are streams suffixed `_g-xxxxxx` you must match by hand | [SO 48914324](https://stackoverflow.com/questions/48914324) (45 votes / 88,868 views) |
| 3 | **Bookmarks fail nine ways with opaque state**, including writing NULL foreign keys under a green "Succeeded" | [SO 71872004](https://stackoverflow.com/questions/71872004) · *"AWS Glue job bookmarking details are not available for customers"* |
| 4 | **The Py4J wall** — six layers, an `o123` handle that changes every run | [HN](https://news.ycombinator.com/item?id=38279171): *"you can't debug it when it errors because all that is 'conveniently' obfuscated"* |
| 6 | **The local container cannot exercise bookmarks, catalog, glueparquet, DQ, PII**; AWS's answer is "test on Glue jobs, not in the container" | [aws-glue-libs #200](https://github.com/awslabs/aws-glue-libs/issues/200): *"Still the case in 2026… we don't want to code in the browser"* |
| 7 | **Interactive Sessions bill from creation**, default 5 DPU / 48 h idle, survive closing the tab | [re:Post](https://repost.aws/questions/QU_Ff-QeM7Ta2Bg9TwLd0agw/): *"6-7 hours of testing… $160… 365.766 DPU-Hours"* |
| 9 | **A misconfigured role produces no logs at all** — the likeliest cause of failure is the best at hiding itself | [SO 47060022](https://stackoverflow.com/questions/47060022) |
| 10 | **Cold start + deploy + log wait** makes a typo cost the same as a real bug | measured here: 10 s Spark cold start in the Glue 5 container, ~75 s for a trivial cloud run |
| 13 | **Visual → script is a permanent one-way door**, and the canvas will not propagate its own schema without a *billed* preview session | [re:Post, AWS support conceding](https://repost.aws/questions/QUKkdPHMuIRGWCMlRH_PGU2Q/) |
| 15 | **Pushdown fails silently**; AWS's official verification is to time two runs by hand | [re:Post, AWS expert](https://repost.aws/questions/QU0vMOgiWeQSODlLctBcGvcA/) |

Every one of those is a thing a **local, offline, deterministic** tool can beat. That is the differentiator, and it
is what this plan builds.

**Decisions taken (asked and answered):** warm local engine that idle-stops · capture real samples, gitignored ·
read-only IAM by default with opt-in tiers and a `SimulatePrincipalPolicy` preflight · error rules first, agent for
the rest.

**Proven during planning, so the plan rests on facts not hope:**
- Spark cold start in `public.ecr.aws/glue/aws-glue-libs:5` is 5.9 s plus 3.8 s to first action.
- The image sets `spark.eventLog.enabled true` → `file:///var/log/spark/apps` and ships a history server on 18080,
  so **a local run yields a real Spark UI with no AWS**.
- `create_dynamic_frame.from_catalog` cannot be satisfied by Spark's own catalog (it calls `getCatalogSource`), but a
  **Python shim that replaces `glueContext.create_dynamic_frame` works** — verified in the container: a catalog read
  served from a local CSV returned its rows. That is how offline catalog/JDBC sources will work.
- `iam:SimulatePrincipalPolicy` is in the SDK already on the classpath.

---

## Part A — Local first (the differentiator)

### A1. The warm engine — `daemon/src/main/java/ai/oya/keel/engine/Engine.java` (new)

One container per project, `keel-engine-<project hash>`, running a small stdlib HTTP server inside the Glue 5 image
that holds a live `SparkSession` + `GlueContext` and reloads `job.py` per request (`importlib.reload`).

- `POST /run {kind: preview|schema|test|pipeline, job, node, rows, samples}` → JSON. Preview drops from ~10 s to
  **~1 s**; per-node test likewise.
- Started lazily on the first local action, **idle-stopped after 10 minutes** (configurable), always stopped on
  daemon exit via the existing `ParentWatch`. Status and a Stop button live in the status bar.
- Mounts the job folder and `~/.aws` read-only; runs with **no AWS env at all** in local mode.
- `Preview.java` and `TestRunner.java` keep their endpoints and their `job/node@rev` cache
  (`testing/Preview.java:50`) but call the engine when it is up, falling back to today's `docker run` when it is not.
  Nothing that works today stops working.
- The driver script inside the engine is `engine/driver.py`, shipped as a daemon resource, not generated.

### A2. Local sources — `daemon/src/main/java/ai/oya/keel/local/Samples.java` + `engine/keel_local.py` (new)

The shim proven above, installed by the engine and by `tests/conftest.py`:

- `jobs/<name>/samples/<nodeId>.{csv,json,parquet}` plus `samples/manifest.json` (source → path, format, row count,
  captured-at, and the SHA of the schema it was captured against).
- `keel_local.install(glueContext, manifest)` replaces `create_dynamic_frame.from_catalog` / `.from_options` so
  **catalog, JDBC, Redshift and S3 sources all read local files**. Targets write to `jobs/<name>/out/` instead of S3.
- **Capture** (`POST /api/jobs/{name}/samples/{node}?rows=N`): pulls N rows from the real source once — S3 via the
  existing `GlueService`, catalog via the engine — writes the sample, and records the manifest. Gitignored by
  default (`Project.ensureDir` already writes the jobs `.gitignore`); an explicit "Commit this fixture" action moves
  it out of the ignore list.
- **Synthetic fallback** when there is no AWS and no sample: rows generated from `OutputSchemas`, which is what
  `TestGen.rows` already does — reuse it (`codegen/TestGen.java:71`).
- Node panel gains a **Sample** row: captured / synthetic / none, row count, age, Capture and Clear.

### A3. Local run — `POST /api/jobs/{name}/run/local` (SSE)

`spark-submit` the generated `job.py` in the engine against the samples, writing to `jobs/<name>/out/`, with
`--enable-metrics`-style local counters. Streams the same `line` / `result` events the test runner already uses, so
the app reuses `authoring/store.ts`.
- Reports **input files read, rows in/out per node, partitions pruned** (from the Spark plan), which answers pain #15
  — pushdown verification — without timing two cloud runs by hand.
- The run's Spark event log is written to a mounted dir, so **Spark UI works locally**: the existing
  `aws/SparkUi.java` gains a local mode pointed at that dir instead of S3.
- **Bookmarks are simulated locally** (`.keel/bookmarks/<job>.json`, the files a local run consumed) and labelled
  *simulated* everywhere they appear. This is the one place we imitate a Glue behaviour the container lacks; the
  label is not optional.

### A4. Offline everything else

- **Disk-backed caches**: `JobsCache` and `Project.revs` persist to `.keel/cache/{jobs,revs}.json`, so the jobs list,
  its last run states and the DAG revisions survive a restart or an expired token. The list renders immediately from
  cache with an "as of <time>, offline" note; `GlueController.jobs()` stops 502-ing on an empty cache.
- **`stores/lanes.ts:33` stops calling `/import`** for a job with a local folder — today opening any local draft
  fires a guaranteed-failing AWS round trip.
- **`AwsClients.profile()`** keeps throwing 400, but every renderer store maps that one status to a shared
  `NoAws` state, so all six screens get the jobs page's treatment: what is unavailable, what still works offline,
  and one button to connect.

---

## Part B — Error intelligence (pains 1, 2, 4, 9)

### B1. The catalogue — `daemon/src/main/java/ai/oya/keel/triage/Signatures.java` (new)

~40 signatures from the research, each: a matcher (regex over the run's error message, log tail and state), the
**real** cause, the evidence that matched, and the fix. Handles are normalised (`o\d+` → `o…`) so a signature is
stable across runs. Seed set, all sourced:

- `Command failed with exit code 1/10` → generic; branch on what else is in the log (OOM, missing script permission,
  Python error).
- `pyWriteDynamicFrame … Illegal empty schema` → **the read returned nothing**; look upstream for a timeout or a
  permission error that did not fail the job.
- `pyWriteDynamicFrame … NullPointerException` on a catalog target → **missing Lake Formation grant**.
- `Access Denied` on write → check the **temp bucket** (`--TempDir`), not the target.
- `No space left on device`, including when wrapped as `SparkOutOfMemoryError … spill()` → **worker local disk**, not
  memory; suggest `--write-shuffle-files-to-s3` or a bigger worker.
- Driver vs executor OOM, told apart by which heap metric moved.
- `Could not find S3 endpoint or NAT gateway` → the job downloads **its own script** from S3; a VPC gateway endpoint
  is needed even if the job reads no S3.
- `At least one security group must open all ingress ports` → the self-referencing **all-TCP** rule, not port 0.
- `InsufficientFreeAddressesInSubnet` / ENI exhaustion → one ENI per worker; the sizing rule.
- `is not authorized to perform: iam:PassRole` → the error names **your** identity, not the job role.
- `EntityNotFoundException` → missing `glue:GetTable` **or** a genuinely missing table; say both.
- `GlueArgumentError: --JOB_NAME` → running outside a job run.
- `Datasource does not support writing empty or nested empty schemas` → bookmarks + an empty increment.
- `glueparquet format not supported for developer environment` → local-only limitation, with the workaround's caveat.
- Crawler "Verify the permissions in the policies attached to the IAM role" → **check the connection's VPC, subnet
  and security group first**; this is the #1 mis-signposted error in the corpus.

`GET /api/glue/jobs/{name}/runs/{id}/triage` returns matches ranked by confidence with the matched evidence quoted.
Unmatched failures hand off to the debugging agent with the run context already loaded, which the chat does today.

### B2. Where did my log line go — `console/LogConsole` + `LogsService`

- One search box across **all** groups and streams, with a stream picker that labels `-driver` and the `_g-…`
  executor streams by executor number, so pain #2 stops being manual correlation.
- A "Where do my prints go?" explainer, driven by the job's own flags: with continuous logging on, `print` →
  `/aws-glue/jobs/output`, `get_logger()` → `logs-v2`; off, everything but the Glue logger → `output`. It reads the
  job's actual arguments rather than reciting the docs.
- **Glue 5.0 removed continuous logging** — say so on the Job details toggle rather than letting the user set a flag
  that no longer exists.

### B3. Static lint on the DAG — `daemon/.../codegen/Lint.java` (new)

Runs on every save, shown as node badges and a Problems list:
- **Join + bookmarks** on one side only → the NULL-foreign-key trap (pain #3), with the run that would produce it.
- `ApplyMapping` that drops columns the upstream schema has → silent column loss.
- `resolveChoice`/`make_cols` renaming columns downstream nodes still reference.
- A DataFrame-only path that forfeits bookmarks, and a DynamicFrame path where a DataFrame would be 4–7× faster —
  stated as a trade-off, not a rule.
- `push_down_predicate` on a source type that ignores it (JDBC).
- A node type the local runtime cannot exercise (glueparquet, DQ, PII, FindMatches) → "will not be covered by local
  tests", so the gap is visible before the cloud run.

### B4. Bookmarks, made legible — `job/Bookmarks.tsx` + `aws/JobActions.java`

The cursor Glue will give (`GetJobBookmark`), what it means, when it last moved, the local simulation's file list,
the lint warnings above, and a **type-to-confirm** reset that says what reprocessing implies. Today
`ResetJobBookmark` has no confirmation at all.

---

## Part C — IAM, simplified

### C1. Three policies, generated for the user's account — `daemon/.../aws/Policies.java` (new)

Replaces the current 65-action free-for-all. Each is emitted as JSON, CloudFormation and Terraform, scoped to the
selected region, account and the buckets actually in use:

| Tier | Contains | Default |
|---|---|---|
| **Read** | `glue:Get*`/`List*`/`BatchGet*`, `logs:Describe*`/`Get*`/`FilterLogEvents`, `cloudwatch:GetMetricData`/`ListMetrics`, `s3:GetObject`/`ListBucket` on the script and data buckets, `sts:GetCallerIdentity` | **on** |
| **Author** | `glue:CreateJob`/`UpdateJob`/`DeleteJob`, `s3:PutObject` on the scripts prefix, trigger create/update/delete, tags | off |
| **Operate** | `glue:StartJobRun`/`BatchStopJobRun`/`ResetJobBookmark`, sessions, connection/entity/profile writes | off |
| **Add-ons** | Live events (`sqs:*`, `events:*` on `keel-live-*`), the role-grant helper (`iam:PutRolePolicy`), `cloudtrail:DescribeTrails` | off, each with its own switch |

The daemon **enforces the tier locally**: a write endpoint returns 403 with "Author is off in Settings" before any
AWS call, so a read-only install cannot mutate the account even if the credentials would allow it.

### C2. Preflight — `GET /api/aws/preflight`

`iam:SimulatePrincipalPolicy` over the tier's action list (falling back to a cheap probe per service when simulation
itself is denied) returns, per action: allowed / denied / unknown, and **which features that disables**. Shown once
on connect and from Settings. This turns "it failed after four minutes" into "these three actions are missing, so
Metrics and Schedules are off".

### C3. Graceful degradation

Every feature declares the permissions it needs. A denied permission disables its control with the reason in the
tooltip, instead of an error after the click. `RoleCheck` (`aws/RoleCheck.java`) is already the model for this — the
job-role observability grant stays exactly as it is, and the rest of the app is brought up to it.

### C4. Ask for less

`sts:GetCallerIdentity` is called on hot paths (`CustomTransforms.bucket`, `JobActions.arn`) — cache it per profile.
`cloudtrail:DescribeTrails` and all IAM reads move behind their switches. Nothing outside Read is called at startup.

---

## Part D — The DX overhaul

### D1. First run (the dangerous one first)

- `app/src/main/index.ts:20` **never returns `$HOME`**. With no remembered project the app opens a **Welcome**
  screen: pick or create a folder, choose **Local only** or **Connect AWS**, and a tool checklist (`claude`,
  `docker`, `git`, `aws`) built from `/api/state`, each with a one-line fix. `Tools.detect()` already ships all four
  and only `aws` is read today.
- The daemon **refuses a project that is `$HOME`, a filesystem root, or a non-empty directory that is not a git repo**,
  and says why. `Lanes.ensure` never runs `git init` on a directory the user did not choose for this.

### D2. Long operations stop lying

An operations tray: deploy, local run, tests, preview, session statements and the 7 GB image pull each become a
tracked operation with progress, a Stop button and a result, driven by the SSE pattern
`TestRunner` already uses. `api/client.ts` grows a per-call timeout and the three offenders
(`Deployer`, `Preview`, `Sessions.run`) move to streams. **Nothing reports failure while it is still succeeding.**
`Preview` gains the `docker pull` progress step `TestRunner.java:74` already has.

### D3. Say what happened

- A toast/inline-error convention, and the ~42 silent `if (r.ok)` sites are fixed — starting with Run from the jobs
  table, the profile switch and Save script bucket.
- Native `alert`/`prompt`/`confirm` (11 sites) become in-app sheets; irreversible AWS deletes get **type-to-confirm**.
- `InsightsPane` and `CatalogPicker` stop rendering nothing on failure.

### D4. Make it navigable

`⌘K` command palette (already advertised in the menu and unhandled), `⌘W` close tab, `⌘1-9` switch tabs, `⌘F` focus
search, `Esc` closes sheets, arrow keys in the jobs and runs tables, and a "what's slow" fix for
`Monitor.monitor()` — it currently fans out one `GetJobRuns` per job, serially, outside the rate limiter, inside one
HTTP request.

### D5. Say that it is local first

The jobs page's no-AWS state offers **"Start a local job"** as a first-class action beside "Connect AWS". Every
surface that works offline says so; every surface that cannot names the one thing it needs.

---

## Order of work

Each phase ends with `make check` green and is usable on its own.

| # | Phase | What it buys |
|---|---|---|
| 1 | **Stop the bleeding**: first-run Welcome + project guard, the three timeout offenders, silent-error sweep, native dialogs → sheets, `⌘K` and the keyboard set | The app stops being dangerous and starts feeling finished |
| 2 | **Warm engine + local sources**: `Engine`, `keel_local.py`, `Samples`, capture/synthetic, preview and per-node tests on the engine | Previews ~1 s; the whole loop runs with no AWS |
| 3 | **Local run + local Spark UI + simulated bookmarks + pushdown report** | A real run, locally, with the evidence Glue makes you buy a session for |
| 4 | **Error intelligence**: `Signatures`, triage on a failed run, log-destination explainer, unified log search, DAG lint, bookmark inspector | The top four pains, answered offline |
| 5 | **IAM**: three tiers, local enforcement, `SimulatePrincipalPolicy` preflight, graceful degradation, ask-for-less | Read-only by default; failures named before they happen |
| 6 | **Offline durability**: disk-backed job/rev caches, offline banner, no-AWS states across all six screens | The app is useful on a plane |

## Verification

1. `make check` — daemon JUnit (adds: signature matching against captured error fixtures, sample manifest
   round-trip, policy generation, tier enforcement) and app vitest (adds: no-AWS state per screen, operations tray,
   palette).
2. **First run, clean profile**: launch with `KEEL_USERDATA` empty → Welcome appears, `$HOME` is refused with a
   reason, choosing a new folder produces a git repo *there* and nowhere else.
3. **Offline loop, network off**: create a job, add a source with a synthetic sample, edit the DAG, generate, preview
   (< 2 s after the engine warms), run tests, run the pipeline locally, open the local Spark UI. No AWS call is made —
   assert by running the daemon with `AWS_PROFILE` unset and `~/.aws` unreadable.
4. **Capture**: with the profile on, capture a sample from `s3://aws-glue-assets-016365604072-us-east-2/keel-smoke/`,
   confirm it lands in `samples/`, is gitignored, and that the same preview then works with the network off.
5. **Triage**: force the two failures we already have evidence for — the `country` AnalysisException from the real
   failed run, and a deliberate permission error — and confirm the signature names the real cause with its evidence.
6. **IAM**: with Author and Operate off, deploy and Run are disabled with a reason and no AWS call leaves the daemon;
   the preflight lists exactly what the `default` profile lacks (it has no `iam:PutRolePolicy` today, so that add-on
   must report denied rather than fail on click).
7. **Long operations**: deploy `keel-smoke` and confirm the tray tracks it past 90 s without reporting failure.
8. Quit: no `keel-engine-*` or `keel-daemon` process survives.

## Deliberately not in this plan

Notebooks, Amazon Q parity, crawler management, Lake Formation administration, and a local Data Quality or PII
engine. Where the local runtime cannot exercise a node, the lint says so before the cloud run rather than pretending.
