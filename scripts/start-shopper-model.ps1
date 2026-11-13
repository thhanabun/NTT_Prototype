param(
  [switch]$Install,
  [switch]$Cpu,
  [switch]$DownloadOnly,
  [ValidateRange(1024, 65535)][int]$Port = 8080,
  [ValidateRange(2048, 16384)][int]$ContextSize = 4096
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot "infra/shopper-agent/model.json") -Raw | ConvertFrom-Json
$cache = Join-Path $projectRoot "data/shopper-model"
$variant = if ($Cpu) { "cpu" } else { "cuda" }
$runtime = Join-Path $cache ("llama-" + $manifest.runner.tag + "-" + $variant)
$weights = Join-Path $cache $manifest.file
$server = Join-Path $runtime "llama-server.exe"
$keyFile = Join-Path $cache "local-api-key.txt"

function Download-VerifiedFile([string]$Url, [string]$Destination, [string]$Sha256) {
  if (Test-Path -LiteralPath $Destination) {
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) { throw "Existing artifact hash mismatch; refusing to replace $Destination" }
    Write-Host "Verified cached artifact: $(Split-Path $Destination -Leaf)"
    return
  }
  Write-Host "Downloading pinned artifact: $(Split-Path $Destination -Leaf)"
  $partial = $Destination + ".part"
  & curl.exe --fail --location --retry 2 --continue-at - --silent --show-error --output $partial $Url
  if ($LASTEXITCODE -ne 0) { throw "Download failed; rerun -Install to resume: $Url" }
  if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) { throw "Downloaded artifact hash mismatch: $partial" }
  Move-Item -LiteralPath $partial -Destination $Destination
}

if ($Install) {
  New-Item -ItemType Directory -Path $cache -Force | Out-Null
  $artifact = if ($Cpu) { $manifest.runner.cpu } else { $manifest.runner.cuda }
  $archives = @($artifact)
  if (-not $Cpu) { $archives += $manifest.runner.cudaRuntime }
  foreach ($archive in $archives) {
    $destination = Join-Path $cache $archive.file
    Download-VerifiedFile ("https://github.com/" + $manifest.runner.repository + "/releases/download/" + $manifest.runner.tag + "/" + $archive.file) $destination $archive.sha256
  }
  Download-VerifiedFile ("https://huggingface.co/" + $manifest.repository + "/resolve/" + $manifest.revision + "/" + $manifest.file) $weights $manifest.sha256
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  foreach ($archive in $archives) {
    Write-Host "Extracting verified runtime: $($archive.file)"
    & tar.exe -xf (Join-Path $cache $archive.file) -C $runtime
    if ($LASTEXITCODE -ne 0) { throw "Runtime extraction failed" }
  }
}
if ($DownloadOnly) { exit 0 }
if (-not (Test-Path -LiteralPath $server) -or -not (Test-Path -LiteralPath $weights)) { throw "Local Shopper model not installed. Run this script with -Install first (about 3.2 GB of downloads for CUDA)." }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port is occupied. Existing services were not stopped." }
$layers = if ($Cpu) { "0" } else { "99" }
if (-not (Test-Path -LiteralPath $keyFile)) {
  $keyBytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($keyBytes) } finally { $generator.Dispose() }
  [IO.File]::WriteAllText($keyFile, [Convert]::ToBase64String($keyBytes), (New-Object Text.UTF8Encoding($false)))
}
Write-Host "Model: $($manifest.name) / $($manifest.quantization) via llama.cpp $($manifest.runner.tag) ($variant)"
Write-Host "OpenAI-compatible base URL: http://127.0.0.1:$Port/v1"
Write-Host "Model alias: $($manifest.alias). Local inference only; no AWS/OpenAI API calls. Ctrl+C stops this model."
& $server --model $weights --alias $manifest.alias --host 127.0.0.1 --port $Port --ctx-size $ContextSize --parallel 1 --threads 6 --n-gpu-layers $layers --batch-size 512 --ubatch-size 128 --cache-ram 0 --jinja --no-webui --api-key-file $keyFile --temp 0.1 --top-k 20 --top-p 0.8 --min-p 0
exit $LASTEXITCODE
