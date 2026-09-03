# Contributing to SparData

Thank you for your interest in contributing to **SparData**! We are committed to building the fastest, most reliable local-first ADE for AWS Glue and PySpark pipelines.

---

## 🛠️ Development Setup

### Prerequisites
- **JDK 21+** (`brew install openjdk@21`)
- **Node.js 20+** & **pnpm** (`npm i -g pnpm`)
- **Docker** (for running local Glue 5 pytest containers)
- **Maven 3.9+** (`brew install maven`)
- **Git**

### Building and Running
```bash
# Clone the repository
git clone https://github.com/OyadotAI/spar.git
cd spar

# Run the test gate (JUnit + TypeScript + Vitest)
make check

# Run the app against a freshly built daemon in development mode
make dev
```

---

## 🏗️ Architecture Overview

SparData is split into two layers:

1. **`daemon/` (Backend Engine)**:
   - Java 21 / Spring Boot running on loopback (`127.0.0.1`).
   - Drives the user's `claude` CLI, communicates with AWS via AWS SDK v2, manages git worktrees per job in `.spar/worktrees/<job>`, and runs containerized pytest in `public.ecr.aws/glue/aws-glue-libs:5`.
   - Tests: JUnit 5 (`mvn test`).

2. **`app/` (Frontend UI)**:
   - Electron application with React 19, TypeScript, Vite, CodeMirror 6, React Flow, and Lucide icons.
   - Tests: Vitest + `@testing-library/react` (`pnpm test`).

---

## 📜 Development Guidelines

- **Quality Gate**: `make check` is the strict gate. All PRs must pass `mvn test` + `pnpm typecheck` + `pnpm test`.
- **Never Slow**: Lists are virtualized, CloudWatch logs are capped, and blocking operations run on virtual threads in the daemon.
- **Never Stuck**: All asynchronous waits have reasonable timeouts and can be dismissed.
- **Design System Invariants**: All text/background pairs meet WCAG AA contrast (>= 4.5:1), and UI navigation follows the two-level rule (Window Tabs → Sidebar, with `Seg` controls within panes).

---

## 💡 Areas to Contribute

- 🧩 **New Glue Node Types**: Add CodeGen generators and pytest scaffolds in `daemon/.../codegen/` and visual editors in `app/.../dag/`.
- ⚡ **Local PySpark Engine**: Optimize local execution, simulated bookmarks, and sample dataset mocking.
- 🎨 **Visual Canvas**: Canvas enhancements, custom edge routing, and node lineage visualization.
- 📖 **Documentation**: Tutorials, Glue recipe templates, and troubleshooting guides.

---

## 🤝 Code of Conduct

Please review and adhere to our [Code of Conduct](CODE_OF_CONDUCT.md) in all community interactions.
