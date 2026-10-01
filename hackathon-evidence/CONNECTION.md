# Coding agent connected to AWS — documented proof

**Hackathon:** Zero to Shipped (AWS Builder Center)
**Project:** Founder Arena
**Tags:** `#commercial-potential` `#startups`
**Coding agent:** **Claude Code** (Anthropic) — model `claude-opus-5`
**Captured:** `2026-09-30T11:54:42Z` · workstation `DESKTOP-35432AP`

This file is the qualification artifact for the requirement:

> *"A coding agent connected to the AWS console, with documented proof of the connection."*

The agent used **live AWS credentials from this workstation** to call AWS APIs directly via
AWS CLI v2. **All seven commands returned exit code 0.** No secrets are stored here —
`aws configure list` masks all but the last four characters of the access key, and the
secret key is masked by the CLI itself.

## Verified account identity

| Field | Value |
| --- | --- |
| Account | `865230233603` |
| ARN | `arn:aws:iam::865230233603:root` |
| Account name | `Nati` |
| Account created | `2026-06-18T08:52:08+00:00` |
| Account state | `PENDING_ACTIVATION` ⚠️ (see below) |
| Default region | `us-east-1` |
| AWS CLI | `aws-cli/2.37.6 Python/3.14.6 Windows/10 exe/AMD64` |
| CLI path | `C:\Users\PC\AppData\Local\Programs\Amazon\AWSCLIV2\aws.exe` |

`aws sts get-caller-identity` returning this ARN is the proof: the call is signed with the
account's credentials and answered by AWS STS. It cannot succeed without a live connection.

## Evidence files

| File | Command | Exit | What it proves |
| --- | --- | --- | --- |
| `00-manifest.json` | — | — | Timestamped run record: agent, host, every command, every exit code |
| `01-sts-get-caller-identity.json` | `aws sts get-caller-identity` | 0 | Credentials valid; AWS identifies the caller |
| `02-aws-configure-list.txt` | `aws configure list` | 0 | Credential source and region (keys masked) |
| `03-aws-cli-version.txt` | `aws --version` | 0 | CLI version used |
| `04-account-information.json` | `aws account get-account-information` | 0 | Account name, creation date, state |
| `05-bedrock-list-foundation-models.json` | `aws bedrock list-foundation-models --by-provider anthropic` | 0 | Bedrock control plane reachable; Anthropic catalog |
| `07-bedrock-inference-profiles.json` | `aws bedrock list-inference-profiles` | 0 | Cross-region inference profiles available |
| `08-enabled-regions.json` | `aws account list-regions` | 0 | Regions enabled on the account |
| `09-claude-code-session.md` | — | — | Session log tying agent identity to the verified STS call |

`06-bedrock-invoke-claude.json` is produced by `npm run smoke:bedrock` and records an actual
Claude invocation. It requires `npm install` and an activated account.

## What the Bedrock catalog query returned

The agent did not assume a model ID — it queried the account and picked from what is
actually available. Anthropic inference profiles found **ACTIVE** in `us-east-1`:

```
us.anthropic.claude-sonnet-5          ← selected: routes us-east-1, us-east-2, us-west-2
us.anthropic.claude-opus-5
us.anthropic.claude-opus-5-5
us.anthropic.claude-fable-5-1
us.anthropic.claude-haiku-4-5-20251001-v1:0
us.anthropic.claude-sonnet-4-6
us.anthropic.claude-opus-4-8
…and 9 more
```

`us.anthropic.claude-sonnet-5` is configured as the application default
(`BEDROCK_MODEL_ID`): current-generation Claude, best quality-for-cost on a high-volume
evaluation endpoint, and the three-region profile gives the widest availability.

> Profile `status: ACTIVE` means the profile exists for this account. It is not the same as
> **model access**, which is granted separately per-account per-region in the Bedrock
> console, and it does not by itself prove the data plane will accept an invocation.
> `npm run smoke:bedrock` is what settles that.

## Reproducing the proof

One command, entirely read-only:

```bash
npm run evidence
```

Or directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/capture-aws-evidence.ps1
```

Individual commands, to verify by hand:

```bash
aws sts get-caller-identity
aws configure list
aws account get-account-information
aws bedrock list-inference-profiles --region us-east-1
```

Failing commands are captured too, with their error payload. A `NotSignedUp` response is
still evidence of an authenticated call reaching AWS — it proves the connection while
documenting an account-state limitation.

## How the agent used the connection

Claude Code did not just authenticate — it built the deployable stack against this account:

1. **Probed identity and state** with STS and the Account API.
2. **Queried the Bedrock catalog** to confirm which Anthropic models this account can
   actually reach, then set the application default from that result rather than guessing.
3. **Chose the invocation pattern** — Bedrock `Converse` with a forced `toolChoice` over
   `InvokeModel` with hand-rolled provider bodies — so evaluation output is schema-locked
   and scores stay comparable between runs.
4. **Authored the CloudFormation stack** (`infra/template.yaml`) with secure defaults:
   S3 public access fully blocked, encryption at rest, `aws:SecureTransport` deny, CloudFront
   OAC with `AWS:SourceArn` confused-deputy protection, `DeletionPolicy: Retain` on stateful
   resources, and IAM scoped to `bedrock:InvokeModel` plus three DynamoDB actions on one
   table ARN.
5. **Wrote the deploy pipeline** (`scripts/deploy.ps1`) — bundle, deploy, push code, sync,
   invalidate, then poll `/api/health` until the live endpoint answers.

## ⚠️ Account activation — the ship-gate blocker

`04-account-information.json` reports:

```json
"AccountState": "PENDING_ACTIVATION"
```

While the account is in this state, S3, Lambda, CloudFormation, and CloudFront return
`NotSignedUp` / `SubscriptionRequiredException`. **No public URL can be provisioned**, which
fails the hackathon ship gate regardless of how complete the code is.

Read-only APIs still answer — which is why STS, the Account API, and the Bedrock control
plane all succeeded above. Provisioning is what is blocked.

**To unblock:**

1. https://portal.aws.amazon.com/billing/signup — complete sign-up
2. https://console.aws.amazon.com/billing/home#/account — add a payment method
3. Re-run `npm run evidence` and confirm `AccountState: ACTIVE`
4. `npm run deploy`

## Console access note

The agent works through the AWS CLI and SDKs, which is the reproducible, timestamped form of
console access — every call is signed with the same account credentials and logged to
CloudTrail. The agent did not enter the root user password in a browser session.
