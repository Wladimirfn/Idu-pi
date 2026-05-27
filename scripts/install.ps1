param(
    [switch]$Yes,
    [switch]$DryRun,
    [switch]$NoMcp,
    [switch]$NoShim,
    [switch]$OpenWizard,
    [switch]$AddPath,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Node no está disponible. Instalá Node.js LTS desde https://nodejs.org/ y volvé a ejecutar este instalador."
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installMjs = Join-Path $scriptDir "install.mjs"

$nodeArgs = @($installMjs)
if ($Yes) { $nodeArgs += "--yes" }
if ($DryRun) { $nodeArgs += "--dry-run" }
if ($NoMcp) { $nodeArgs += "--no-mcp" }
if ($NoShim) { $nodeArgs += "--no-shim" }
if ($OpenWizard) { $nodeArgs += "--open-wizard" }
if ($AddPath) { $nodeArgs += "--add-path" }
if ($Help) { $nodeArgs += "--help" }

& node @nodeArgs
exit $LASTEXITCODE
