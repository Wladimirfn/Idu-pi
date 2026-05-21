# Code Context

## Files Retrieved

1. `package.json` (lines 1-24) - project metadata, scripts, dependency surface.
2. `src/agent-router.ts` (lines 1-367) - agent session/runtime routing, workspace clone isolation, profile selection.
3. `src/lab.ts` (lines 1-170) - lab duration parsing and execution of test labs against clone-profile agents.
4. `src/lab-db.ts` (lines 1-249) - SQLite schema and finding persistence helpers.
5. `src/task-queue.ts` (lines 1-37) - in-memory FIFO task queue.
6. `src/task-templates.ts` (lines 1-62) - `/task` command parsing and generated worker prompts.
7. `src/config-wizard.ts` (lines 1-433) - config doctor/init assets/workspace/skills sync helpers.
8. `src/index.ts` (selected grep around lines 17-40, 101-102, 345-351, 634-807) - integration entry points for router, lab, config, task templates, queue.
9. `src/lab-reports.ts` (lines 1-154) - JSONL lab report store used by lab execution.
10. `src/config.ts` (lines 1-156) - env-driven config, profile parsing, allowed-root/workspace mode rules.

## Key Code

- `package.json`: ESM TypeScript app (`type: module`), scripts are `build`, `test`, `dev`, `serve`; dependencies are only `dotenv` and `grammy`, dev deps TypeScript/Node types.
- `src/config.ts`: `loadConfig()` requires `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_ID`, `DEFAULT_CWD`; defaults `AGENT_WORKSPACE_MODE` to `clone`, `AGENT_WORKSPACE_ROOT` to `~/Documents/bridge-agents`, and `PI_EXTRA_ARGS` to `--no-skill-registry --no-lens`.
- `src/agent-router.ts`: `AgentRouter` keeps active project/profile, caches `AgentRuntime`s by `projectId\0cwd\0profileId`, uses direct workspace for default profile and clone workspace for lab profiles when clone mode is enabled. `ensureCloneWorkspace()` clones target repo, disables push/commit via hooks, resets to target branch/HEAD, then `git clean -fd`.
- `src/lab.ts`: `LAB_DURATIONS` defines quick/3tests/5tests/full budgets. `runTestLab()` skips non-clone runtimes or busy sessions, otherwise races `runtime.session.prompt(labPrompt(...))` against timeout, appends a `LabRunRecord`, and cancels on timeout.
- `src/lab-reports.ts`: report persistence is JSONL at `<workspaceRoot>/reports/lab-runs.jsonl`; append/update/list are file-based and not SQLite.
- `src/lab-db.ts`: separate SQLite schema exists for `lab_runs`, `bug_findings`, `finding_status_events`, `proposals`, `lab_tasks`, `skill_index`, `finding_skills`; current exported helpers initialize DB, record bug findings, and list open findings.
- `src/task-queue.ts`: volatile process-local FIFO only; no IDs, persistence, status, project binding, or concurrency metadata.
- `src/task-templates.ts`: `/task <kind> <details>` supports `bug|feature|refactor|docs`; generated prompts include no commit/push guard and TDD/debugging guidance.
- `src/config-wizard.ts`: `/config` helpers inspect/init `.agents/skills`, `.atl/skill-registry.md`, `.mcp/config.json`, workspace `reports/` and `workspaces/`, and sync hard-coded necessary skills.
- `src/index.ts`: central Telegram command file wires everything. Relevant integration points: imports at lines 17-40; creates `LabReportStore` and `TaskQueue` around lines 101-102; runs labs around lines 345-351; builds config report around lines 634-647; `/task` command uses templates around lines 684-695; `/config` subcommands call wizard/DB helpers around lines 760-807.

## Architecture

Idu-pi is a Telegram bridge around Pi RPC sessions. Configuration is env-driven (`src/config.ts`), then `src/index.ts` wires Telegram commands to a single `AgentRouter`. The router owns profile selection and workspace isolation: profile 1/default is direct, later profiles can be clone-isolated labs. Lab execution (`src/lab.ts`) prompts clone-profile agents with strict lab instructions and persists results to a JSONL store (`src/lab-reports.ts`). A newer SQLite lab/finding/task schema exists (`src/lab-db.ts`) but is only lightly integrated via `/config db_init` and finding helpers; lab runs still primarily write JSONL. Task handling is currently split between an in-memory queue (`src/task-queue.ts`) and prompt templates (`src/task-templates.ts`), both orchestrated from the large `src/index.ts` command handler.

## Current State

