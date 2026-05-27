# Instalación rápida segura de Idu-pi

Esta guía es para una máquina nueva donde `idu-pi` todavía no existe en `PATH`.

## Flujo recomendado

```powershell
git clone https://github.com/Wladimirfn/IDU-PI.git idu-pi
cd idu-pi
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

Después de completar el instalador, probá:

```powershell
idu-pi
```

Si Windows todavía no encuentra `idu-pi`, usá mientras tanto:

```powershell
node dist/src/cli.js
```

y agregá al `PATH` la ruta que muestra el instalador, normalmente:

```text
C:\Users\<user>\AppData\Local\idu-pi\bin
```

El instalador siempre informa: **No modifiqué PATH automáticamente.**

## Dry-run

Antes de escribir o ejecutar acciones, podés inspeccionar el plan:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -DryRun
# o
node scripts/install.mjs --dry-run
```

Dry-run muestra:

- herramientas detectadas;
- comandos que ejecutaría;
- archivos/rutas que tocaría;
- estado de MCP, Pi agent dir y shim;
- ninguna escritura.

## Flags

```text
--yes          acepta confirmaciones del instalador; no modifica PATH automáticamente
--dry-run      muestra plan sin escribir
--no-mcp       omite setup mcp-init
--no-shim      omite shim local idu-pi
--open-wizard  abre node dist/src/cli.js al final
--help         muestra ayuda
```

En PowerShell usá los equivalentes:

```powershell
-DryRun
-Yes
-NoMcp
-NoShim
-OpenWizard
-Help
```

## Qué hace

Con confirmación humana, el instalador puede:

1. ejecutar `corepack enable` sólo si `pnpm` no está disponible;
2. ejecutar `corepack pnpm install --frozen-lockfile --ignore-scripts`;
3. ejecutar `corepack pnpm build`;
4. ejecutar `node dist/src/cli.js -- setup mcp-init` para MCP y comandos slash globales de Pi;
5. crear un shim local `idu-pi.cmd` y `idu-pi.ps1`;
6. abrir el wizard con `node dist/src/cli.js` si pasás `--open-wizard`.

## Shim local

El shim vive en:

```text
C:\Users\<user>\AppData\Local\idu-pi\bin
```

Archivos:

```text
idu-pi.cmd
idu-pi.ps1
```

Ambos llaman a:

```text
node "<repo>\dist\src\cli.js"
```

Si el shim ya existe y cambiaría, primero crea backup:

```text
idu-pi.backup-YYYYMMDD-HHMMSS.cmd
idu-pi.backup-YYYYMMDD-HHMMSS.ps1
```

Si el contenido ya es igual, no crea backup.

## Garantías de seguridad

- No ejecuta bootstrap remoto opaco ni scripts de dependencias.
- Usa `pnpm-lock.yaml` con `--frozen-lockfile --ignore-scripts`; pnpm puede descargar paquetes fijados desde el registry/cache configurado.
- No usa `irm | iex`.
- No modifica `PATH` automáticamente, incluso con `--yes`.
- No lee ni muestra secretos de `.env`.
- No ejecuta Telegram.
- No ejecuta AgentLabs.
- No enrola proyectos automáticamente.
- No crea Project Core.
- No toca código de proyectos externos.
- No hace commit, push, merge ni rebase.
