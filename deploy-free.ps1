# deploy-free.ps1 — Free Tier AWS deployment for Zero to Shipped hackathon
#
# This script deploys using only AWS Free Tier services:
# - S3 Static Website (not S3+CloudFront to avoid complexity)
# - No Lambda initially (frontend-only demo)
# - Uses heuristic engine (no Bedrock costs)

param(
    [string]$BucketName = "foundry-hackathon-$(Get-Random -Maximum 9999)",
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

Write-Host "`n🚀 Foundry - AWS Free Tier Deployment" -ForegroundColor Cyan
Write-Host "Bucket: $BucketName" -ForegroundColor Gray
Write-Host "Region: $Region" -ForegroundColor Gray

# Test AWS access
Write-Host "`n[1/5] Testing AWS access..." -ForegroundColor Cyan
try {
    $identity = aws sts get-caller-identity --output json | ConvertFrom-Json
    Write-Host "  ✓ Account: $($identity.Account)" -ForegroundColor Green
} catch {
    Write-Host "  ❌ AWS credentials not working. Run: aws login" -ForegroundColor Red
    exit 1
}

# Create S3 bucket for static hosting
Write-Host "`n[2/5] Creating S3 bucket..." -ForegroundColor Cyan
try {
    aws s3api create-bucket --bucket $BucketName --region $Region 2>$null
    Write-Host "  ✓ Created bucket: $BucketName" -ForegroundColor Green
} catch {
    Write-Host "  ⚠️  Bucket might exist or region issue. Continuing..." -ForegroundColor Yellow
}

# Configure bucket for static website hosting
Write-Host "`n[3/5] Configuring static website..." -ForegroundColor Cyan
aws s3 website "s3://$BucketName" --index-document index.html --error-document index.html
aws s3api put-bucket-policy --bucket $BucketName --policy @"
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::$BucketName/*"
        }
    ]
}
"@

# Update frontend to work without backend API
Write-Host "`n[4/5] Preparing frontend..." -ForegroundColor Cyan
# Create a modified version that works without API
$indexContent = Get-Content "frontend/index.html" -Raw
$indexContent = $indexContent -replace '/api/', '#'  # Disable API calls for demo
Set-Content "frontend-demo/index.html" $indexContent -Force

Copy-Item "frontend/*" "frontend-demo/" -Recurse -Force

# Upload frontend
Write-Host "`n[5/5] Uploading to S3..." -ForegroundColor Cyan
aws s3 sync frontend-demo/ "s3://$BucketName/" --delete

$WebsiteUrl = "http://$BucketName.s3-website-$Region.amazonaws.com"
Write-Host "`n🎉 DEPLOYED!" -ForegroundColor Green
Write-Host "`n📍 Website URL: $WebsiteUrl" -ForegroundColor Cyan
Write-Host "`n📋 For hackathon submission:" -ForegroundColor Yellow
Write-Host "   Live URL: $WebsiteUrl"
Write-Host "   GitHub: https://github.com/NathnelTK/founders.git"
Write-Host "   Tags: #commercial-potential #startups"
Write-Host ""
Write-Host "⚠️  Note: Demo mode (no backend). Complete the AWS account setup to deploy full version." -ForegroundColor Yellow