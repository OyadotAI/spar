# Glue Studio feature inventory → Keel gap list

Source: AWS Glue Developer Guide (the Studio user guide was folded into it), read 2026-09-02. What Keel has, what it does differently, and what is still missing.

## Jobs page
| Glue Studio | Keel |
|---|---|
| Create: Visual ETL, notebook, script editor (Python shell / Ray / Spark Python / Scala), upload script | New job (draft on a branch) · Import JSON. Notebooks: not planned (use the terminal + `claude`). |
| Table: name, type, last run status, created, last modified; search; column settings | name, mode, Glue version, workers, last run, started, duration; search. **Gap:** type/created/last-modified columns, column settings. |
| Actions: Edit, Run, Schedule, Clone, Delete (type `delete`), Run upgrade analysis | Open, Run, Clone, Export JSON, Delete (confirm). Schedule = Schedules tab. **Gap:** upgrade analysis. |
| Job run monitoring: date range; tiles running/canceled/success/failed, success rate, DPU usage; by type / worker / day; runs table with filters | Tiles for 24h (runs, succeeded, failed, running, stopped, DPU-hours, execution hours). **Gap:** date range, breakdowns, the cross-job runs table, filters. |

## Job editor
| Tab | Keel |
|---|---|
| Visual | Visual: canvas (React Flow), Add-node panel with search over the full catalogue, node panel with Properties / Output schema / Data preview, Code & Tests panes, authoring agent. |
| Script (locked; Edit script → script-only; Download; classic generator) | Script: generated job.py, copy, save as. **Gap:** "edit script" conversion to a script-only job (Keel's answer: SparkSQL/CustomCode nodes; or edit job.py of a SCRIPT job — not wired). |
| Job details | Job details: all basic + advanced properties, options as toggles on DefaultArguments, job parameters, non-overridable parameters, connections, tags (API), bookmark reset (API). **Gap:** tags UI, usage profile display, maintenance window, Python-shell-specific fields. |
| Runs | Runs: list (state, run, started, duration, DPU-hours, capacity, error), detail facts, links (console, output/error/all logs, metrics), live log console, Run/Stop/Retry, debugging agent (≈ "Troubleshoot with AI"). **Gap:** in-app metrics charts, Spark UI, job-insights streams (need logs enabled), start-up time. |
| Data quality | **Endpoint only** (`/api/glue/jobs/{name}/dq`); no tab yet. |
| Schedules | Schedules: list, create (presets + cron), activate/deactivate, delete, update (API). **Gap:** edit UI, weekly/monthly builders (cron works). |
| Version control | Keel's own: a branch + worktree per job, Commit from the toolbar, Changes panel. **Gap:** push/pull to GitHub/CodeCommit. |

## Visual canvas & node panel
| Glue Studio | Keel |
|---|---|
| "+" resource panel with Sources/Transforms/Targets + search | Add node panel with families + search; drag or double-click. |
| Node properties: name, node type dropdown, parents | Name, type dropdown (keeps name/parents/schema), parents with add/remove. |
| Output schema: view, edit keys/types, infer, use preview schema | Columns editable, Infer schema (runs the node in the Glue container). **Gap:** nested keys, multi-schema. |
| Data preview: interactive session (5 DPU, billed), 200 rows default, column picker | Preview in the local Glue 5 container against real S3, 10–500 rows, cached per DAG revision, no session cost. **Gap:** column picker; catalog/JDBC/streaming sources need AWS network access from the container. |
| Delete/undo/redo, drag connections, auto-arrange | Delete, undo/redo (⌘Z), drag connections, auto-layout, fit, minimap, marquee. |

## Node catalogue
All ~70 API node types are in the Add-node panel and deploy as-is. Typed editors exist for: S3 CSV/JSON/Parquet/Catalog sources, Change Schema (with Drop), Select/Drop Fields (checklist from upstream schema), Rename, Filter (Glue ops), Join (type + keys), Union, Aggregate, Drop Duplicates, Drop Null Fields (checkboxes), Split Fields, Select From Collection, Fill Missing Values, Spigot, SQL Query, Custom Transform, Evaluate Data Quality (DQDL text), Detect PII (main fields), Conditional Router (JSON), S3 direct/parquet/catalog targets. Everything else edits as JSON.
Local code + tests are generated for 19 types (see `docs/plan.md` A6); the rest run only in Glue. **Gap:** Glue Studio's non-API "Flatten / UUID / Identifier / To timestamp / Format timestamp / Concatenate / Split string / … " transforms (they are DynamicTransform custom visual transforms in the assets bucket).

## Elsewhere
| Glue Studio / console | Keel |
|---|---|
| Job run monitoring: tiles, success rate, DPU usage, breakdowns by type / worker / day, runs table with filters | **Monitoring** section: the same tiles and three stacked-bar breakdowns, plus every run in the window with search and status/type/worker filters, 24h–30d. |
| Run metrics (CloudWatch charts) | **Metrics** pane on a run: 14 Glue-namespace series grouped as data movement, memory, CPU, executors, progress, shuffle, with a crosshair. Says exactly why it is empty and offers to fix the role. |
| Job insights (RCA + guidance log streams) | **Insights** pane on a run, reading the two `job-insights-*` streams. |
| Spark UI in the console | **Spark UI** pane: Keel starts Spark's own history server in the Glue container against the run's S3 event logs and opens it. |
| Interactive sessions | **Sessions** section: create (role, Glue version, worker, workers, idle timeout, connections), list, stop, delete, and a statement REPL with output. Cost and idle timeout always on screen. |
| Upgrade analysis (console-only, no public API) | **Upgrade** tab: Keel's own rules for Glue 2/3/4 → 5 applied to the definition and the script, each finding with file:line, and one button that hands the whole thing to the agent, which rewrites and proves it with the container tests. |
| Connections | **Connections** section: list, create, edit, delete, test, with a per-type property picker. |
| Detection entities | **Detection entities** section: custom PII patterns with regex validation against a sample, plus the managed list. |
| Usage profiles | **Usage profiles** section: list, view, create, edit, delete, with the job/session parameter tables. |
| Custom visual transforms (Flatten, To timestamp, Concatenate, Lookup…) | Read from the account's Glue assets bucket and shown in the palette; dropping one creates a `DynamicTransform` node whose form is generated from the transform's own JSON config. |
| Output schema with nested keys | Nested `struct`/`array`/`map` keys expand and edit in place, with Infer from a real run of the node. |
| Data preview column picker | "Previewing N of M fields" with per-column checkboxes. |
| Notebooks, Amazon Q generation, streaming maintenance windows | Not in Keel. The authoring agent is the counterpart to Q; the terminal drawer plus `claude` is the counterpart to a notebook. |

## Things the account taught us
- **Glue rewrites `Command.ScriptLocation` after `UpdateJob` when the job carries a DAG**, asynchronously and later than five seconds. Keel's first deploy lost that race and a run then failed on Glue's own generated aggregate while the local tests were green. Deploy now waits for the object to settle, writes ours last, verifies for twenty seconds more, and reports `scriptIsOurs`. `scriptMode` picks the trade-off: `both` (default), `visual` (Glue's script, fully visual console), `tested` (SCRIPT mode, our code, no canvas in the console).
- **No logs, metrics or insights is a role problem, not a job problem.** The panes detect it, name the missing permission, show the policy and attach it on one click when your own credentials may.
