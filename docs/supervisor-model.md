# Modelo supervisor de Idu-pi

Idu-pi funciona como un cerebelo de proyecto: no reemplaza al humano ni al orquestador, pero ayuda a mantener postura, equilibrio y reflejos operativos.

Su trabajo es supervisar calidad, tiempo, costo/tokens, seguridad, reportes, recursos y aprendizaje.

## Analogía de obra

| Obra | Idu-pi |
| --- | --- |
| Dueño / gerente | Humano |
| Jefe de obra | Orquestador |
| Supervisor técnico | Idu-pi |
| Especialistas / laboratorio | AgentLabs |
| Cuadrillas | Subagentes |
| Plano maestro | Project Core |
| Normas técnicas | Constitution |
| Rutas funcionales | Flows |
| Presupuesto | Tokens / tiempo / recursos |

El humano decide. El orquestador ejecuta. Idu-pi supervisa. AgentLabs inspeccionan.

## Qué supervisa

| Pilar | Pregunta que hace Idu-pi |
| --- | --- |
| Calidad | ¿Hay evidencia, tests y revisión suficiente? |
| Tiempo | ¿Estamos evitando loops, retrabajo y tareas mal priorizadas? |
| Costo/tokens | ¿Estamos gastando contexto en ruido o repitiendo análisis? |
| Seguridad | ¿Esto toca auth, datos, secretos, permisos o acciones destructivas? |
| Reportes | ¿El resultado queda registrado y revisable? |
| Recursos | ¿Conviene usar lab, subagente o revisión fresca? |
| Aprendizaje | ¿Hay algo que convertir en regla, skill, memoria o tarea futura? |

## Activación

```text
/idu
idu-pi idu
```

Al activarse desde CLI/Pi slash, Idu-pi hace bootstrap/start, revisa o genera el Plan Maestro draft con AutoDepth y activa guardrails automáticos sobre el proyecto actual. En Telegram, `/idu` activa guardrails y muestra el estado del Plan Maestro del proyecto activo ya configurado.

```text
/idu_status
idu-pi idu-status
```

Muestra si el supervisor está activo, el proyecto asociado y la ruta de estado.

```text
/idu_off
idu-pi idu-off
```

Desactiva guardrails automáticos. Los comandos manuales siguen disponibles.

## Project Core

Project Core es el plano maestro del proyecto.

Incluye:

- objetivo del proyecto;
- alcance incluido y excluido;
- usuarios o flujo principal;
- stack esperado;
- sensibilidad de datos;
- criterios de éxito;
- restricciones humanas o técnicas.

Un draft de Project Core no es verdad por sí solo. Necesita confirmación humana.

## Plan Maestro AutoDepth

El Plan Maestro es un snapshot operativo derivado en `stateRoot`: resume objetivo inferido, alcance, riesgos, módulos, flujos, preguntas y próximos pasos. Se genera sin IA externa y no modifica el repo del usuario.

AutoDepth decide automáticamente:

- `quick`: proyecto pequeño, escaneo barato, 0-1 AgentLab como metadata.
- `standard`: proyecto mediano con DB/UI/auth o estructura suficiente, hasta 3 AgentLabs recomendados.
- `deep_required`: proyecto grande/crítico; Idu-pi completa una etapa segura automática (scan determinista, clasificación, draft preliminar y recomendaciones) y deja el deep review costoso para aprobación humana explícita.

Aprobar el Plan Maestro sólo registra decisión humana sobre ese draft. No aplica flows, no confirma Project Core/Constitution y no ejecuta AgentLabs. Cuando hay un draft pendiente, el usuario puede responder de forma natural (`ok`, `dale`, `sí`, `rehacer`) desde superficies que mantienen estado; fuera de ese pending action esas palabras no ejecutan nada crítico.

## Constitution

Constitution traduce el Project Core confirmado a normas operativas.

Ejemplos:

