param(
  [ValidateRange(1024, 65535)][int]$Port = 3000,
  [string]$StorePath = ""
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot "infra/shopper-agent/model.json") -Raw | ConvertFrom-Json
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port is occupied; stop only the matching API before starting this one." }
$env:SHOPPER_AGENT_MODE = "model"
$env:SHOPPER_AGENT_BASE_URL = "http://127.0.0.1:8080/v1"
$env:SHOPPER_AGENT_MODEL = $manifest.alias
$env:SHOPPER_AGENT_JSON_MODE = "true"
$env:SHOPPER_AGENT_REQUIRE_TOOLS = "true"
$keyFile = Join-Path $projectRoot "data/shopper-model/local-api-key.txt"
if (-not (Test-Path -LiteralPath $keyFile)) { throw "Start npm run model:shopper first to initialize the local-only API key." }
$env:SHOPPER_AGENT_API_KEY = [IO.File]::ReadAllText($keyFile).Trim()
$env:STORE_BACKEND = "local"
$env:HOST = "127.0.0.1"
$env:PORT = [string]$Port
if ($StorePath) { $env:STORE_PATH = $StorePath }
Write-Host "Shopper Agent: $($manifest.name) ($($manifest.quantization)), local llama.cpp on port 8080"
Write-Host "This API uses local storage. Existing case-Agent settings are preserved."
& node src/server.mjs
exit $LASTEXITCODE
