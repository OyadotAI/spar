# SparData for AWS Glue Studio

A local-first desktop ADE for AWS Glue jobs. Every Glue job in your account on one page, updating on its own;
a Console with the run history and a live CloudWatch tail beside a debugging agent that already has
the failed run's log in front of it; and an Authoring tab where a visual DAG editor and an agent
edit the same `dag.json`, SparData generates the PySpark, and pytest runs inside AWS's own Glue image
before anything is deployed.

Website: [spardata.dev](https://spardata.dev) · Repository: [github.com/OyadotAI/spar](https://github.com/OyadotAI/spar)

macOS, Windows and Linux. A Java daemon on loopback does the work; an Electron app is the window.
The agent is your own `claude` (Claude Code) — no API key, and every risky tool call blocks on an
approval card in the window.

```
make check     # the gate: daemon tests (JUnit) + app typecheck + app tests (vitest)
make dev       # build the daemon jar and run the app against it
make dist      # installers for this OS with a bundled JRE (dmg / nsis / AppImage)
```

Needs: JDK 21 to build (`brew install openjdk@21`), pnpm, Docker (for running job tests in
`public.ecr.aws/glue/aws-glue-libs:5`), the `aws` CLI, `git`, and Claude Code on PATH.

## How a job lives on disk

```
jobs/<name>/
  job.json      the Glue Job properties, verbatim API shape, minus the DAG
  dag.json      CodeGenConfigurationNodes, verbatim — what the canvas and the agent edit
  layout.json   node positions (not part of the AWS API)
  job.py        GENERATED from dag.json: one function per node + main(); do not hand-edit
  tests/        pytest: conftest.py, test_<node>.py per node, test_pipeline.py
```

Each job gets its own branch and worktree (`.keel/worktrees/<name>` on `keel/<name>`). Deploy
pushes the DAG (so the AWS console stays visual) and then the tested `job.py` to the job's
`ScriptLocation`. A Save in the AWS console regenerates the script; SparData says so on every deploy.

## Near real time

Glue only pushes terminal run states through EventBridge, and only CloudTrail carries CreateJob /
UpdateJob / StartJobRun. So the daemon polls (`ListJobs` every 5s, `BatchGetJobs` every 30s, runs
every 3s while live and on an adaptive sweep otherwise) and, when you enable it in Settings, adds
an SQS queue fed by two EventBridge rules so completions arrive in about a second. Files edited
outside SparData are watched too. Nothing in the window polls.

The design, with the reasons, is in [`docs/plan.md`](docs/plan.md); the working agreement for
contributors is [`CLAUDE.md`](CLAUDE.md).