- login/auth requiere revisión de seguridad;
- cambios de DB/schema requieren cuidado adicional;
- no se saltean tests declarados;
- no se toca stack rechazado;
- cambios fuera de alcance se bloquean o escalan.

## Gates

Los gates son validaciones deterministas. No necesitan IA para detectar señales fuertes.

Revisan:

- texto de la solicitud;
- archivos cambiados;
- Project Core y Constitution;
- riesgo de seguridad/datos;
- estado de cola y tareas.

Si detectan riesgo alto o blocker, piden confirmación humana.

## Supervisor loop

El supervisor loop puede:

1. observar estado del proyecto;
2. revisar si hay eventos suficientes para auditoría semántica;
3. crear drafts de compactación;
4. proponer mejoras;
5. preparar tareas futuras;
6. registrar reportes revisables.

No debe:

- aplicar cambios críticos solo;
- modificar skills reales sin aprobación;
- convertir drafts en reglas sin decisión;
- ejecutar AgentLabs por sorpresa;
- borrar memoria o datos.

Nada crítico se aplica sin confirmación humana.

## Supervisor hooks

Los hooks permiten que Idu-pi reaccione ante eventos puntuales:

- activación de `/idu`;
- postflight con riesgo alto;
- umbrales semánticos;
- tareas relevantes.

Los hooks preparan revisión o propuestas. No reemplazan la decisión humana.

## Semantic audit y compaction

Semantic Audit cuenta señales acumuladas:

- lab runs;
- findings;
- proposals;
- tasks;
- user signals;
- memory items;
- findings críticos/high.

Semantic Compaction convierte ruido acumulado en un draft revisable.

Ese draft puede alimentar:

- propuestas de mejora del supervisor;
- propuestas de skills;
- tareas semánticas;
- candidatos de memoria.

La compactación no borra memoria ni aplica reglas automáticamente.

## AgentLabs

AgentLabs son especialistas que revisan en sandbox/clone.

Pueden inspeccionar:

- seguridad;
- base de datos;
- arquitectura;
- calidad de código;
- UI/UX;
- performance;
- skills;
- costo/tokens;
- entendimiento de proyecto.

Contrato:

```text
AgentLab revisa.
Idu-pi consolida.
Humano/orquestador decide.
Nada se aplica automáticamente.
```

Los reportes AgentLab pueden convertirse en:

- hallazgos consolidados;
- recomendaciones;
- tests sugeridos;
- candidates de mejoras;
- candidates de memoria;
- candidates de tareas futuras.

Pero no crean cambios reales por sí solos.

## Relación con el orquestador

El orquestador es quien ejecuta trabajo real: lee archivos, edita, corre tests, coordina subagentes y aplica decisiones aprobadas.

Idu-pi le da señales:

- riesgo;
- contexto faltante;
- sugerencia de revisión;
- necesidad de confirmación;
- propuestas o tasks candidatas;
- memoria/reportes relevantes.

El orquestador no debería tratar a Idu-pi como una orden ciega. Idu-pi supervisa; no gobierna solo.

## Relación con subagentes

Los subagentes son cuadrillas especializadas. Pueden explorar, implementar o revisar tareas concretas.

Idu-pi ayuda a decidir cuándo conviene usarlos:

- mucho contexto;
- revisión fresca;
- investigación aislada;
- AgentLab sandbox;
- tareas futuras desde compactación.

## Qué se automatiza

Se puede automatizar:

- clasificación de intención;
- detección de riesgo;
- cola estructurada;
- auditoría semántica;
- creación de drafts;
- creación de propuestas revisables;
- consolidación de reportes;
- estado y formatos.

## Qué NO se automatiza

No se automatiza sin confirmación humana:

- commit/push;
- merge/rebase/destructivos;
- aplicación de Project Core como verdad;
- cambios de Constitution;
- modificación de skills reales;
- activación de reglas sensibles;
- cambios críticos de auth/DB/seguridad;
- copia de cambios desde labs al repo real;
- publicación o release.

Nada crítico se aplica sin confirmación humana.
