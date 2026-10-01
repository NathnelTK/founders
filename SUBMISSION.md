# Submission checklist — Zero to Shipped

**Deadline:** October 2, 2026 · 11:59 PM PDT
**Project page:** https://builder.aws.com/build/hackathons/e83e84e5-4f4c-383b-bbe9-4a15ac195d55/zero-to-shipped?tab=your-project

Work top to bottom. Step 2 is the hard gate — a project that isn't live does not advance
to judging no matter how strong the idea is.

---

## 1. Capture the agent-to-AWS connection proof

```bash
npm run evidence
```

Read-only. Writes `hackathon-evidence/` and a timestamped `00-manifest.json`.
Then open `hackathon-evidence/04-account-information.json` and check `AccountState`.

- [ ] `01-sts-get-caller-identity.json` shows your account ID
- [ ] `00-manifest.json` exists with a capture timestamp
- [ ] `AccountState` noted (see step 2 if `PENDING_ACTIVATION`)

## 2. Ship it live — the pass/fail gate

**If `AccountState` is `PENDING_ACTIVATION`, do this first.** Nothing can deploy until
the account is activated:

1. https://portal.aws.amazon.com/billing/signup — complete sign-up
2. https://console.aws.amazon.com/billing/home#/account — add a payment method
3. Wait for activation (usually minutes, occasionally a few hours)
4. Re-run `npm run evidence` and confirm `AccountState: ACTIVE`

Then:

```bash
npm install
npm run deploy
```

The script prints a `Live URL` at the end. First CloudFront deploys can take ~15 minutes
to propagate.

- [ ] `npm run deploy` finished without error
- [ ] The `Live URL` loads in a browser over HTTPS
- [ ] `<Live URL>/api/health` returns JSON
- [ ] Submitting a pitch returns a real evaluation

## 3. Turn on Claude (optional but worth it)

```bash
npm run smoke:bedrock
```

