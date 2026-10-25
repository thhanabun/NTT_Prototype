param(
  [string]$OutputsPath = 'data/cloud-outputs.json',
  [ValidateSet('SHELF-01', 'SHELF-02', 'SHELF-03')]
  [string]$ShelfId = 'SHELF-01'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$awsCliDirectory = Join-Path $taskRoot 'data/cloud-tools/aws-cli/Amazon/AWSCLIV2'
if (Test-Path -LiteralPath $awsCliDirectory) { $env:PATH = "$awsCliDirectory;$env:PATH" }
$outputs = Get-Content -LiteralPath $OutputsPath -Raw | ConvertFrom-Json
if ($outputs.IoTEnabled -eq $false -or -not $outputs.DevicePolicyName -or -not $outputs.IoTDataEndpoint) { throw 'IoT is disabled in this stack. Enable it in a later deployment before provisioning devices.' }
$thingName = switch ($ShelfId) {
  'SHELF-01' { $outputs.ThingName }
  'SHELF-02' { $outputs.Shelf02ThingName }
  'SHELF-03' { $outputs.Shelf03ThingName }
}
if (-not $thingName) { throw "CloudFormation does not have an IoT Thing for $ShelfId; deploy the multi-shelf stack first." }
$env:AWS_REGION = $outputs.Region
if ($outputs.Profile) { $env:AWS_PROFILE = $outputs.Profile }
$deviceDirectory = Join-Path $taskRoot 'data/aws-device'
if ($ShelfId -ne 'SHELF-01') { $deviceDirectory = Join-Path $deviceDirectory $ShelfId }
New-Item -ItemType Directory -Path $deviceDirectory -Force | Out-Null
$metadata = Join-Path $deviceDirectory 'certificate-arn.txt'
if (Test-Path -LiteralPath $metadata) {
  $certificateArn = (Get-Content -LiteralPath $metadata -Raw).Trim()
  if (-not (Test-Path -LiteralPath (Join-Path $deviceDirectory 'device-private.key')) -or -not (Test-Path -LiteralPath (Join-Path $deviceDirectory 'device.crt'))) { throw 'Existing certificate has no local certificate/private key pair; do not replace it automatically' }
} else {
  $certificateArn = & aws iot create-keys-and-certificate --set-as-active --certificate-pem-outfile (Join-Path $deviceDirectory 'device.crt') --private-key-outfile (Join-Path $deviceDirectory 'device-private.key') --public-key-outfile (Join-Path $deviceDirectory 'device-public.key') --query certificateArn --output text
  if ($LASTEXITCODE -ne 0) { throw 'Certificate creation failed' }
  $certificateArn | Set-Content -LiteralPath $metadata
}
& aws iot attach-policy --policy-name $outputs.DevicePolicyName --target $certificateArn
if ($LASTEXITCODE -ne 0) { throw 'Policy attachment failed' }
& aws iot attach-thing-principal --thing-name $thingName --principal $certificateArn
if ($LASTEXITCODE -ne 0) { throw 'Thing attachment failed' }
$rootCaPath = Join-Path $deviceDirectory 'AmazonRootCA1.pem'
Invoke-WebRequest -Uri 'https://www.amazontrust.com/repository/AmazonRootCA1.pem' -OutFile $rootCaPath
$credentialsPath = Join-Path $deviceDirectory 'aws-credentials.h'
$credentials = @"
#pragma once
constexpr char AWS_DEVICE_ENDPOINT[] = "$($outputs.IoTDataEndpoint)";
constexpr char AWS_DEVICE_ROOT_CA[] = R"FASTPEM(
$(Get-Content -LiteralPath $rootCaPath -Raw)
)FASTPEM";
constexpr char AWS_DEVICE_CERTIFICATE[] = R"FASTPEM(
$(Get-Content -LiteralPath (Join-Path $deviceDirectory 'device.crt') -Raw)
)FASTPEM";
constexpr char AWS_DEVICE_PRIVATE_KEY[] = R"FASTPEM(
$(Get-Content -LiteralPath (Join-Path $deviceDirectory 'device-private.key') -Raw)
)FASTPEM";
"@
[System.IO.File]::WriteAllText($credentialsPath, $credentials, [System.Text.UTF8Encoding]::new($false))
$firmwareSketch = switch ($ShelfId) {
  'SHELF-01' { 'firmware/esp32/aws_shelf' }
  'SHELF-02' { 'firmware/esp32/aws_shelf_02' }
  'SHELF-03' { 'firmware/esp32/aws_shelf_03' }
}
Write-Host "Provisioned $ShelfId as IoT Thing $thingName. Private key and firmware header are under ignored data/aws-device; flash $firmwareSketch next. Existing firmware was not flashed."
