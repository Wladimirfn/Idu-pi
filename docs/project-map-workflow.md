# Project map workflow

Esta guía explica cómo Idu-pi describe el proyecto real con `project-blueprint` y `project-flows`, cómo revisa ese mapa y cómo aplica cambios sólo con aprobación humana.

Para el modelo conceptual del supervisor, leé [`supervisor-model.md`](supervisor-model.md). Para arquitectura técnica, leé [`architecture.md`](architecture.md).

## Objetivo

El project map evita que el orquestador trabaje sobre supuestos vagos. Define qué existe, qué flujo importa y qué debe preservarse.

```text
Project Core → Constitution → Project blueprint / flows → Gates → Revisión humana
```

## Camino rápido

```text
/config init_project_config
/config inspect_project_map
/config scan_project_map
/config suggest_project_flows
/config draft_project_flows
/config review_project_flows_draft <ruta>
/config apply_project_flows_draft <ruta>
```

Flujo recomendado:

```text
scan → suggest → draft → review → apply con backup
```

## Project blueprint

`config/project-blueprint.json` describe el contrato maestro del proyecto activo.

| Área | Qué documenta |
| --- | --- |
| Objetivo | Qué problema resuelve el proyecto real. |
| Reglas maestras | Restricciones de seguridad, acciones prohibidas y criterios de aceptación. |
| Jerarquía | Humano decide; orquestador coordina; AgentLabs auditan; subagentes ejecutan tareas acotadas. |

`project-blueprint` no es una lista de comandos internos de Idu-pi. Es contexto del proyecto real que se está supervisando.

## Project flows

`config/project-flows.json` es el mapa funcional del proyecto real.

| Sección | Qué representa |
| --- | --- |
| `modules` | Áreas funcionales del producto real. |
| `screens` | Pantallas, páginas o superficies. |
| `uiElements` | Botones, formularios, enlaces, acciones o controles relevantes. |
| `dataStores` | APIs, tablas, archivos, storage o fuentes de datos. |
| `flows` | Recorridos funcionales: disparador, pasos, resultado y targets de prueba. |
| `moduleConnections` | Dependencias funcionales entre módulos y datos compartidos. |

El mapa sirve para comparar intención funcional contra código real. No describe colas internas, SQLite interno ni arquitectura del bridge salvo que el proyecto activo sea Idu-pi como producto auditado.

## Ciclo seguro

| Paso | Comando | Escritura | Propósito |
| --- | --- | --- | --- |
| 1 | `/config init_project_config` | Crea sólo configs faltantes | Inicializa blueprint/flows desde defaults sin sobreescribir. |
| 2 | `/config inspect_project_map` | No escribe | Valida/inspecciona JSON funcional cargado. |
| 3 | `/config scan_project_map` | No escribe | Escanea archivos estáticos y compara contra flows. |
| 4 | `/config suggest_project_flows` | No escribe | Devuelve sugerencias parciales desde scan. |
| 5 | `/config draft_project_flows` | Sólo `reports/` | Guarda draft revisable separado de `config/project-flows.json`. |
| 6 | `/config review_project_flows_draft <ruta>` | No escribe | Revisa draft contra mapa actual. |
| 7 | `/config apply_project_flows_draft <ruta>` | `config/project-flows.json` + backup | Aplica con ruta explícita, merge aditivo y validación final. |

## Borradores IA opcionales

```text
/config ai_draft_project_blueprint
/config ai_draft_project_flows
/config review_ai_blueprint_draft latest
/config review_ai_flows_draft latest
```

Estos comandos pueden pedir propuestas a Pi, pero sólo guardan drafts en `AGENT_WORKSPACE_ROOT/reports/` con warning. No aplican cambios.

Los reviews IA son sólo lectura: validan warning, JSON/schema, diferencias, sugerencias, conflictos y duplicados.

## Reglas de seguridad

- `suggest_project_flows` no escribe archivos.
- `draft_project_flows` escribe sólo bajo `AGENT_WORKSPACE_ROOT/reports/`.
- `review_project_flows_draft` no escribe archivos.
- `apply_project_flows_draft` requiere ruta explícita.
- `apply_project_flows_draft` rechaza `latest`.
- `apply_project_flows_draft` crea backup antes de escribir.
- `apply_project_flows_draft` fusiona sólo elementos aditivos.
- `apply_project_flows_draft` no borra datos existentes.
- `apply_project_flows_draft` no sobrescribe IDs existentes.
- Ningún comando de scan/draft/review ejecuta código del proyecto.
- Nada crítico se aplica sin confirmación humana.

## Qué ve el AgentLab

Cuando hay config válida, un AgentLab puede recibir contexto resumido:

- Project Core o blueprint;
- flows funcionales;
- resumen de scan estático;
- reglas/constraints relevantes;
- formato esperado de reporte;
- archivos o flows a inspeccionar.

AgentLab revisa y reporta evidencia. No decide ni aplica cambios.

## Relación con otros docs

- [`README.md`](../README.md) — visión humana general.
- [`supervisor-model.md`](supervisor-model.md) — roles, gates, loops y decisiones.
- [`architecture.md`](architecture.md) — módulos técnicos y persistencia.
- [`cli-commands.md`](cli-commands.md) — comandos CLI.
- [`telegram-commands.md`](telegram-commands.md) — comandos Telegram.
