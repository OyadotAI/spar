<div align="center">

# ⚡ SparData

### The Local-First Desktop Workbench for AWS Glue & PySpark

**Visual DAG authoring · Instant local pytest in Glue 5 containers · Zero-API-key AI debugging · Free local Spark UI**

[![Website](https://img.shields.io/badge/website-spardata.dev-blue?style=flat-square)](https://spardata.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/v/release/OyadotAI/spar?style=flat-square&color=indigo)](https://github.com/OyadotAI/spar/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blueviolet?style=flat-square)]()
[![Glue](https://img.shields.io/badge/AWS%20Glue-2.0%20%7C%203.0%20%7C%204.0%20%7C%205.0-orange?style=flat-square)]()

<br />

```
   ┌───────────────────────┐          ┌───────────────────────┐
   │    Visual DAG Canvas   │ ◄──────► │   Generated PySpark   │
   │  Sources · Transforms  │          │   100% Glue parity    │
   └───────────┬───────────┘          └───────────┬───────────┘
               │                                  │
               ▼                                  ▼
   ┌──────────────────────────────────────────────────────────┐
   │          Instant Local Container Tests (pytest)          │
   │         public.ecr.aws/glue/aws-glue-libs:5 (1.4s)       │
   └───────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌───────────────────────┐             ┌───────────────────────┐
│  AI Debugging Agent   │             │   Free Local Spark UI │
│ Powered by Claude CLI │             │  Zero S3 setup needed │
└───────────────────────┘             └───────────────────────┘
```

</div>

---

## 🛑 The Problem with Developing AWS Glue Jobs

Every data engineer knows the pain of building Glue ETL pipelines in the cloud:

1. **Slow Feedback Loop**: You change one line of code, trigger a cloud test run, wait 2–5 minutes for DPUs to provision, and pay $0.44/DPU-hour just to hit a `KeyError` or schema mismatch.
2. **Locked Visual Editors**: In the AWS console, modifying code manually breaks the visual canvas permanently.
3. **CloudWatch Log Labyrinths**: When a distributed job fails, finding the root-cause driver traceback buried across dozens of log streams takes 20 minutes.
4. **No True Local Testing**: Testing Spark transformations locally with AWS Glue DynamicFrames requires tedious manual container and classpath wrangling.

---

## 🚀 The SparData Solution

**SparData** is a native, local-first ADE designed specifically for AWS Glue and PySpark data engineers.

Build your DAG visually, inspect generated PySpark code, run unit tests against sample datasets inside AWS's official Glue 5 container in **under 2 seconds**, and deploy verified pipelines to AWS with a single click.

---

## ✨ Key Features

### ⚡ 1. Local PySpark Simulation & Pytest in Seconds
- Runs your pipeline locally inside AWS’s official container (`public.ecr.aws/glue/aws-glue-libs:5`).
- Scaffolds node-level tests and whole-pipeline pytest suites automatically.
- Validates transforms, schema evolutions, and null-handling without touching AWS or incurring cloud bills.

### 🎨 2. Bi-directional Visual DAG ↔ Clean PySpark
- Full visual authoring canvas for Glue sources, transforms, and targets.
- Cleanly generates modular, readable PySpark (`job.py`) with node-isolated functions: `def <node_name>(glueContext, <inputs>) -> DynamicFrame`.
- 100% Glue Studio parity — your visual DAGs and deployed scripts stay in sync.

### 🤖 3. Built-In AI Agent (Zero API Key Required)
- Drives your local `claude` (Claude Code) CLI directly.
- **No API key exposure** — uses your existing Claude subscription safely.
- **Human-in-the-loop safeguards**: Risky tool calls (filesystem edits, AWS commands) block on in-app approval cards.
- Autonomously builds pipelines, writes transform logic, and writes test fixtures.

### 📊 4. Free Local Spark UI
- Spin up Spark's official History Server on local engine event logs with zero S3 lag.
- Inspect DAG stages, task execution times, memory spill, and partition distributions instantly.
- Also supports streaming and parsing historical S3 event logs from past cloud executions.

### 🔍 5. Automated CloudWatch Error Intelligence
- Real-time CloudWatch log tailing and automated root-cause analysis for failed DPU runs.
- Isolates driver OutOfMemory (OOM) exceptions, schema mismatches, and IAM permission faults in one click.

### 🛡️ 6. Isolated Git Branch & Worktree per Job
- Every job gets its own isolated branch and worktree (`.keel/worktrees/<name>`).
- Safely experiment on separate drafts without polluting your main branch.
- Unified diff view displays uncommitted changes before pushing.

---

## 📦 How a Job Lives on Disk

SparData stores your pipelines in a transparent, git-friendly folder structure:

```text
jobs/<job-name>/
├── job.json        # Glue Job configuration (WorkerType, GlueVersion, Timeout, DefaultArguments)
├── dag.json        # CodeGenConfigurationNodes schema (what the canvas & agent edit)
├── layout.json     # Visual canvas node positions
├── job.py          # GENERATED PySpark script (one function per node + main)
└── tests/          # Pytest suite
    ├── conftest.py          # GlueContext & DynamicFrame test fixtures
    ├── test_<node>.py       # Per-node isolated unit tests
    └── test_pipeline.py     # End-to-end pipeline integration test
```

---

## 🥊 Comparison: AWS Glue Console vs. SparData

| Capability | AWS Glue Console | SparData (`spardata.dev`) |
| :--- | :--- | :--- |
| **Testing Speed** | 2–5 minutes per cloud run start | **&lt; 2 seconds** local container test |
| **Cost per Test** | ~$0.44+ per DPU-hour | **$0.00** (Runs locally on sample data) |
| **Visual + Code Sync** | Locked editor (editing code breaks canvas) | **Bi-directional** visual DAG + PySpark |
| **Spark History UI** | Requires live session billing | **Instant free** local Spark UI |
| **AI Assistance** | Generic chat | **Context-aware agent** with local diffs |
| **Version Control** | Manual export / CodeCommit | **Automated branch & worktree** per job |
| **Error Triage** | Search across CloudWatch streams | **Automated root cause isolation** |

---

## 🏁 Quickstart

### Option 1: Download the Desktop App
Grab the latest release for macOS, Linux, or Windows from the [Releases page](https://github.com/OyadotAI/spar/releases).

### Option 2: Build from Source

#### Prerequisites
- **Java 21+** (`brew install openjdk@21`)
- **Node.js 20+** & **pnpm** (`npm i -g pnpm`)
- **Docker** (for local Glue 5 test container)
- **AWS CLI** (optional, for cloud sync and deploy)
- **Claude Code** (`npm i -g @anthropic-ai/claude-code`, for AI assistance)

```bash
# Clone the repository
git clone https://github.com/OyadotAI/spar.git
cd spar

# Run the test suite gate (JUnit + TypeScript + Vitest)
make check

# Launch the app in development mode
make dev
```

---

## 🛠️ Architecture

SparData is built with a high-performance local architecture:
- **Core Engine (Daemon)**: Java 21 / Spring Boot running on loopback (`127.0.0.1`). Drives the `claude` CLI, executes containerized tests via Docker, manages Git worktrees, and communicates with AWS Glue & CloudWatch over AWS SDK v2.
- **Renderer (UI)**: Electron desktop app built with React 19, TypeScript, Vite, CodeMirror 6, React Flow, and Lucide icons.
- **Communication**: Virtual-thread Server-Sent Events (SSE) and WebSockets.

---

## 🤝 Community & Contributing

Contributions, bug reports, and feature requests are welcome!

- 🌐 **Website**: [https://spardata.dev](https://spardata.dev)
- 🐙 **GitHub Repository**: [https://github.com/OyadotAI/spar](https://github.com/OyadotAI/spar)
- 🐛 **Issues**: [Report a bug](https://github.com/OyadotAI/spar/issues)

---

## 📄 License

SparData is open-source software licensed under the [MIT License](LICENSE).
