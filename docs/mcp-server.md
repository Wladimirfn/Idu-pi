# Idu-pi MCP Server

MCP en Idu-pi es un adapter para que el orquestador consulte al supervisor desde cualquier proyecto abierto.

Regla central: MCP no reemplaza a Idu-pi. MCP expone Idu-pi al orquestador.

## Core vs adapters

```text
Idu-pi Core
├─ CLI adapter
├─ Telegram adapter
├─ MCP adapter
├─ Supervisor loop
├─ Project Core / Constitution / Gates
├─ Semantic memory
├─ AgentLabs
└─ reports / DB
```

- **Idu-pi Core**: núcleo supervisor, guardrails, gates, memoria semántica, reports y AgentLabs.
- **CLI**: adapter para terminal local.
- **Telegram**: adapter para celular/chat.
- **MCP Server**: adapter stdio para que el orquestador use Idu-pi como herramientas.

Ningún adapter debe duplicar lógica del core.

## Cómo correr

Recomendado: primero configurar el adapter MCP en Pi:

```bash
corepack pnpm cli -- setup mcp-init
# o
idu-pi setup mcp-init
```

Para imprimir la configuración sin escribir:

```bash
idu-pi setup mcp-print
```

Desde el repo Idu-pi:

```bash
corepack pnpm mcp
```

Como bin compilado:

```bash
idu-pi-mcp
```

También se puede ejecutar directo después de compilar:

```bash
corepack pnpm build
node dist/src/mcp-server.js
```

El servidor usa stdio JSON-RPC/MCP. No levanta Telegram y no importa el entrypoint de Telegram.

## Configuración conceptual del orquestador

Ejemplo conceptual:

```json
{
  "mcpServers": {
    "idu-pi": {
      "command": "idu-pi-mcp",
      "args": [],
      "env": {
        "DEFAULT_CWD": "C:\\Users\\elmas\\Sistema_de_mantencion",
        "ALLOWED_ROOTS": "C:\\Users\\elmas",
        "AGENT_WORKSPACE_ROOT": "C:\\Users\\elmas\\Documents\\bridge-agents"
      }
    }
  }
}
```

`TELEGRAM_BOT_TOKEN` y `ALLOWED_USER_ID` no son necesarios para el MCP adapter.

## Resolución de proyecto

Antes de usar un proyecto externo, enrolalo para aislar estado:

```bash
idu-pi project enroll "C:\\Users\\elmas\\OneDrive\\Escritorio\\Mis proyectos\\Sistema_de_mantencion"
```

Cada herramienta acepta `projectPath` opcional.

1. Si `projectPath` viene, Idu-pi valida la ruta contra `ALLOWED_ROOTS` e intenta asociarla con el registry.
2. Si la ruta no está registrada, devuelve `unregistered_project` con diagnóstico claro. No escribe el registry automáticamente.
3. Si `projectPath` no viene, usa el proyecto activo del registry.
4. Si no hay proyecto activo, usa `process.cwd()` sólo como candidato y recomienda registrar el proyecto.

## Herramientas disponibles

Todas devuelven JSON estructurado con:

```json
{
  "ok": true,
  "tool": "idu_status",
  "projectId": "sistema_de_mantencion",
  "projectPath": "C:\\...",
  "summary": "...",
  "data": {},
  "safeNotes": [],
  "errors": []
}
```

Herramientas mínimas:

| Tool | Propósito |
| --- | --- |
| `idu_status` | Estado de conexión, sesión, config/alignment y próximo paso. |
| `idu_activate` | Activa guardrails automáticos sin scan pesado ni AgentLabs. |
| `idu_deactivate` | Apaga guardrails automáticos. |
| `idu_prepare` | Ejecuta prepare seguro. |
| `idu_preflight` | Evalúa riesgo/impacto de una solicitud humana. |
| `idu_advisory` | Devuelve advisory seguro desde preflight. |
| `idu_postflight` | Lee cambios/gates y sugiere AgentLabs sin aplicar cambios. |
| `idu_supervisor_tick` | Tick supervisor seguro con flags explícitos. |
| `idu_task` | Interpreta intención humana y registra tarea estructurada. |
| `idu_queue_detail` | Devuelve cola estructurada con ids completos y guardStatus. |
| `idu_semantic_audit_status` | Lee stats/checkpoint/decisión de auditoría semántica. |
| `idu_agentlab_request_create` | Crea solicitud formal AgentLab; no ejecuta labs. |
| `idu_agentlab_review_run` | Ejecuta revisión AgentLab explícita con sandbox/clone guard. |
| `idu_agentlab_review_status` | Lee estado de review AgentLab. |

## Seguridad

El MCP adapter:

- no levanta Telegram;
- no depende de Telegram;
- no hace commit ni push;
- no aplica cambios críticos automáticamente;
- no modifica Project Core confirmado ni Constitution;
- no modifica skills reales;
- no borra memoria;
- no devuelve secretos de errores/logs sin redacción básica;
- no ejecuta AgentLabs salvo la herramienta explícita `idu_agentlab_review_run`.

Telegram es un adapter, no el núcleo. El núcleo sigue siendo Idu-pi Core.
