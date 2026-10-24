param(
  [switch]$Install,
  [string]$Python = "python",
  [ValidateSet("all", "laya", "vision", "api", "broker", "web")]
  [string]$Service = "all"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot

# Keep the physical-demo database when present, or use the standard local store.
$env:STORE_BACKEND = "local"
if (-not $env:STORE_PATH) {
  $existingDemo = Join-Path $projectRoot "data/local-demo-new.json"
  $env:STORE_PATH = if (Test-Path -LiteralPath $existingDemo) { $existingDemo } else { Join-Path $projectRoot "data/demo-state.json" }
}
$env:AGENT_PROVIDER = "laya"
$env:AGENT_MODE = "agentic"
$env:LAYA_ENDPOINT = "http://127.0.0.1:8000/v1/systemone"
$env:LAYA_MODEL = "typed-decisions"
$env:VISION_ENDPOINT = "http://127.0.0.1:8001/infer"
$env:SINGLE_BASKET_MIN_RSSI = "-80"
$env:PORT = "3000"
$env:HOST = "127.0.0.1"
$env:MQTT_PORT = "1883"
$env:FORWARD_TO_HTTP = "true"
$env:HTTP_API_URL = "http://127.0.0.1:3000/api/events"
$env:LOCAL_API_ORIGIN = "http://127.0.0.1:3000"

if ($Service -ne "all") {
  switch ($Service) {
    "laya" { & (Join-Path $PSScriptRoot "start-laya.ps1") -Python $Python -Install:$Install }
    "vision" { & (Join-Path $PSScriptRoot "start-vision.ps1") -Python $Python -Install:$Install }
    "api" { & node src/server.mjs }
    "broker" { & node tools/mqtt-broker/broker.mjs }
    "web" { Set-Location -LiteralPath (Join-Path $projectRoot "web"); & node scripts/dev-mock.mjs }
  }
  exit $LASTEXITCODE
}

Get-Command node -ErrorAction Stop | Out-Null
$pythonCommand = (Get-Command $Python -ErrorAction Stop).Source
$services = [ordered]@{ laya = 8000; vision = 8001; api = 3000; broker = 1883; web = 3001 }
function Port-InUse([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if ($Install) {
  foreach ($portNumber in $services.Values) {
    if (Port-InUse $portNumber) { throw "Port $portNumber is occupied. Stop local services before running -Install (npm ci replaces dependencies)." }
  }
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw "Backend dependency installation failed." }
  Push-Location -LiteralPath (Join-Path $projectRoot "web")
  try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "Web dependency installation failed." }
  } finally { Pop-Location }
} elseif (-not (Test-Path -LiteralPath "node_modules") -or -not (Test-Path -LiteralPath "web/node_modules")) {
  throw "Missing Node dependencies. Run this script with -Install first."
}

$logDirectory = Join-Path $projectRoot "tmp/local-services"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$shellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$runStamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
foreach ($entry in $services.GetEnumerator()) {
  if (Port-InUse $entry.Value) {
    Write-Warning "$($entry.Key): port $($entry.Value) is occupied; skipped. The existing process and its configuration were not changed."
    continue
  }
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $PSCommandPath), "-Service", $entry.Key, "-Python", ('"{0}"' -f $pythonCommand))
  if ($Install) { $arguments += "-Install" }
  $stdoutPath = Join-Path $logDirectory "$($entry.Key)-$runStamp.stdout.log"
  $stderrPath = Join-Path $logDirectory "$($entry.Key)-$runStamp.stderr.log"
  $process = Start-Process -FilePath $shellPath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  Write-Host "$($entry.Key): launched PID $($process.Id), port $($entry.Value)"
  Write-Host "  Log: $stdoutPath"
}

Write-Host ""
Write-Host "Shopper: http://localhost:3001/shopper"
Write-Host "Admin:   http://localhost:3001/admin"
Write-Host "Store:   $env:STORE_PATH"
Write-Host "Services run in the background. Models may still be installing/loading; inspect stdout/stderr in $logDirectory."
Write-Host "For foreground output, run this script with -Service laya|vision|api|broker|web."
