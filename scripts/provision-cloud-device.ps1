param([string]$OutputsPath = 'data/cloud-outputs.json')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$outputs = Get-Content -LiteralPath $OutputsPath -Raw | ConvertFrom-Json
$env:AWS_REGION = $outputs.Region
if ($outputs.Profile) { $env:AWS_PROFILE = $outputs.Profile }
$deviceDirectory = Join-Path $taskRoot 'data/aws-device'
New-Item -ItemType Directory -Path $deviceDirectory -Force | Out-Null
$metadata = Join-Path $deviceDirectory 'certificate-arn.txt'
if (Test-Path -LiteralPath $metadata) {
  $certificateArn = (Get-Content -LiteralPath $metadata -Raw).Trim()
  if (-not (Test-Path -LiteralPath (Join-Path $deviceDirectory 'device-private.key'))) { throw 'Existing certificate has no local private key; do not replace it automatically' }
} else {
  $certificateArn = & aws iot create-keys-and-certificate --set-as-active --certificate-pem-outfile (Join-Path $deviceDirectory 'device.crt') --private-key-outfile (Join-Path $deviceDirectory 'device-private.key') --public-key-outfile (Join-Path $deviceDirectory 'device-public.key') --query certificateArn --output text
  if ($LASTEXITCODE -ne 0) { throw 'Certificate creation failed' }
  $certificateArn | Set-Content -LiteralPath $metadata
}
& aws iot attach-policy --policy-name $outputs.DevicePolicyName --target $certificateArn
if ($LASTEXITCODE -ne 0) { throw 'Policy attachment failed' }
& aws iot attach-thing-principal --thing-name $outputs.ThingName --principal $certificateArn
if ($LASTEXITCODE -ne 0) { throw 'Thing attachment failed' }
Invoke-WebRequest -Uri 'https://www.amazontrust.com/repository/AmazonRootCA1.pem' -OutFile (Join-Path $deviceDirectory 'AmazonRootCA1.pem')
Write-Host 'Certificate and key saved under ignored data/aws-device. Copy the endpoint, CA, certificate and key into local firmware/esp32/secrets.h, then compile aws_shelf/aws_shelf.ino. Existing firmware was not flashed.'
