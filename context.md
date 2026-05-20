# Code Context

## Files Retrieved
1. `src/index.ts` (lines 1-70) - bridge startup creates a single `AgentRouter` using loaded config and active project.
2. `src/index.ts` (lines 540-665) - `/status`, `/dashboard`, and `/server` command handlers; current `/server run` and `/server restart` behavior lives here.
3. `src/index.ts` (lines 1307-1324) - bridge shutdown stops all Pi RPC sessions, logs bridge PID, then starts the Telegram bot.
4. `src/agent-router.ts` (lines 1-320) - runtime/session abstraction and lifecycle methods used by `/server`.
5. `src/agent-router.ts` (lines 240-320) - exact `startActive`, `restartActive`, `stopActive`, `resetActiveSession`, `stopAll` implementation.
6. `src/pi-rpc.ts` (lines 1-240) - `PiRpcSession` process lifecycle; starts/stops the child Pi RPC process only.
7. `src/pi-rpc.ts` (lines 149-207) - exact child spawn and stop/write behavior for the Pi RPC process.
8. `src/telegram-ui.ts` (lines 1-20) - accepted `/server` subcommands and parser default.
9. `src/command-catalog.ts` (lines 25-44, 280-305) - help/catalog surfaces listing `/server` and local start scripts.
10. `scripts/start-bridge.ps1` (lines 1-76) - Windows supervisor-style startup script that kills old bridge node process, installs deps if needed, builds, and starts `dist/src/index.js`.
11. `start-pi-telegram-bridge.bat` (lines 1-10) - batch wrapper around `scripts/start-bridge.ps1`.
12. `package.json` (lines 1-15) - `serve`, `dev`, `start`, `build`, `test` scripts.
13. `README.md` (lines 60-180) - user-facing command docs for `/server` and Windows supervisor.
14. `test/agent-router.test.ts` (lines 176-191) - current test asserting lifecycle restarts the active RPC session, not the bridge.
15. `test/telegram-ui.test.ts` (lines 1-18) - parser test for `/server run|restart|off|status`.
16. `test/command-catalog.test.ts` (lines 1-30) - catalog test expecting `/server restart`, batch script, and PowerShell script references.

## Key Code

Current Telegram handler in `src/index.ts` (lines 627-665):

```ts
bot.command("server", async (ctx) => {
  if (!(await guard(ctx))) return;
  const command = parseServerCommand(ctx.message?.text ?? "");
  if (!command) {
    await ctx.reply("Uso: /server status | run | restart | off");
    return;
  }
  if (command === "status") {
    await ctx.reply(formatServerStatus());
    return;
  }
  if (command === "run") {
    const runtime = agentRouter.startActive();
    await ctx.reply(
      `Servidor Pi activo iniciado/en espera.\nAgente: ${runtime.profile.label}\nWorkspace: ${runtime.cwd}`,
    );
    return;
  }
  if (command === "restart") {
    const runtime = agentRouter.restartActive();
    pendingUiRequest = null;
    pendingUiToken = null;
    if (pendingAction === "extension-ui") pendingAction = null;
    await ctx.reply(
      `Servidor Pi reiniciado.\nAgente: ${runtime.profile.label}\nWorkspace: ${runtime.cwd}`,
    );
    return;
  }
  const stopped = agentRouter.stopActive();
  ...
});
```

`/server run` only calls `agentRouter.startActive()`. `/server restart` only calls `agentRouter.restartActive()`. Neither path spawns `cmd.exe`, `powershell.exe`, `start-pi-telegram-bridge.bat`, nor `scripts/start-bridge.ps1`.

Router lifecycle in `src/agent-router.ts` (lines 229-266):

```ts
startActive(): AgentRuntime {
  const runtime = this.activeRuntime();
  runtime.session.start();
  return runtime;
}

restartActive(): AgentRuntime {
  this.resetActiveSession();
  return this.startActive();
}

stopActive(reason = "Servidor Pi detenido desde Telegram."): boolean {
  const runtime = this.activeRuntime();
  const hadRuntime = runtime.session.running || runtime.session.busy;
  runtime.session.stop(reason);
  return hadRuntime;
}
```

`resetActiveSession()` stops/deletes the current active runtime, then creates a new `PiRpcSession` for the same project/profile. It does not restart the Telegram bridge process.

Pi RPC child spawn in `src/pi-rpc.ts` (lines 149-171):

