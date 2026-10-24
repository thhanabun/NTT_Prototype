param([Parameter(Mandatory = $true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
foreach ($toolDirectory in @('data/cloud-tools/aws-cli/Amazon/AWSCLIV2', '.venv-cloud/Scripts')) {
  $toolPath = Join-Path $taskRoot $toolDirectory
  if (Test-Path -LiteralPath $toolPath) { $env:PATH = "$toolPath;$env:PATH" }
}
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
foreach ($name in @('stackName','accountId','region','imageTag','bedrockModelId','budgetEmail')) {
  if (-not $config.$name -or $config.$name -match 'REPLACE') { throw "Configure $name before deployment" }
}
if ($config.stackName -notmatch '^[a-z][a-z0-9-]{2,29}$' -or $config.imageTag -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Invalid stack/image name' }
if (-not $config.bedrockInvokeResources -or ($config.bedrockInvokeResources -join ',') -match 'REPLACE|\*') { throw 'Supply exact Bedrock model/profile ARNs' }
foreach ($command in @('aws','sam','docker','node')) { if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Install $command first" } }
$env:AWS_REGION = $config.region
$env:SAM_CLI_TELEMETRY = '0'
$env:SAM_NPM_RUN_TEST_WITH_BUILD = 'false'
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
  if ($result.WebUrl) { $result.WebUrl = $result.WebUrl.TrimEnd('/') }
  return $result
}
Run-Checked 'node' @('scripts/prepare-cloud.mjs')
Run-Checked 'sam' @('validate','--lint','--template-file','infra/cloud/template.json')
$identity = Read-Aws @('sts','get-caller-identity')
if ($config.accountId -notmatch '^\d{12}$' -or $identity.Account -ne $config.accountId) { throw 'AWS identity does not match the configured deployment account; no resources were created.' }
$assumedRoleMatch = [regex]::Match($identity.Arn, '^arn:[^:]+:sts::\d+:assumed-role/([^/]+)/')
if ($assumedRoleMatch.Success) {
  $deployerRole = Read-Aws @('iam','get-role','--role-name',$assumedRoleMatch.Groups[1].Value)
  $executionRoleArn = "arn:aws:iam::$($identity.Account):role/$($config.stackName)-AgentRole-preflight"
  $simulation = Read-Aws @('iam','simulate-principal-policy','--policy-source-arn',$deployerRole.Role.Arn,'--action-names','iam:PassRole','--resource-arns',$executionRoleArn,'--context-entries','ContextKeyName=iam:PassedToService,ContextKeyValues=lambda.amazonaws.com,ContextKeyType=string')
  if ($simulation.EvaluationResults[0].EvalDecision -ne 'allowed') { throw 'Lambda iam:PassRole is not allowed for the deployment role. Ask the NTT administrator to approve deployment. No new deployment resources were created.' }
}
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
Run-Checked 'docker' @('buildx','build','--platform','linux/amd64','--provenance=false','-f','infra/cloud/Agent.Dockerfile','-t',$agentImage,'--push','.')
$iot = ''
if ($config.enableIoT -eq $true) { $iot = (Read-Aws @('iot','describe-endpoint','--endpoint-type','iot:Data-ATS')).endpointAddress }
$samBuildDirectory = Join-Path 'data' ("b-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$deploymentTemplate = Get-Content -LiteralPath 'infra/cloud/template.json' -Raw | ConvertFrom-Json
foreach ($function in $deploymentTemplate.Resources.PSObject.Properties.Value) {
  if ($function.Type -eq 'AWS::Serverless::Function' -and $function.Properties.PackageType -ne 'Image' -and $function.Properties.CodeUri -ne '../../data/cloud-package/') { throw 'Shared Lambda packaging requires every ZIP function to use the shared source.' }
}
# Every handler uses the same source/dependencies; build and zip that package once.
Run-Checked 'sam' @('build','ApiFunction','--template-file','infra/cloud/template.json','--build-dir',$samBuildDirectory,'--no-cached')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$lambdaZipPath = Join-Path $taskRoot (Join-Path $samBuildDirectory 'functions.zip')
[System.IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $taskRoot (Join-Path $samBuildDirectory 'ApiFunction')), $lambdaZipPath)
foreach ($function in $deploymentTemplate.Resources.PSObject.Properties.Value) {
  if ($function.Type -eq 'AWS::Serverless::Function' -and $function.Properties.PackageType -ne 'Image') { $function.Properties.CodeUri = $lambdaZipPath }
}
$deploymentTemplate.Resources.WebService.Properties.ImageUri = $webImage
$deploymentTemplate.Resources.AgentRuntime.Properties.ImageUri = $agentImage
$sharedTemplatePath = Join-Path $samBuildDirectory 'deploy.json'
[System.IO.File]::WriteAllText((Join-Path $taskRoot $sharedTemplatePath), ($deploymentTemplate | ConvertTo-Json -Depth 100), [System.Text.UTF8Encoding]::new($false))
$parameters = @("WebImageUri=$webImage", "AgentImageUri=$agentImage", "BedrockModelId=$($config.bedrockModelId)", "BedrockInvokeResources=$($config.bedrockInvokeResources -join ',')", "BudgetEmail=$($config.budgetEmail)", "MonthlyBudgetUsd=$($config.monthlyBudgetUsd)", "ShelfId=$($config.shelfId)")
if ($config.enableIoT -eq $true) { $parameters += "IoTDataEndpoint=$iot" }
$parameters += "EnableIoT=$(([bool]$config.enableIoT).ToString().ToLowerInvariant())"
$parameters += "EnableDemoSignals=$(($config.enableDemoSignals -ne $false).ToString().ToLowerInvariant())"
# Lambda provides its HTTPS Function URL on creation; then register the exact OAuth callback.
$base = @('deploy','--template-file',$sharedTemplatePath,'--stack-name',$config.stackName,'--resolve-s3','--image-repository',$images.AgentRepositoryUri,'--capabilities','CAPABILITY_IAM','--no-fail-on-empty-changeset','--no-confirm-changeset','--parameter-overrides')
Run-Checked 'sam' ($base + $parameters)
$outputs = Stack-Outputs $config.stackName
Run-Checked 'sam' ($base + $parameters + "WebOrigin=$($outputs.WebUrl)")
$outputs = Stack-Outputs $config.stackName
$outputs.IoTDataEndpoint = $iot
$outputs.Region = $config.region
$outputs.Profile = $config.profile
$outputs.AccountId = $identity.Account
$outputs.IoTEnabled = [bool]$config.enableIoT
$outputs.AgentHosting = 'lambda'
[System.IO.File]::WriteAllText((Join-Path $taskRoot 'data/cloud-outputs.json'), ($outputs | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
Write-Host "Deployment outputs saved to data/cloud-outputs.json. Web: $($outputs.WebUrl)"
Run-Checked 'aws' @('lambda','invoke','--function-name',"$($config.stackName)-RetentionFunction",'data/cloud-retention-result.json')
Write-Host 'Next: confirm SNS email, create a Cognito STAFF user, and export basket QR URLs. Demo signals require STAFF login.'
if ($config.enableIoT -eq $true) { Write-Host 'IoT is enabled; provision a device certificate when ready.' } else { Write-Host 'IoT is excluded: no Thing, device policy, rule or IoT ingestion resources were deployed.' }
