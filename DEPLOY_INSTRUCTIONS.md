# Deployment Instructions for Foundry - AWS Hackathon

## Prerequisites
1. **AWS Credentials**: You need fresh AWS credentials. Run:
   ```bash
   aws login
   ```
   Complete the browser authentication flow when prompted.

## Deploy to AWS
Once credentials are active, deploy with:

```bash
npm run deploy
```

This will:
1. Bundle the Lambda handler (esbuild)  
2. Deploy/update the CloudFormation stack
3. Push the bundled function code
4. Sync the frontend to S3
5. Invalidate the CloudFront cache
6. Verify `/api/health` and print the live URL

## Expected Output
The deploy script will output your live URL like:
```
Live URL : https://d1abc2def3ghi.cloudfront.net
```

## Hackathon Submission
1. **Live URL**: Use the CloudFront URL from deployment
2. **GitHub Repo**: https://github.com/NathnelTK/founders.git  
3. **Tags**: `#commercial-potential` and `#startups`
4. **Category**: Commercial potential
5. **Lane**: Startups

## What's Deployed
- **Frontend**: Rich 3D landing page with Three.js particle globe
- **Backend**: Express + Lambda with Bedrock Claude integration  
- **Stack**: S3+CloudFront+Lambda+DynamoDB+Cognito+Bedrock
- **Features**: Pitch analysis, assumption board, founder council, decision engine

## Features Highlights
- 🧪 **Assumption Board**: 12 risk-rated experiments across Desirability/Viability/Feasibility
- 🧠 **Founder Council**: 5 perspectives (Strategist, CFO, Validator, Builder, Skeptic) 
- 📊 **Unit Economics**: Contribution margin + CAC payback analysis
- ⚡ **Claude on Bedrock**: Evaluations via Converse API with deterministic fallback
- ⚔️ **Battle Arena**: Head-to-head concept comparison
- 🌍 **Community Board**: DynamoDB-backed pitch sharing

## Auth & Storage
- **Amazon Cognito**: Sign-in through Hosted UI
- **Local Storage**: Ideas stay in browser unless published  
- **DynamoDB**: Published community pitches
- **Graceful Degradation**: Works offline with deterministic engine

## Manual Verification
After deployment, test:
1. Landing page loads with 3D effects
2. "Enter workspace" hides landing nav, shows app nav
3. Demo samples work (5 different startups)
4. Health endpoint shows Bedrock status
5. Sign-in flow (if Cognito is configured)

The app should be fully functional and ready for hackathon judging!