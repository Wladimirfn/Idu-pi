# Guided Configuration and Project Assets Design

## Goal

Add a Telegram-guided configuration surface for Idu-pi so an external user can verify and initialize the bridge step by step, with project-local skills and MCP assets as first-class configuration.

Initial implementation scope: **Phase 1 + Phase 2 only**.

- Phase 1: read-only `/config` and `/config doctor` diagnostics.
- Phase 2: `/config init_assets` to initialize missing project-local asset folders/files with safe defaults.

Later phases are documented for compatibility but are out of implementation scope for this first change.

## Principles

1. The real project repo is the source of truth.
2. Lab agents work in clone workspaces, never as the default/direct profile.
3. Skills and MCP configuration should be project-local and versionable.
4. Agent-created assets are proposals until the orchestrator/user explicitly reviews and pulls them.
5. The bridge must never copy secrets, commit, push, or execute new MCP configuration automatically.

## Project-local asset layout

Each managed project may contain:

```text
.agents/
  skills/
    <skill-name>/
      SKILL.md

.atl/
  skill-registry.md

.mcp/
  config.json
```

`/config init_assets` creates only missing minimal files/directories:

- `.agents/skills/.gitkeep`
- `.atl/skill-registry.md`
- `.mcp/config.json`

The MCP config starts disabled/empty. It is a declaration point, not an execution trigger.

## Telegram command surface

### `/config`

Shows a concise checklist:

- Bridge identity and local runtime
- Active project and Git readiness
- Allowed roots safety
- Agent profile count and active profile
- Workspace mode/root
- Project-local skills status
- Project-local skill registry status
- Project-local MCP status
- Recommended next command

### `/config doctor`

Shows a more detailed diagnostic version of `/config`, including concrete paths and warnings.

### `/config init_assets`

Creates the missing project-local asset structure in the active project. It must:

- write only inside the active project path;
- create only the approved asset paths;
- preserve existing files;
- report exactly what was created and what already existed;
- never write secrets;
- never run MCP servers;
- never commit.

## Future command surface

Out of scope for the first implementation, but reserved:

```text
/config skills
/config mcp
/config sync_to_agents
/config review_from_agent
/config pull_from_agent
```

### Future repo → agent sync

`/config sync_to_agents` should sync clone workspaces and report branch/commit parity between real repo and agent clones.

### Future agent → repo review

`/config review_from_agent` should inspect clone diffs and only surface allowed asset paths:

- `.agents/skills/**`
- `.atl/skill-registry.md`
- `.mcp/**`

### Future agent → repo pull

`/config pull_from_agent <agent>` should require an explicit confirmation after showing the diff. It must never pull code changes or secrets.

## Safety rules

Blocked always:

- `.env`, `.env.*`
- files outside `.agents/`, `.atl/`, `.mcp/`
- `.git/**`
- `node_modules/**`
- generated build output
- commit/push
- automatic MCP execution

## Diagnostics expected from Phase 1

The read-only config report should distinguish:

- missing asset structure;
- bridge config errors;
- project path not inside allowed roots;
- current project is not a Git repo;
- workspace mode not set to `clone`;
- no non-default lab profiles configured;
- `PI_EXTRA_ARGS` disabling skill registry/lens while project assets exist.

The report should avoid exposing secrets.

## Testing strategy

Add unit tests for pure helpers before wiring Telegram commands.

Required tests for Phase 1:

1. Reports missing project-local assets.
2. Reports existing `.agents/skills`, `.atl/skill-registry.md`, `.mcp/config.json`.
3. Marks Git repo readiness from injected status data or temp repo.
4. Recommends `/config init_assets` when assets are missing.

Required tests for Phase 2:

1. Creates missing asset structure.
2. Does not overwrite existing registry or MCP config.
3. Rejects or avoids writes outside the active project.
4. Reports created vs existing paths.

Telegram command tests should verify command routing text at a high level; detailed formatting belongs in helper tests.

## Implementation notes

Prefer a new module, for example `src/config-wizard.ts`, with pure functions:

- `inspectProjectConfig(options)`
- `formatConfigOverview(report)`
- `formatConfigDoctor(report)`
- `initProjectAssets(projectPath)`

Then wire `src/index.ts` minimally:

- add `/config` to help text;
- route `/config`, `/config doctor`, `/config init_assets`;
- call helper functions with current project/config/router state.

## Non-goals for this first change

- No clone-to-repo pull.
- No MCP server execution.
- No automatic skill registry generation from global skills.
- No commit/push automation.
- No broad refactor of `src/index.ts` beyond command registration.
