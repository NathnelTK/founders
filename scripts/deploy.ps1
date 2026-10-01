<#
  deploy.ps1 — ship Founder Arena to AWS.

  Idempotent: safe to re-run. Creates the stack on first run and updates it after.

  Steps
    1. Bundle the Lambda handler to a single ESM file
    2. Deploy / update the CloudFormation stack
    3. Push the bundled function code
    4. Sync the frontend to S3
    5. Invalidate the CloudFront cache
    6. Verify /api/health and print the live URL

  Run:  npm run deploy
#>

param(
    [string]$StackName = "founder-arena",
    [string]$Region    = "us-east-1",
    [string]$ModelId   = "us.anthropic.claude-sonnet-5",
    [string]$CallbackUrl = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($n, $msg) { Write-Host "`n[$n/6] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`n  FAILED: $msg" -ForegroundColor Red; exit 1 }

# Preflight: credentials must be live, or every later step fails confusingly.
Write-Host "`n  Founder Arena deploy" -ForegroundColor Cyan
Write-Host "  Stack : $StackName"
Write-Host "  Region: $Region"

$identity = aws sts get-caller-identity --output json 2>&1
if ($LASTEXITCODE -ne 0) { Fail "No valid AWS credentials.`n$identity" }
$account = ($identity | ConvertFrom-Json).Account
Write-Host "  Account: $account"

# ── 1. Bundle ───────────────────────────────────────────────────────────────
Step 1 "Bundling Lambda handler"
New-Item -ItemType Directory -Force -Path "dist/lambda" | Out-Null
npm run bundle:lambda
if ($LASTEXITCODE -ne 0) { Fail "esbuild bundle failed." }

Push-Location "dist/lambda"
if (Test-Path "../function.zip") { Remove-Item "../function.zip" -Force }
Compress-Archive -Path "index.mjs" -DestinationPath "../function.zip" -Force
Pop-Location
Write-Host "  dist/function.zip written" -ForegroundColor Green

# ── 2. Stack ────────────────────────────────────────────────────────────────
Step 2 "Deploying CloudFormation stack"
aws cloudformation deploy `
    --template-file infra/template.yaml `
    --stack-name $StackName `
    --region $Region `
    --capabilities CAPABILITY_IAM `
    --no-fail-on-empty-changeset `
    --parameter-overrides "BedrockModelId=$ModelId"

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n  Recent stack failures:" -ForegroundColor Yellow
    aws cloudformation describe-stack-events --stack-name $StackName --region $Region `
        --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" `
        --output table
    Fail "Stack deploy failed."
}

function Get-Output($key) {
    aws cloudformation describe-stacks --stack-name $StackName --region $Region `
        --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" --output text
}

$bucket   = Get-Output "SiteBucketName"
$funcName = Get-Output "ApiFunctionName"
$distId   = Get-Output "DistributionId"
$liveUrl  = Get-Output "LiveUrl"

if (-not $bucket -or -not $funcName) { Fail "Could not read stack outputs." }

# ── 2b. Point Cognito at the deployed origin ────────────────────────────────
# The Hosted UI callback URL cannot reference the distribution inside the template
# without a circular dependency (Cognito ← CloudFront ← Lambda ← Cognito), so it is
# applied here, once the URL is actually known.
$origin = if ($CallbackUrl) { $CallbackUrl.TrimEnd("/") } else { $liveUrl.TrimEnd("/") }
if ($CallbackUrl) {
    Write-Host "`n  Cognito callback already set to $CallbackUrl" -ForegroundColor DarkGray
} elseif ($origin) {
    Step "2b" "Pointing Cognito Hosted UI at $origin"
    aws cloudformation deploy `
        --template-file infra/template.yaml `
        --stack-name $StackName `
        --region $Region `
        --capabilities CAPABILITY_IAM `
        --no-fail-on-empty-changeset `
        --parameter-overrides "BedrockModelId=$ModelId" "CallbackUrl=$origin"
    if ($LASTEXITCODE -ne 0) { Fail "Stack update for the Cognito callback URL failed." }
    Write-Host "  Cognito callback set to $origin" -ForegroundColor Green
}

# ── 3. Function code ────────────────────────────────────────────────────────
Step 3 "Updating function code"
aws lambda update-function-code `
    --function-name $funcName `
    --zip-file "fileb://dist/function.zip" `
    --region $Region --output text --query "LastModified" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Function code update failed." }

aws lambda wait function-updated --function-name $funcName --region $Region
Write-Host "  $funcName updated" -ForegroundColor Green

# ── 4. Frontend ─────────────────────────────────────────────────────────────
Step 4 "Syncing frontend to S3"
# index.html gets no-cache so a redeploy is visible immediately; assets are
# fingerprint-free here, so they also stay short-lived rather than sticky.
aws s3 sync frontend/ "s3://$bucket/" --region $Region --delete `
    --exclude "index.html" --cache-control "public,max-age=300"
aws s3 cp frontend/index.html "s3://$bucket/index.html" --region $Region `
    --cache-control "no-cache,must-revalidate" --content-type "text/html; charset=utf-8"
if ($LASTEXITCODE -ne 0) { Fail "S3 sync failed." }
Write-Host "  Frontend synced to $bucket" -ForegroundColor Green

# ── 5. Invalidate ───────────────────────────────────────────────────────────
Step 5 "Invalidating CloudFront cache"
$inv = aws cloudfront create-invalidation --distribution-id $distId --paths "/*" `
    --query "Invalidation.Id" --output text
Write-Host "  Invalidation $inv created" -ForegroundColor Green

# ── 6. Verify ───────────────────────────────────────────────────────────────
Step 6 "Verifying the live endpoint"
Write-Host "  Waiting for the distribution to serve (first deploy can take several minutes)…"

$healthUrl = "$liveUrl/api/health"
$ok = $false
foreach ($attempt in 1..10) {
    Start-Sleep -Seconds 15
    try {
        $res = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 20 -ErrorAction Stop
        Write-Host ("  health: engine={0} storage={1}" -f $res.engine, $res.storage) -ForegroundColor Green
        $ok = $true
        break
    } catch {
        Write-Host ("  attempt {0}/10 not ready yet…" -f $attempt) -ForegroundColor DarkGray
    }
}

Write-Host ""
if ($ok) {
    Write-Host "  SHIPPED" -ForegroundColor Green
} else {
    Write-Host "  Stack deployed, but /api/health did not answer yet." -ForegroundColor Yellow
    Write-Host "  CloudFront can take up to ~15 minutes on a first deploy. Re-check:" -ForegroundColor Yellow
    Write-Host "    curl $healthUrl"
}
Write-Host ""
Write-Host "  Live URL : $liveUrl" -ForegroundColor Cyan
Write-Host "  Health   : $healthUrl"
Write-Host ""
Write-Host "  Put the live URL on your Builder Center project page with tags" -ForegroundColor DarkGray
Write-Host "  #commercial-potential and #startups before the deadline." -ForegroundColor DarkGray
Write-Host ""