If it reports `AccessDeniedException`, enable Anthropic models in the
[Bedrock console → Model access](https://console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess)
for **us-east-1**, then re-run.

The app ships either way — without Bedrock it uses the local heuristics engine and the
header says so. But "Claude on Bedrock" in the header is a stronger story for judges.

- [ ] Header shows **Claude on Bedrock** (or heuristics, knowingly)

## 3b. Confirm authentication works

The stack creates the Amazon Cognito user pool and Hosted UI domain for you. Nothing to
configure — but confirm the flow before you record the demo.

```bash
aws cloudformation describe-stacks --stack-name founder-arena --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='CognitoDomain'].OutputValue" --output text
```

- [ ] Click **Sign in** → **Sign in with AWS** → the Cognito Hosted UI loads
- [ ] Create an account (email + password) and you land back on the live URL as that founder
- [ ] Publish a pitch and confirm the community card shows your name
- [ ] If the pool is missing, the app still runs in **guest mode** — confirm that fallback too,
      because it is what the app does when AWS is unavailable

## 4. Fill in the Builder Center project page

Every submission must include all of the following:

- [ ] **Live app URL** — the `Live URL` from step 2
- [ ] **Category tag:** `#commercial-potential`
- [ ] **Lane tag:** `#startups`
- [ ] **Proof of agent-to-AWS connection** — link or paste
      [`hackathon-evidence/CONNECTION.md`](hackathon-evidence/CONNECTION.md)
- [ ] **Development process** — how the coding agent helped you ship
- [ ] **Confirm the app is original** and not previously published

### Category and lane — why these

**`#commercial-potential`:** a SaaS tool with an obvious paid tier (unlimited evaluations,
team workspaces, investor-ready exports) aimed at a defined market.

**`#startups`:** the project is pointed at becoming a product, with a story about where it
goes next.

> Consider `#social-good` + `#community` instead if you want to lead on the education /
> workforce-development angle — the skills gap for first-time founders in emerging markets.
> Pick one pair; you cannot submit both.

### Suggested write-up

> **What it is.** Foundry is an entrepreneurial experimentation lab. An idea is a hypothesis:
> Foundry turns assumptions into experiments, experiments into evidence, and evidence into a
> decision. A founder submits a hypothesis and gets a risk-rated assumption board, a five-seat
> founder council, a unit-economics audit, and an explicit **PROCEED / PIVOT / PERISH** call
> that moves as evidence comes in.
>
> **Why.** Founders burn scarce runway building things nobody pays for. The feedback available
> to them is either polite or unavailable. Foundry is the lab where the assumption — not the
> idea — is the unit of work, and where a founder can see exactly which belief is killing the
> business this week.
>
> **How it runs on AWS.** Claude on Amazon Bedrock evaluates each hypothesis through the
> Converse API with a forced tool call, so every response is schema-locked and scores stay
> comparable between runs. Amazon Cognito signs founders in through the Hosted UI, and the API
> verifies the ID token against the pool's JWKS before attributing a published pitch. AWS Lambda
> serves the API behind a Function URL; DynamoDB holds the public community board; S3 and
> CloudFront serve the frontend over HTTPS from a single origin, so the browser makes
> same-origin API calls with no CORS layer. The whole stack is one CloudFormation template.
>
> **What I'd defend in a design review.** The decision is deterministic and lives in code: the
> board, the council, and the evidence score are pure functions, so the same hypothesis always
> produces the same call and PIVOT never depends on model mood. The model never does arithmetic
> — contribution margin and CAC payback are computed locally and passed into the prompt as
> facts. And the app degrades instead of failing: if Bedrock is unreachable the evaluation falls
> through to the local engine, if DynamoDB is absent it uses memory, and if Cognito is not
> configured it drops to a clearly labelled guest session. A founder always gets an answer.
>
> **How the coding agent helped.** Built with Claude Code driving the AWS CLI. It captured its
> own connection proof, queried the Bedrock catalog to confirm which models this account can
> actually invoke rather than assuming a model ID, chose Converse-with-forced-tool-use over
> hand-rolled InvokeModel bodies, and authored the CloudFormation stack with secure defaults —
> S3 public access blocked, OAC, encryption at rest, Retain on stateful resources, a Cognito
> client with no secret, and IAM scoped to one Bedrock action and three DynamoDB actions on one
> table.

## 5. Before you submit

- [ ] Open the live URL on a phone — the layout is responsive, confirm it
- [ ] Click through all seven destinations: Workspace, Assumption Board, Founder Council, Decision, Battle, Vault, Community
- [ ] On the board, flip one assumption to **Validated** and one to **Invalidated** — the Decision tab's score and call must move
- [ ] Save a board to the Vault, reopen it, and confirm the board comes back
- [ ] Sign in with Cognito (or knowingly run as guest), then publish one pitch so the board isn't empty for judges
- [ ] Re-read the [rules](https://builder.aws.com/build/hackathons/e83e84e5-4f4c-383b-bbe9-4a15ac195d55/zero-to-shipped?tab=rules)
      for country and employee exclusions
- [ ] Submit before **Oct 2, 11:59 PM PDT** — don't leave CloudFront propagation to the last hour

## Cost note

Everything here is serverless and scales to zero: Lambda and DynamoDB on-demand, S3 for a
few hundred KB, CloudFront `PriceClass_100`. Bedrock is the only per-use cost, billed per
token on Claude Sonnet. Demo-level traffic sits in cents per day; set a
[budget alert](https://console.aws.amazon.com/billing/home#/budgets) if you want a
guardrail.

To tear it all down:

```bash
aws cloudformation delete-stack --stack-name founder-arena --region us-east-1
```

Note that the S3 bucket and DynamoDB table carry `DeletionPolicy: Retain` — they survive
on purpose, holding founder-authored content. Delete them by hand if you want them gone.
