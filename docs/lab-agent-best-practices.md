# Lab Agent Best Practices

Use this guide for Codex/Spark lab agents before running tests or proposing changes.

## Quick rules

1. Work only inside your assigned clone workspace.
2. Never commit, push, or copy files back to the real repo.
3. Use `corepack pnpm test` for this project; do not rely on `pnpm` being in PATH.
4. Read project-local skills from `.agents/skills` before diagnosing relevant problems.
5. Treat `.mcp/config.json` as disabled unless a human explicitly enables MCP use.
6. Report evidence, not guesses.
7. Leave proposals for the orchestrator; do not auto-apply fixes.

## Standard verification

```bash
corepack pnpm test
git status --short
```

Expected healthy result:

```text
75 tests
75 pass
0 fail
```

`git status --short` should be empty after a read-only lab run.

## Workspace contract

| Area       | Rule                                                         |
| ---------- | ------------------------------------------------------------ |
| Real repo  | Do not modify.                                               |
| Lab clone  | Read, test, and inspect only unless explicitly asked.        |
| Git push   | Disabled and must stay disabled.                             |
| Git commit | Disabled and must stay disabled.                             |
| Reports    | Write findings through bridge report flow, not ad-hoc files. |

Current lab workspaces:

```text
<bridge-agents-root>/workspaces/pi-telegram-bridge__codex
<bridge-agents-root>/workspaces/pi-telegram-bridge__spark
```

## Report format

Every report should separate signal from noise:

```text
Resumen corto
Tests/comandos ejecutados
Hallazgos con severidad y confianza
Sugerencias para el orquestador
```

For each finding include:

- severity: critical, high, medium, low, info;
- confidence: high, medium, low, or numeric 0-1;
- impact: what can break or what decision it affects;
- evidence: command output, file path, or observed behavior;
- proposal: what the orchestrator should ask/approve next.

## Noise to avoid escalating

- `[tool:*] iniciando...` messages.
- `pnpm` missing from PATH when `corepack pnpm` works.
- `stitch` not connected unless the task depends on Stitch.
- Missing DB-specific skills unless the task involves DB/Postgres/Supabase.
- Green tests as automatic permission to push/release.

## Human-confirmation gates

Ask the orchestrator/user before:

- applying fixes to the real repo;
- copying lab changes back;
- pushing to GitHub;
- enabling or executing MCP servers;
- saving raw reports to Engram;
- marking a report as final approval for release.

## Good default conclusion

When tests are green, say:

```text
Evidence is positive for the covered test suite. No final release/push decision should be made without human confirmation and diff/security review.
```
