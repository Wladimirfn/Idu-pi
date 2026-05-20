# Guided Config Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/config`, `/config doctor`, and `/config init_assets` so users can inspect and initialize project-local skills/MCP assets from Telegram.

**Architecture:** Put filesystem inspection/initialization in a focused `src/config-wizard.ts` module. Wire Telegram commands minimally in `src/index.ts`. Cover behavior with `node:test` unit tests before implementation.

**Tech Stack:** TypeScript ESM, Node built-ins (`fs`, `path`, `child_process`), grammy command handlers, `node --test` via `corepack pnpm test`.

---

## File Structure

- Create `src/config-wizard.ts` — pure-ish helper module for project asset inspection, formatting, and initialization.
- Create `test/config-wizard.test.ts` — unit tests for inspection and init behavior.
- Modify `src/index.ts` — add `/config` command and help entry.
- Modify `README.md` — document guided config commands.

## Task 1: Config wizard helper tests

**Files:**

- Create: `test/config-wizard.test.ts`
- Later implementation: `src/config-wizard.ts`

- [ ] **Step 1: Write failing tests**

Create `test/config-wizard.test.ts`:

```ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  formatConfigDoctor,
  formatConfigOverview,
  initProjectAssets,
  inspectProjectConfig,
} from "../src/config-wizard.js";

const tempRoots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-telegram-config-"));
  tempRoots.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(
    tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

test("inspectProjectConfig reports missing project-local assets", () => {
  const projectPath = tempDir();
  const report = inspectProjectConfig({
    projectId: "demo",
    projectPath,
    allowedRoots: [projectPath],
    agentProfiles: [
      { id: "default", label: "Pi default", provider: "pi", piArgs: [] },
    ],
    activeProfileId: "default",
    workspaceMode: "direct",
    workspaceRoot: join(projectPath, ".workspaces"),
    piArgs: ["--no-skill-registry", "--no-lens"],
    isGitRepo: false,
  });

  assert.equal(report.assets.skills.exists, false);
  assert.equal(report.assets.registry.exists, false);
  assert.equal(report.assets.mcp.exists, false);
  assert.equal(report.recommendedNext, "/config init_assets");
  assert.ok(
    report.warnings.some((warning) => warning.includes("No hay perfiles lab")),
  );
});

test("inspectProjectConfig reports existing project-local assets", () => {
  const projectPath = tempDir();
  initProjectAssets(projectPath);

  const report = inspectProjectConfig({
    projectId: "demo",
    projectPath,
    allowedRoots: [projectPath],
    agentProfiles: [
      { id: "default", label: "Pi default", provider: "pi", piArgs: [] },
      { id: "codex", label: "Codex", provider: "pi", piArgs: [] },
    ],
    activeProfileId: "codex",
    workspaceMode: "clone",
    workspaceRoot: join(projectPath, ".workspaces"),
    piArgs: [],
    isGitRepo: true,
  });

  assert.equal(report.assets.skills.exists, true);
  assert.equal(report.assets.registry.exists, true);
  assert.equal(report.assets.mcp.exists, true);
  assert.equal(report.recommendedNext, "/config doctor");
});

test("initProjectAssets creates missing assets without overwriting existing files", () => {
  const projectPath = tempDir();
  const existingRegistry = join(projectPath, ".atl", "skill-registry.md");
  initProjectAssets(projectPath);
  writeFileSync(existingRegistry, "# custom registry\n", "utf8");

  const result = initProjectAssets(projectPath);

  assert.equal(readFileSync(existingRegistry, "utf8"), "# custom registry\n");
  assert.ok(result.existing.includes(".atl/skill-registry.md"));
  assert.equal(
    existsSync(join(projectPath, ".agents", "skills", ".gitkeep")),
    true,
  );
  assert.equal(existsSync(join(projectPath, ".mcp", "config.json")), true);
});

test("formatConfigOverview and formatConfigDoctor hide secrets and show next steps", () => {
  const projectPath = tempDir();
  const report = inspectProjectConfig({
    projectId: "demo",
    projectPath,
    allowedRoots: [projectPath],
    agentProfiles: [
      { id: "default", label: "Pi default", provider: "pi", piArgs: [] },
    ],
    activeProfileId: "default",
    workspaceMode: "direct",
    workspaceRoot: join(projectPath, ".workspaces"),
    piArgs: ["--no-skill-registry"],
    isGitRepo: false,
  });

  assert.match(
    formatConfigOverview(report),
    /Siguiente recomendado:\n\/config init_assets/,
  );
  assert.match(formatConfigDoctor(report), /Project-local assets/);
  assert.doesNotMatch(
    formatConfigDoctor(report),
    /TELEGRAM_BOT_TOKEN|replace_me|token/,
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
corepack pnpm test test/config-wizard.test.ts
```

