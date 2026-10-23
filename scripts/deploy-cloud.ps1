param([Parameter(Mandatory = $true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
foreach ($name in @('stackName','region','imageTag','bedrockModelId','budgetEmail')) {
  if (-not $config.$name -or $config.$name -match 'REPLACE') { throw "Configure $name before deployment" }
}
if ($config.stackName -notmatch '^[a-z][a-z0-9-]{2,29}$' -or $config.imageTag -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Invalid stack/image name' }
if (-not $config.bedrockInvokeResources -or ($config.bedrockInvokeResources -join ',') -match 'REPLACE|\*') { throw 'Supply exact Bedrock model/profile ARNs' }
foreach ($command in @('aws','sam','docker','node')) { if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Install $command first" } }
$env:AWS_REGION = $config.region
if ($config.profile) { $env:AWS_PROFILE = $config.profile }
function Run-Checked([string]$program, [string[]]$arguments) {
  & $program @arguments
  if ($LASTEXITCODE -ne 0) { throw "$program failed with exit code $LASTEXITCODE" }
}
function Read-Aws([string[]]$arguments) {
  $json = & aws @arguments --output json
  if ($LASTEXITCODE -ne 0) { throw 'AWS operation failed' }
  return ($json | ConvertFrom-Json)
}
function Stack-Outputs([string]$stack) {
  $result = @{}
  foreach ($output in (Read-Aws @('cloudformation','describe-stacks','--stack-name',$stack)).Stacks[0].Outputs) { $result[$output.OutputKey] = $output.OutputValue }
  return $result
}
Run-Checked 'node' @('scripts/prepare-cloud.mjs')
Run-Checked 'sam' @('validate','--lint','--template-file','infra/cloud/template.json')
$identity = Read-Aws @('sts','get-caller-identity')
Write-Host "Deploying into account $($identity.Account), region $($config.region)"
Run-Checked 'aws' @('cloudformation','deploy','--template-file','infra/cloud/bootstrap.json','--stack-name',"$($config.stackName)-images")
$images = Stack-Outputs "$($config.stackName)-images"
$registry = $images.WebRepositoryUri.Split('/')[0]
# Pass the temporary registry token over stdin; never put it on a command line or in a file.
& aws ecr get-login-password --region $config.region | & docker login --username AWS --password-stdin $registry
if ($LASTEXITCODE -ne 0) { throw 'ECR login failed' }
$webImage = "$($images.WebRepositoryUri):$($config.imageTag)"
$agentImage = "$($images.AgentRepositoryUri):$($config.imageTag)"
Run-Checked 'docker' @('buildx','build','--platform','linux/amd64','--provenance=false','-f','infra/cloud/Web.Dockerfile','-t',$webImage,'--push','.')
Run-Checked 'docker' @('buildx','build','--platform','linux/arm64','--provenance=false','-f','infra/cloud/Agent.Dockerfile','-t',$agentImage,'--push','.')
$iot = (Read-Aws @('iot','describe-endpoint','--endpoint-type','iot:Data-ATS')).endpointAddress
Run-Checked 'sam' @('build','--template-file','infra/cloud/template.json','--build-dir','data/cloud-build','--cached')
$parameters = @("WebImageUri=$webImage", "AgentImageUri=$agentImage", "WebRepositoryArn=$($images.WebRepositoryArn)", "AgentRepositoryArn=$($images.AgentRepositoryArn)", "AgentRuntimeName=$($config.stackName.Replace('-','_'))", "IoTDataEndpoint=$iot", "BedrockModelId=$($config.bedrockModelId)", "BedrockInvokeResources=$($config.bedrockInvokeResources -join ',')", "BudgetEmail=$($config.budgetEmail)", "MonthlyBudgetUsd=$($config.monthlyBudgetUsd)", "ShelfId=$($config.shelfId)")
# App Runner provides its HTTPS hostname on creation; a second update registers that exact OAuth callback.
$base = @('deploy','--template-file','data/cloud-build/template.yaml','--stack-name',$config.stackName,'--resolve-s3','--capabilities','CAPABILITY_IAM','--no-fail-on-empty-changeset','--no-confirm-changeset','--parameter-overrides')
Run-Checked 'sam' ($base + $parameters)
$outputs = Stack-Outputs $config.stackName
Run-Checked 'sam' ($base + $parameters + "WebOrigin=$($outputs.WebUrl)")
$outputs = Stack-Outputs $config.stackName
$outputs.IoTDataEndpoint = $iot
$outputs.Region = $config.region
$outputs.Profile = $config.profile
$outputs.AccountId = $identity.Account
$outputs | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'data/cloud-outputs.json')
# AgentCore creates its log group on first start. Apply retention to groups that exist now.
$groups = Read-Aws @('logs','describe-log-groups','--log-group-name-prefix','/aws/bedrock-agentcore/runtimes/')
$runtimeId = $outputs.AgentRuntimeArn.Split('/')[-1]
foreach ($group in $groups.logGroups) { if ($group.logGroupName.Contains($runtimeId)) { Run-Checked 'aws' @('logs','put-retention-policy','--log-group-name',$group.logGroupName,'--retention-in-days','14') } }
Write-Host "Deployment outputs saved to data/cloud-outputs.json. Web: $($outputs.WebUrl)"
Run-Checked 'aws' @('lambda','invoke','--function-name',"$($config.stackName)-RetentionFunction",'data/cloud-retention-result.json')
Write-Host 'Next: confirm SNS email, create a Cognito STAFF user, provision device certificate, export basket QR URLs, then run cloud acceptance.'
