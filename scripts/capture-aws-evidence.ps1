<#
  capture-aws-evidence.ps1

  Captures documented proof that the coding agent (Claude Code) is connected to AWS,
  which is a hard qualification requirement for the Zero to Shipped hackathon:
  "A coding agent connected to the AWS console, with documented proof of the connection."

  Every command here is READ-ONLY. Nothing is created, modified, or deleted.
  Secrets are never written: `aws configure list` masks all but the last 4 characters
  of the access key, and the secret key is masked by the CLI itself.

  Run:  powershell -ExecutionPolicy Bypass -File scripts/capture-aws-evidence.ps1
#>

$ErrorActionPreference = "Continue"

$root     = Split-Path -Parent $PSScriptRoot
$evidence = Join-Path $root "hackathon-evidence"
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

Write-Host ""
Write-Host "  Capturing AWS connection evidence (read-only)" -ForegroundColor Cyan
Write-Host "  Agent   : Claude Code (Anthropic)"
Write-Host "  Time    : $stamp"
Write-Host "  Output  : $evidence"
Write-Host ""

function Save-Evidence {
    param(
        [string]$Label,
        [string]$File,
        [string]$Command
    )

    Write-Host ("  -> {0}" -f $Label) -NoNewline
    $path = Join-Path $evidence $File

    # 2>&1 keeps AWS error payloads (e.g. NotSignedUp) — a documented failure is
    # still evidence of a live, authenticated call reaching AWS.
    $output = & cmd /c "$Command 2>&1"
    $code   = $LASTEXITCODE

    $output | Out-File -FilePath $path -Encoding utf8

    if ($code -eq 0) {
        Write-Host "  OK" -ForegroundColor Green
    } else {
        Write-Host ("  exit {0} (captured)" -f $code) -ForegroundColor Yellow
    }

    return [pscustomobject]@{
        label    = $Label
        file     = $File
        command  = $Command
        exitCode = $code
    }
}

$results = @()

$results += Save-Evidence -Label "AWS CLI version" `
    -File "03-aws-cli-version.txt" -Command "aws --version"

$results += Save-Evidence -Label "Caller identity (STS)" `
    -File "01-sts-get-caller-identity.json" -Command "aws sts get-caller-identity --output json"

$results += Save-Evidence -Label "Credential config (masked)" `
    -File "02-aws-configure-list.txt" -Command "aws configure list"

$results += Save-Evidence -Label "Account information" `
    -File "04-account-information.json" -Command "aws account get-account-information --output json"

$results += Save-Evidence -Label "Bedrock foundation models" `
    -File "05-bedrock-list-foundation-models.json" `
    -Command "aws bedrock list-foundation-models --region us-east-1 --by-provider anthropic --output json"

$results += Save-Evidence -Label "Bedrock inference profiles" `
    -File "07-bedrock-inference-profiles.json" `
    -Command "aws bedrock list-inference-profiles --region us-east-1 --output json"

$results += Save-Evidence -Label "Enabled regions" `
    -File "08-enabled-regions.json" `
    -Command "aws account list-regions --region-opt-status-contains ENABLED ENABLED_BY_DEFAULT --output json"

$manifest = [pscustomobject]@{
    capturedAt   = $stamp
    agent        = "Claude Code (Anthropic), model claude-opus-5"
    hackathon    = "Zero to Shipped - AWS Builder Center"
    project      = "Founder Arena"
    workstation  = $env:COMPUTERNAME
    cliOnPath    = (Get-Command aws -ErrorAction SilentlyContinue).Source
    commands     = $results
}

$manifest | ConvertTo-Json -Depth 5 |
    Out-File -FilePath (Join-Path $evidence "00-manifest.json") -Encoding utf8

Write-Host ""
Write-Host "  Manifest written: hackathon-evidence/00-manifest.json" -ForegroundColor Cyan
Write-Host "  Review CONNECTION.md and confirm the account ID matches your Builder Center profile."
Write-Host ""