Expected: TypeScript compile fails because `src/config-wizard.ts` does not exist.

## Task 2: Implement config wizard helper

**Files:**

- Create: `src/config-wizard.ts`
- Test: `test/config-wizard.test.ts`

- [ ] **Step 1: Create minimal implementation**

Create `src/config-wizard.ts` with exported types/functions named in the tests. Use Node built-ins only. Defaults:

- skills dir: `.agents/skills`
- registry: `.atl/skill-registry.md`
- MCP config: `.mcp/config.json`

`initProjectAssets()` writes:

```md
# Project Skill Registry

Project-local skills available to Idu-pi agents.

| Skill | Trigger / description | Path |
| ----- | --------------------- | ---- |
```

and:

```json
{
  "enabled": false,
  "servers": {}
}
```

- [ ] **Step 2: Run helper tests and verify GREEN**

Run:

```bash
corepack pnpm test test/config-wizard.test.ts
```

Expected: all `config-wizard` tests pass.

## Task 3: Wire Telegram `/config`

**Files:**

- Modify: `src/index.ts`
- Test: existing full suite

- [ ] **Step 1: Import helpers**

Add imports from `./config-wizard.js`:

```ts
import {
  formatConfigDoctor,
  formatConfigOverview,
  formatInitAssetsResult,
  initProjectAssets,
  inspectProjectConfig,
} from "./config-wizard.js";
```

- [ ] **Step 2: Add local report builder**

Near other helper functions in `src/index.ts`, add a helper that passes current state:

```ts
function currentConfigReport() {
  return inspectProjectConfig({
    projectId: currentProjectId(),
    projectPath: currentCwd,
    allowedRoots: config.allowedRoots,
    agentProfiles: agentRouter.profiles,
    activeProfileId: agentRouter.activeProfile().id,
    workspaceMode: config.agentWorkspaceMode,
    workspaceRoot: config.agentWorkspaceRoot,
    piArgs: config.piArgs,
  });
}
```

- [ ] **Step 3: Add `/config` help line**

Add to help text:

```text
/config [doctor|init_assets] - configuración guiada del bridge/proyecto
```

- [ ] **Step 4: Add command handler**

Register before `/doctor` or near it:

```ts
bot.command("config", async (ctx) => {
  if (!(await guard(ctx))) return;
  const arg = commandArg(ctx.message?.text ?? "").toLowerCase();
  if (!arg) {
    await replyLong(ctx, formatConfigOverview(currentConfigReport()));
    return;
  }
  if (arg === "doctor") {
    await replyLong(ctx, formatConfigDoctor(currentConfigReport()));
    return;
  }
  if (arg === "init_assets") {
    await replyLong(ctx, formatInitAssetsResult(initProjectAssets(currentCwd)));
    return;
  }
  await ctx.reply("Uso: /config | /config doctor | /config init_assets");
});
```

- [ ] **Step 5: Run full tests**

Run:

```bash
corepack pnpm test
```

Expected: full suite passes.

## Task 4: Document guided config

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add command to usage list**

Add near `/doctor`:

```text
/config
```

- [ ] **Step 2: Add short section**

Add after “Comandos principales” intro or before “Laboratorios de tests”:

````md
### Configuración guiada

`/config` muestra un checklist del bridge y del proyecto activo. Sirve para validar proyecto, agentes, workspaces y assets versionables.

```text
/config
/config doctor
/config init_assets
```
````

`/config init_assets` crea estructura project-local mínima para skills y MCP:

```text
.agents/skills/.gitkeep
.atl/skill-registry.md
.mcp/config.json
```

No ejecuta MCP, no copia secretos, no commitea y no pushea.

````

- [ ] **Step 3: Run tests again**

Run:

```bash
corepack pnpm test
````

Expected: full suite passes.

## Self-review

Spec coverage:

- Phase 1 `/config` and `/config doctor`: Task 3.
- Phase 2 `/config init_assets`: Tasks 1-3.
- Project-local layout: Tasks 1-2 and README Task 4.
- Safety: encoded by restricted creation behavior and documented non-execution/no commit.
- Future sync commands: intentionally reserved in design spec, not implemented in this plan.

No placeholders are required for this phase. Clone-to-repo sync, MCP execution, and automatic registry generation stay out of scope.
