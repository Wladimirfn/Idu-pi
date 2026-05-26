# Instalador y estado por proyecto

`idu-pi setup` configura adapters globales y prepara estado aislado por proyecto. No es el núcleo: Idu-pi Core sigue siendo el supervisor; CLI, Telegram y MCP son adapters.

## Global config vs Project state

```text
Global Idu-pi config
├─ MCP config del agente Pi
├─ binarios CLI (`idu-pi`, `idu-pi-mcp`)
├─ Telegram adapter config
├─ modelos/perfiles del supervisor
└─ defaults de entorno

Project-local Idu-pi state
├─ projectId / projectPath
├─ reports
├─ lab.db
├─ tasks.jsonl
├─ idu-session-state.json
├─ semantic-audit/
├─ supervisor-learning-rules.json
└─ AgentLab reports
```

El estado mutable de proyectos enrolados vive bajo:

```text
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/
```

Ejemplo:

```text
AGENT_WORKSPACE_ROOT/
  projects/
    pi-telegram-bridge/
      reports/
      lab.db
      tasks.jsonl
      idu-session-state.json

    sistema-de-mantencion/
      reports/
      lab.db
      tasks.jsonl
      idu-session-state.json
```

Esto evita mezclar DB, reports, cola, sesión o memoria semántica entre proyectos.

## Setup status

```bash
corepack pnpm cli -- setup status
# o
idu-pi setup status
```

Muestra:

- sistema operativo y shell;
- herramientas disponibles (`node`, `npm`, `pnpm`, `git`, `curl`);
- configs detectadas de Pi/Claude Code/OpenCode/Codex/Cursor/Windsurf;
- si MCP `idu-pi` parece configurado;
- acciones recomendadas.

`idu-pi setup` sin subcomando equivale a `setup status`.

## Montar MCP

Recomendado:

```bash
corepack pnpm cli -- setup mcp-init
```

Esto escribe en:

```text
PI_CODING_AGENT_DIR/mcp.json
# o
~/.pi/agent/mcp.json
```

Agrega o preserva:

```json
{
  "mcpServers": {
    "idu-pi": {
      "command": "node",
      "args": ["C:\\...\\dist\\src\\mcp-server.js"],
      "lifecycle": "lazy"
    }
  }
}
```

Reglas:

- preserva otros `mcpServers`;
- no reemplaza `mcpServers["idu-pi"]` si ya existe, salvo `--force`;
- crea backup `mcp.backup-YYYYMMDD-HHMMSS.json` antes de modificar un config existente;
- `setup mcp-print` imprime config sin escribir;
- `setup mcp-init --dry-run` calcula sin escribir.

Comandos:

```bash
idu-pi setup mcp-print
idu-pi setup mcp-init
idu-pi setup mcp-init --force
idu-pi setup mcp-init --dry-run
```

## Enrolar un proyecto

```bash
idu-pi project enroll "C:\\Users\\elmas\\OneDrive\\Escritorio\\Mis proyectos\\Sistema_de_mantencion"
```

Opcionalmente podés pasar `projectId`:

```bash
idu-pi project enroll "C:\\...\\Sistema_de_mantencion" sistema-de-mantencion
```

El enrolamiento:

- valida que la ruta exista y esté dentro de `ALLOWED_ROOTS`;
- registra el proyecto en el registry existente;
- crea `AGENT_WORKSPACE_ROOT/projects/<projectId>/`;
- no crea Project Core automáticamente;
- no modifica Constitution ni flows;
- no corre scan pesado;
- no toca código del proyecto externo.

## Ver estado de proyecto

```bash
idu-pi project status "C:\\...\\Sistema_de_mantencion"
idu-pi project state-path "C:\\...\\Sistema_de_mantencion"
```

`project status` muestra:

- `projectId`;
- `projectPath`;
- `registered/unregistered`;
- `stateRoot`;
- `labDbPath`;
- `reportsDir`;
- disponibilidad MCP;
- siguiente paso recomendado.

## Seguridad

El instalador no ejecuta Telegram, AgentLabs, IA externa, scans pesados, commits ni pushes. Sólo configura adapters globales y prepara estado de proyecto.

Telegram es un adapter, no el núcleo. MCP también es un adapter. El núcleo es Idu-pi Core.
