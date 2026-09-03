# keel-v2 — working agreement

Keel v2 is an ADE for **AWS Glue Studio**: a Java daemon (`daemon/`, Spring Boot, loopback only)
drives the user's own `claude` CLI and talks to AWS; an Electron app (`app/`, React + TypeScript)
is the view. macOS, Windows and Linux. The plan that produced this repo is the source of design
intent: `~/.claude/plans/i-want-to-create-synthetic-ritchie.md` (copy into `docs/` when it settles).

Three screens are the product: the **jobs page** (every Glue job, live run state), a job's
**Console** (runs + CloudWatch tail, debugging agent on the right) and its **Authoring** tab
(visual DAG editor + agent, generated `job.py`, per-node pytest). Everything else serves those.

## The bar (inherited from v1, still product requirements)
- **Never slow.** Lists are virtualised, logs are capped (5,000 lines), nothing unbounded reaches
  the renderer. Blocking work (AWS, git, docker, claude) runs on virtual threads in the daemon.
- **Never stuck.** Every wait has a timeout (HTTP 90s; the chat stream is the one exception and it
  has a 60s-silence dead-stream rule). Every state can be left.
- **Never weird.** An empty pane says which reason it is: no profile, SSO expired, no jobs,
  throttled, daemon reconnecting. Never a blank.
- **Near real time.** Changes made outside Keel (console, API, an editor, a terminal `claude`)
  show up on their own: `Sync` polls Glue (inventory 5s, tiered runs), `LiveEvents` pushes via
  EventBridge→SQS when enabled, `Watcher` watches `jobs/**`. Nothing in the renderer polls.

## Rules that are one function, not a convention
- `Proc.run/stream` — never a bare `ProcessBuilder`. Both pipes drained, a timeout, git env
  (`GIT_TERMINAL_PROMPT=0`).
- `Events.emit` — the only way a fact reaches the app. `/api/events` kinds are listed in `Events`.
- `Hook.settingsJson` — the approval hook is a `curl … || true` line. It fails open; keep it so.
- Stop sends SIGINT on POSIX, never SIGTERM (Claude Code exits 143 and abandons the turn).
- `PUT /api/jobs/{name}/dag` carries `rev`; a stale rev is a 409, never a silent overwrite.
- `job.py` is generated from `dag.json`. Hand edits are lost by design; custom logic goes in
  `SparkSQL` / `CustomCode` nodes.
- **Navigation is two levels.** The window tab strip, then one `shell/Sidebar` per lane. Inside a
  pane, switching is a `shell/Seg` and nothing else — `app/test/dx.test.tsx` fails the build if a
  third idiom comes back. The toolbar holds actions only, never navigation.
- Every write to a live AWS account is confirmed through `shell/Confirm`. Deploy confirms inside
  `useAuthoring.deploy`, so the button, `⇧⌘D` and the palette are all covered by one guard.
- `shell/useSurfaceReason` is the "name the reason" ladder. Any AWS-backed pane calls it before it
  renders a fault, so no-profile never reads as `400 Bad Request`.
- Colours, spacing and type come from `theme.css`. `app/test/theme.test.ts` asserts every
  text/background pair at >= 4.5:1 in both themes; `dx.test.tsx` rejects an undefined `var(--x)`,
  an inline `fontSize:`, text under 11px, and an icon-only button with no `aria-label`.
- Deploy pushes the DAG (console stays visual) **and** the tested `job.py` to `ScriptLocation`.
  A console Save regenerates the script; the deploy response says so every time.

## Layout
```
daemon/  ai.oya.keel{,.aws,.local,.codegen,.testing,.git,.agent,.term}   JUnit 5 in src/test
app/     src/main (Electron main: daemon spawn, menu)  src/preload  src/renderer (React)  test/ (vitest)
Makefile check | daemon | dev | dist
```
`make check` is the gate: `mvn test` + `pnpm typecheck` + `pnpm test`. Every non-trivial piece
leaves one test behind; fixtures are captured from real streams (a real `claude -p` run, real
daemon responses), never written from memory.

## Verified so far (2026-09-02, on macOS)
- Daemon: 25 JUnit tests (`mvn test`); codegen golden (`fixtures/dag-simple.json` → `job-simple.py`);
  the generated job.py + 8 scaffolded tests pass inside `public.ecr.aws/glue/aws-glue-libs:5` (~16s).
- Agent: a real `claude -p` turn whose Bash call blocked on the curl hook, was answered through
  `/api/approve/answer`, ran, replied, and ended with a checkpoint commit and cost.
- App: 92 vitest tests; `KEEL_SHOT=<png>[:ms]` photographs the window, `KEEL_PROJECT=<dir>`,
  `KEEL_OPEN=<job>:<tab>` and `KEEL_SIZE=<w>x<h>` point a dev launch at a project, a lane and a
  window size (the screenshot rig).
- Not yet exercised: anything that needs an AWS profile (this machine has none), Windows/Linux
  runs, `electron-builder` installers, the EventBridge push, Deploy against a real account.

## Glue Studio parity
`docs/glue-studio-inventory.md` is the screen-by-screen comparison with the console and the list of
what is deliberately absent. Two rules learned from a live account, both now enforced in code:
- **Deploy must win the race with Glue's regeneration.** A job with `CodeGenConfigurationNodes`
  gets its `ScriptLocation` rewritten by Glue after `UpdateJob`, later than five seconds. `Deployer`
  settles, writes, verifies, and reports `scriptIsOurs`; `scriptMode` (both / visual / tested) is
  the honest choice between a visual console and tested code.
- **An empty Logs, Metrics or Insights pane is a role finding.** `RoleCheck` names the missing
  permission, shows the policy, and attaches it on one explicit click.

## Deferred on purpose
MCP tools for AWS beyond `ask_user` (the agent uses the `aws` CLI under the hook); rewind;
multi-writer lane claims; SDK-model marshalling instead of `aws glue … --cli-input-json`; cycle
detection in the canvas; a Windows SIGINT equivalent; Windows/Linux code signing; Sentry/PostHog.
