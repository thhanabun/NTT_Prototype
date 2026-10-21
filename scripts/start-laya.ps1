param(
  [string]$Python = "python",
  [int]$Port = 8000,
  [switch]$Install
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$model = Get-Content -LiteralPath (Join-Path $projectRoot "infra/laya/model.json") -Raw | ConvertFrom-Json
$venvPath = Join-Path $projectRoot ".venv-laya"
$venvPython = Join-Path $venvPath "Scripts/python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
  & $Python -m venv $venvPath
  if ($LASTEXITCODE -ne 0) { throw "Cannot create .venv-laya; use a Python version supported by PyTorch (3.12 recommended)." }
  $Install = $true
}
if ($Install) {
  & $venvPython -m pip install "torch==$($model.torchVersion)" --index-url https://download.pytorch.org/whl/cpu
  if ($LASTEXITCODE -ne 0) { throw "CPU PyTorch installation failed." }
  & $venvPython -m pip install -r (Join-Path $projectRoot "requirements-laya.txt")
  if ($LASTEXITCODE -ne 0) { throw "Laya installation failed." }
}
$env:HF_HOME = Join-Path $projectRoot "data/model-cache"
$env:HF_HUB_DISABLE_TELEMETRY = "1"
$env:USE_TF = "0"
$env:LAYA_HOST = "127.0.0.1"
$env:LAYA_PORT = [string]$Port
$env:LAYA_DEVICE = "cpu"
$env:LAYA_PRELOAD = "1"
$env:LAYA_MODELS = "typed-decisions"
$env:LAYA_DEFAULT_MODEL = "typed-decisions"
$env:LAYA_THREADS = "4"
$env:LAYA_REVISION = $model.revision
$env:LAYA_SHA256_DIGESTS = @{ "model.safetensors" = $model.weightsSha256 } | ConvertTo-Json -Compress
& $venvPython -m laya.serve
exit $LASTEXITCODE