```ts
const child = spawn(
  this.options.piBin,
  [...(this.options.piArgs ?? []), ...sessionArgs, "--mode", "rpc"],
  {
    cwd: this.options.cwd,
    shell: false,
    windowsHide: true,
    env: createChildEnv(),
  },
);
```

`PiRpcSession.stop()` (lines 123-147) clears pending state, rejects pending prompt/command, sends `SIGTERM`, then attempts `SIGKILL` after 5 seconds. This is child-Pi-process scope only.

Bridge shutdown in `src/index.ts` (lines 1307-1324):

```ts
function shutdown(): void {
  agentRouter.stopAll("Bridge detenido.");
}
...
console.log(`pi-telegram-bridge iniciado. PID=${process.pid} ...`);
bot.start();
```

The bridge itself remains the current Node process until OS signal/exit. There is no self-restart path.

Windows start script in `scripts/start-bridge.ps1` (lines 28-76):

- resolves repo root and logs to `logs/bridge.log`;
- creates `.env` via `scripts/setup-env.mjs` if missing;
- finds prior `node` processes whose command line references this repo's `dist/src/index.js`;
- force-stops those prior bridge processes;
- runs `corepack pnpm install` if `node_modules` is missing;
- runs `corepack pnpm build`;
- runs `node dist/src/index.js` in the same PowerShell process and tees output to the log.

Batch wrapper in `start-pi-telegram-bridge.bat` (lines 1-10):

```bat
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-bridge.ps1"
```

Parser in `src/telegram-ui.ts` (lines 14-20): `/server` with no arg defaults to `status`; only `run`, `restart`, `off`, `status` are accepted.

## Architecture

There are two distinct process layers currently conflated by the command wording:

1. **Telegram bridge process**: `node dist/src/index.js`, launched by `scripts/start-bridge.ps1` or `start-pi-telegram-bridge.bat`. This owns the `grammy` bot, command handlers, project registry, task queue, and one `AgentRouter` instance.
2. **Active Pi RPC child process**: spawned by `PiRpcSession.ensureStarted()` as `piBin ... --mode rpc` with the active project/profile cwd. This is what `/server run`, `/server restart`, and `/server off` control today.

Current data flow:

`Telegram /server text` -> `parseServerCommand()` -> `src/index.ts` handler -> `AgentRouter` -> `AgentSession`/`PiRpcSession` -> child Pi CLI process.

`/server restart` resets only the active `AgentRuntime`:

- stops existing `PiRpcSession` child, if any;
- deletes the runtime from the router map;
- creates a replacement runtime/session;
- starts the new Pi RPC child;
- clears pending Telegram UI state.

`/server run` starts the active `PiRpcSession` if it is not already running. It does not rebuild TypeScript, refresh the Node bridge, or create a visible console window.

`/server off` stops the active Pi RPC child and clears pending UI state. It does not stop the bridge process.

`/status` and `/dashboard` report both layers, but `rpcRunning` is derived from `runtime.session.running`, while `bridgePid` is just `process.pid`.

## Current Behavior

- `/server status`: replies with bridge PID, current project/workspace/profile, and whether active RPC child is running/busy.
- `/server run`: starts the active Pi RPC child in hidden mode (`windowsHide: true`) inside the existing bridge process; replies `Servidor Pi activo iniciado/en espera...`.
- `/server restart`: stops and replaces the active Pi RPC child; replies `Servidor Pi reiniciado...`.
- `/server off`: stops the active Pi RPC child; bridge stays alive.
- Startup scripts do support bridge-level restart semantics, but only when invoked externally: `scripts/start-bridge.ps1` kills previous bridge node processes, builds, then starts the bot.

## Likely Gap vs User Expectation

Expected: Telegram `/server run` or `/server restart` should restart/reopen the **bridge process** by opening a new `cmd`/PowerShell window running `scripts/start-bridge.ps1`.

Actual: those commands only manage the embedded active Pi RPC child. The current handler cannot replace itself or open a visible Windows terminal. No bridge-level process supervisor API exists in `src/index.ts`, `src/agent-router.ts`, or `src/pi-rpc.ts`.

Important nuance: if the bridge process is already down, Telegram commands cannot be received. A command-triggered restart can only work while the bridge is alive; true recovery from a dead bridge remains scheduled task / external supervisor territory, as README lines 175-180 already says.

## Safest Design Options

