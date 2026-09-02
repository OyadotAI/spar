# Local first

Keel's differentiator is that the whole authoring loop — build the DAG, generate the code, run the
tests, run the pipeline, look at the Spark UI — happens on this machine, with no AWS account, no
interactive session and no bill. AWS is needed for three things only: importing an existing job,
deploying, and running in the cloud.

This document says how that works and what it deliberately does not cover.

## The warm engine

`engine/Engine.java` keeps one container per project — `keel-engine-<project hash>`, built from
`public.ecr.aws/glue/aws-glue-libs:5` — running `engine/driver.py`, a stdlib HTTP server that holds
a live `SparkSession` and `GlueContext` and executes a script we POST to it.

Measured on this machine, against the seven-node `keel-smoke` job:

| | |
|---|---|
| Spark cold start in the image | 5.9 s + 3.8 s to first action |
| First preview (engine starting) | ~5.5 s |
| Every preview after that | 0.14 – 0.41 s |
| Whole pipeline, seven nodes, locally | ~5.3 s cold, under a second warm |

It idle-stops after ten minutes, stops on daemon exit (`@PreDestroy`, verified: no container
survives the daemon), and can be stopped by hand from the status bar. `Preview` falls back to the
old one-shot `docker run` whenever the engine is unavailable, so nothing that worked before depends
on it.

## Local sources

A Glue source's `transformation_ctx` is its DAG node id. That one fact is what makes local reads
possible without emulating anything: `engine/keel_local.py` replaces `glueContext.create_dynamic_frame`
and `glueContext.write_dynamic_frame` with objects that map a node id to a file. Catalog, JDBC,
Redshift and S3 sources all read `jobs/<name>/samples/<node>.json`; targets write to
`jobs/<name>/out/<node>/`.

`create_dynamic_frame` is a read-only property on `GlueContext`, so the shim gives the one instance
a private subclass and hangs the replacement off that. The generated `job.py` is never modified:
what runs locally is the code that will run in Glue.

Samples come from one of two places:

- **Captured** — `POST /api/jobs/{name}/samples/{node}/capture` reads the real source once, with
  your profile, and keeps the rows. Everything after that is offline.
- **Synthetic** — generated from the node's own `OutputSchemas`, with two corrections that matter:
  a downstream `Filter` comparing a column to a constant contributes that constant, and a column an
  `ApplyMapping` will cast to a number is written as a number. Without those, invented rows are
  filtered away or cast to NULL and the pipeline looks broken when it is not.

Captured rows are somebody's production data, so `jobs/.gitignore` excludes `*/samples/**` and one
job opts back in with `!<job>/samples/**` — the negation has that shape because git cannot
re-include a file whose parent directory is excluded.

## Local runs

`GET /api/jobs/{name}/run/local` (SSE) runs every node in topological order and reports:

- rows and columns out of each node,
- every file written, with its row count and format,
- what the local runtime **cannot** exercise — catalog, data quality, PII, FindMatches, streaming
  nodes, and any push-down predicate, which reads a local sample here and so proves nothing about
  partition pruning in S3.

That last list is the honest half. Spark's own plan is not reported: a DynamicFrame round-trips
through an RDD, so the plan says `ExistingRDD` and nothing about pushdown. A number that looks like
evidence and is not is worse than no number.

**Spark UI**: the engine mounts the image's event-log directory out to `.keel/spark-events`, so
`POST /api/engine/sparkui` starts Spark's own history server on the local logs. No S3, no
`--enable-spark-ui`. (Fixing this also fixed the cloud path, which passed its configuration as
arguments after the class name, where the history server ignores it and prints its usage.)

**Simulated bookmarks**: with the switch on, a local run skips files an earlier local run consumed,
recorded in `.keel/bookmarks/<job>.json`. It is labelled *simulated* everywhere it appears and never
touches Glue's own bookmark. It reproduces the trap that matters: the second run reads nothing, the
frame loses its schema, and the job fails with `A column ... cannot be resolved` — the same failure
this account produced in the cloud.

## What still needs AWS

Importing a job, deploying, cloud runs, crawlers, Lake Formation, data quality evaluation, PII
detection, and interactive sessions. The DAG lint names the nodes a local run cannot cover before
the cloud run rather than after it.
