# Errors, explained before you open a log

The most-viewed questions about Glue are not about transformations. The top one is "the crawler
created nothing and I cannot find out why"; the fourth, at 88,868 views, is "where did my log line
go". A third of Glue questions asked since 2024 have no answer at all. The common thread is that
Glue's messages name the wrong subsystem.

## Signatures

`triage/Signatures.java` holds ~30 rules. Each has a matcher, the real cause, the fix, and a
confidence. `GET /api/glue/jobs/{name}/runs/{id}/triage` matches them against the run's error
message and the last 200 lines of its error log, and returns them ranked, each with **the line that
matched** so the claim can be checked instead of believed. Py4J handles (`o412`) are normalised
before matching, so a rule is stable across runs.

The ones that pay for the whole file:

| Glue says | It actually is |
|---|---|
| `pyWriteDynamicFrame … Illegal empty schema` | the **read** returned nothing |
| `NullPointerException` on a catalog node | a missing **Lake Formation** grant |
| `is not authorized to perform: iam:PassRole` | **your** identity, not the job role |
| `Could not find S3 endpoint or NAT gateway` | the job downloads **its own script** from S3 |
| `SparkOutOfMemoryError … spill()` | the worker's **local disk**, not memory |
| `Command failed with exit code 1` | nothing; the cause is above it, or there are no logs at all |
| `Verify the permissions in the policies attached to the IAM role` (crawler) | usually the **VPC**, not the policy |
| `A column … cannot be resolved` on an empty frame | a **schema loss**, not a typo |

Verified against this account's own failed run: the diagnosis names the schema loss and quotes the
line.

## Where do my prints go

`GET /api/glue/jobs/{name}/logs/where` answers from the job's own arguments rather than from the
documentation: with continuous logging on, `print` goes to `/aws-glue/jobs/output` and the Glue
logger to `logs-v2`; with it off, everything but stdout lands in `/aws-glue/jobs/error`. Executor
streams are `<run id>_g-<executor>`, which is an executor id and not a timestamp. On Glue 5.0 it
says plainly that continuous logging was removed, so setting the flag does nothing.

## Lint, before anything runs

`codegen/Lint.java` runs on every save, with no AWS and no Spark. It looks for the failures that
never produce an error message:

- **`join-bookmarks`** — a join whose two sides are both bookmarked. After the first run the
  dimension side is empty, the join matches nothing, and its columns are written as NULL, with the
  run marked *Succeeded*.
- **`mapping-drops`** — an `ApplyMapping` keeps only what it lists; anything else is gone silently.
- **`missing-column` / `renamed-column`** — a node still names a column that a `SelectFields`,
  `DropFields` or `RenameField` upstream no longer passes through.
- **`pushdown-ignored`** — a push-down predicate on a JDBC source, which reads the whole table.
- **`not-local`** — node types no local run or test can exercise.
- **`no-schema`**, **`join-duplicate-columns`**, **`mapping-cast`**, **`no-target`**.

Findings show as a badge on the node and a Problems list on the canvas.