- Repo is a small TypeScript ESM app with compiled `dist/`, tests under `test/`, runtime data/logs/docs/scripts present.
- Command/orchestration logic is concentrated in `src/index.ts` (1431 lines), making future feature changes likely to touch a large file.
- Workspace isolation is intentionally conservative for lab profiles: clone workspaces, disabled push remote, pre-push/pre-commit hooks.
- Config wizard can create project-local assets and workspace dirs; this is behavior-changing if invoked, but pure inspection is safe.
- Two persistence models coexist: JSONL lab reports and SQLite lab DB. SQLite has broader schema but incomplete operational use.

## Risks

1. `ensureCloneWorkspace()` uses `git reset --hard` and `git clean -fd` inside clone workspace; safe only if workspace truly isolated and `workspaceRoot` is correct.
2. SQLite helper uses shelling out to `sqlite3`; runtime depends on `sqlite3` being installed and on manual SQL string escaping.
3. `recordBugFinding()` inserts a status event every upsert, which may duplicate events when updating same finding.
4. `listOpenFindings()` orders by text severity, not severity priority; critical/high ordering may be wrong.
5. `TaskQueue` is process-memory only; bridge restart loses queued tasks.
6. `src/index.ts` is a high-coupling hotspot; small changes can accidentally affect Telegram flow, lab flow, or config commands.
7. `LabReportStore.update()` rewrites the whole JSONL file; concurrent updates could lose writes.
8. `config-wizard.ts` uses `mkdirSync(join(path, ".."))`; works but is less clear than `dirname(path)`.
9. Default `PI_EXTRA_ARGS` disables skill registry/lens while config wizard recommends project-local skills, creating possible user confusion.
10. Lab timeout cancels the session but does not guarantee child process cleanup beyond `runtime.session.cancel()` behavior.

## Files Likely to Touch

- `src/index.ts` - add/wire Telegram commands, route new flows, reduce orchestration coupling.
- `src/lab.ts` - lab execution behavior, timeout/budget semantics, record creation.
- `src/lab-reports.ts` - if retaining JSONL report flow, improve locking/update/report listing.
- `src/lab-db.ts` - if moving findings/tasks/lab runs into SQLite, add typed accessors and migrations.
- `src/task-queue.ts` - if tasks need IDs, persistence, per-project queues, or status transitions.
- `src/task-templates.ts` - if adding task kinds, acceptance criteria capture, SDD prompts, or stricter worker contracts.
- `src/config-wizard.ts` - config doctor/init/sync UX and asset validation.
- `src/config.ts` - env flags for new storage, workspace, or safety modes.
- Tests likely under `test/*.test.ts` matching the modules above.

## New Files Recommended

- `src/lab-service.ts` - service layer coordinating lab runs, report storage, DB writes, and triage state outside `index.ts`.
- `src/task-service.ts` - persistent task orchestration API over queue/templates/DB.
- `src/lab-db-repository.ts` or `src/repositories/lab-db.ts` - isolate SQLite CRUD and severity/status mapping from schema init.
- `src/telegram-commands/*.ts` - split large `index.ts` command handlers by domain (`config`, `lab`, `tasks`, `projects`).
- `src/safety.ts` - central guard utilities for no commit/push, workspace kind checks, allowed cwd checks.
- `test/lab-db.test.ts`, `test/task-queue.test.ts`, `test/task-templates.test.ts`, `test/config-wizard.test.ts` - focused regression coverage before refactors.

## Safe Phased Implementation Order

1. Baseline: run existing `corepack pnpm test`/`build` before edits and capture current behavior.
2. Add focused tests around existing pure modules first: `task-queue`, `task-templates`, `config-wizard` formatting/inspection, `lab-db` SQL helper behavior if `sqlite3` is available.
3. Extract command handlers from `src/index.ts` without behavior changes; keep public command text and replies identical.
4. Introduce a service/repository boundary for lab reports and lab DB, initially still writing JSONL as today.
5. Decide persistence direction: keep JSONL for lab runs, or migrate lab runs/tasks/findings into SQLite with explicit migration/backfill plan.
6. Add durable task IDs/status/project binding before making queue-driven workflows more capable.
7. Harden workspace safety checks around clone reset/clean and lab timeout cleanup.
8. Only after tests and services are stable, add new user-facing commands or behavior.

## Start Here

Open `src/index.ts` first. It is the integration hub that shows which helpers are actually used versus merely available. Then inspect `src/lab.ts` and `src/lab-db.ts` together to resolve the JSONL-vs-SQLite persistence split before implementing new lab/task behavior.
