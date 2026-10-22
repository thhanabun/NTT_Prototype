param(
  [string]$Python = "python",
  [int]$Port = 8001,
  [switch]$Install
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$venvPath = Join-Path $projectRoot ".venv-vision"
$venvPython = Join-Path $venvPath "Scripts/python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
  & $Python -m venv $venvPath
  if ($LASTEXITCODE -ne 0) { throw "Cannot create .venv-vision; use Python 3.12." }
  $Install = $true
}
if ($Install) {
  & $venvPython -m pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cpu
  if ($LASTEXITCODE -ne 0) { throw "CPU PyTorch installation failed." }
  & $venvPython -m pip install -r (Join-Path $projectRoot "requirements-vision.txt")
  if ($LASTEXITCODE -ne 0) { throw "YOLO installation failed." }
}
$assets = Get-Content -LiteralPath (Join-Path $projectRoot "infra/vision/assets.json") -Raw | ConvertFrom-Json
$assetRoot = Join-Path $projectRoot "data/vision"
New-Item -ItemType Directory -Force -Path $assetRoot | Out-Null
foreach ($asset in @($assets.model) + @($assets.frames.PSObject.Properties.Value)) {
  $destination = Join-Path $assetRoot $asset.file
  if (-not (Test-Path -LiteralPath $destination)) { Invoke-WebRequest -Uri $asset.url -OutFile $destination }
  if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $asset.sha256) {
    throw "Asset hash mismatch: $($asset.file). Remove the damaged file and retry."
  }
}
$env:YOLO_CONFIG_DIR = Join-Path $projectRoot "data/vision/settings"
New-Item -ItemType Directory -Force -Path (Join-Path $env:YOLO_CONFIG_DIR "Ultralytics") | Out-Null
$env:YOLO_OFFLINE = "true"
$env:YOLO_AUTOINSTALL = "false"
& $venvPython (Join-Path $PSScriptRoot "vision-service.py") --port $Port
exit $LASTEXITCODE