1. **Keep `/server` as RPC-only; add explicit bridge commands**
   - Add `/bridge run|restart` or `/server bridge_restart` for process-level behavior.
   - Lowest semantic risk because existing tests/docs say `/server` controls active RPC.
   - Update command catalog and README to clarify RPC vs bridge.

2. **Change `/server run|restart` to bridge-level behavior and introduce RPC-specific names**
   - Matches the stated expectation but breaks existing documented behavior and tests.
   - Would require replacement command for current RPC lifecycle, e.g. `/rpc run|restart|off`.
   - Higher user/documentation churn.

3. **Hybrid: `/server run|restart` restarts bridge, `/server rpc ...` controls RPC**
   - Adds namespace without creating a new Telegram command.
   - More parser/UX complexity; must handle backward compatibility carefully.

4. **Add a bridge supervisor function in a new module and call it from index**
   - Implementation shape on Windows: spawn `powershell.exe` or `cmd.exe` detached with `windowsHide: false`, command running `scripts/start-bridge.ps1`; reply to Telegram; then schedule current process exit shortly after the reply flushes.
   - Must avoid the new `start-bridge.ps1` killing the current node before Telegram reply is sent. Safer sequence: spawn new visible shell after a short delay, or reply first then spawn; current `start-bridge.ps1` will find and kill the old bridge process.
   - Needs OS guards for non-Windows, since requested behavior is explicitly cmd/PowerShell.

Recommended safe path: Option 1 if preserving existing RPC semantics matters; Option 4 as the underlying primitive if product decision is to make Telegram trigger bridge-level restart. Do not put this behavior in `PiRpcSession`; it is bridge process management, not Pi RPC management.

## Exact Files/Tests Likely Affected

Likely implementation files:

- `src/index.ts`: command handler changes; should call bridge restart/run helper and manage reply/exit timing.
- New likely file `src/bridge-process.ts` or similar: encapsulate Windows detached shell launch, script path resolution, platform guard, and test seam.
- `src/telegram-ui.ts`: parser changes if new subcommands/namespace are added.
- `src/command-catalog.ts`: help text and `/comandos` local command descriptions.
- `README.md`: clarify RPC child vs bridge process behavior; update `/server` section and supervisor note.
- `scripts/start-bridge.ps1`: maybe adjust process matching or add env flag if self-restart races are found; otherwise likely reusable as-is.
- `start-pi-telegram-bridge.bat`: probably unchanged; already wraps `scripts/start-bridge.ps1`.
- `package.json`: probably unchanged; `serve` already runs the PowerShell start script.

Likely tests:

- `test/agent-router.test.ts`: current `server lifecycle starts, restarts, stops...` test only validates RPC lifecycle; keep if RPC commands remain, or update if `/server restart` changes meaning.
- `test/telegram-ui.test.ts`: update accepted commands if adding `/bridge`, `/server bridge_restart`, `/server rpc ...`, etc.
- `test/command-catalog.test.ts`: update assertions for changed command catalog/help.
- New test likely needed for bridge process helper: verify it spawns `powershell.exe`/`cmd.exe` with `scripts/start-bridge.ps1`, detached/visible, correct cwd, and no shell-injection-prone interpolation.
- Potential `src/index.ts` integration test does not appear to exist; command handler is not currently isolated for direct tests.

## Constraints / Risks

- Telegram can only trigger restart while the current bridge is alive.
- `scripts/start-bridge.ps1` intentionally kills old bridge node processes matching `dist/src/index.js`; a self-restart path must account for the old process being killed by the new shell.
- Need to ensure Telegram reply is sent before current process exits or before `start-bridge.ps1` kills it.
- Detached visible terminal behavior is Windows-specific; use explicit platform checks and a clear error on other OSes.
- Avoid placing bridge restart code in `src/pi-rpc.ts`; that module is correctly scoped to child Pi RPC sessions.
- Existing README and tests define `/server` as active RPC control; changing semantics is a product decision, not just a code patch.

## Start Here

Start with `src/index.ts` around lines 627-665. That is the only place Telegram `/server run` and `/server restart` currently branch, and it exposes the semantic mismatch directly: both commands call `AgentRouter` RPC lifecycle methods instead of any bridge-level process launcher.

Note: the task requested saving important discoveries to Engram, but no Engram/memory tool is available in this subagent tool namespace, so no memory write was possible.
