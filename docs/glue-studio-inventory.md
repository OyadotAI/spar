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
Interactive sessions, notebooks, Amazon Q generation (Keel's authoring agent is the counterpart), custom visual transforms, connections management, detection entities, usage profiles, streaming maintenance windows: not in Keel v2.
