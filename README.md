# Foundry

**An idea is a hypothesis. Foundry turns assumptions into experiments, experiments into
evidence, and evidence into a decision.**

A founder submits a hypothesis and gets a risk-rated assumption board, a five-seat founder
council, a unit-economics audit that actually does the arithmetic, a 4-week validation plan, a
live investor Q&A, and an explicit **PROCEED / PIVOT / PERISH** call that updates as evidence
comes in.

> **Zero to Shipped 2026** · `#commercial-potential` `#startups`
> Live URL: _see `LiveUrl` in the deploy output_ · Connection proof: [`hackathon-evidence/`](hackathon-evidence/)

---

## The product loop

```
Hypothesis ──► Assumption Board ──► Experiments ──► Evidence ──► Decision
   Workspace      11 falsifiable       each claim      status +      PROCEED
                  claims, risk-rated   has a test      notes/links    PIVOT
                  D / V / F                                          PERISH
```

1. **Workspace** — enter the hypothesis, audience, pricing, and team skills.
2. **Assumption Board** — the engine splits it into Desirability, Viability, and Feasibility
   claims, each with a risk rating and a concrete experiment. Toggle status
   (Unvalidated → In-Testing → Validated / Invalidated) and attach evidence notes or metric
   links.
3. **Founder Council** — Strategist, CFO, Validator, Builder, and Skeptic critique the same
   board. Re-runnable through your own API key.
4. **Decision** — a weighted evidence score over the board produces PROCEED, PIVOT, or
   PERISH, plus the next moves ranked by which high-risk claims are still unproven.

---

## Why this exists

Founders everywhere burn scarce runway building things nobody pays for. The feedback
they can get is either polite (friends, incubator demo days) or unavailable
(real VCs, who won't take the meeting until there's traction).

Founder Arena is the investor who *will* take the meeting — at 2am, for free, and without
being nice about it. It is opinionated on purpose: it challenges vague market claims,
expects payment methods and regulations to fit the stated market, and refuses to score
an idea highly without collectible unit economics.

## What it does

| Feature | What it gives you |
| --- | --- |
| **Workspace** | Hypothesis intake; roast, market read, monetization path, risks, 4-week plan, scores |
| **Assumption Board** | 11 falsifiable claims across Desirability / Viability / Feasibility, risk-rated, each with a test |
| **Founder Council** | Five perspectives — Strategist, CFO, Validator, Builder, Skeptic |
| **Decision** | Weighted evidence score and an explicit PROCEED / PIVOT / PERISH call |
| **Unit-economics audit** | Contribution margin and CAC payback, computed locally — never by the model |
| **Investor Q&A simulator** | The hardest question a VC asks first; your answer moves the score |
| **Bring your own key** | Re-run the council on OpenAI, Anthropic, or OpenRouter with a key that stays in your browser |
| **Cognito sign-in** | Amazon Cognito Hosted UI; the API verifies the ID token before attributing a post |
| **Battle Arena** | Two concepts head to head on risk-adjusted collectability |
| **Vault** | Local archive (localStorage) — nothing leaves the browser unless published |
| **Community board** | Opt-in public board of published pitches |

## Architecture

```
                       ┌──────────────────────────┐
   Browser ───HTTPS──► │   Amazon CloudFront      │
                       │  one origin, two routes  │
                       └───┬──────────────────┬───┘
                       /*  │                  │  /api/*
                           ▼                  ▼
               ┌───────────────────┐   ┌─────────────────────┐
               │  Amazon S3        │   │  AWS Lambda         │
               │  static frontend  │   │  (Function URL)     │
               │  private, OAC     │   │  Node 20 · arm64    │
               └───────────────────┘   └────┬───────────┬────┘
                                            │           │
                                            ▼           ▼
                             ┌──────────────────┐  ┌──────────────┐
                             │ Amazon Bedrock   │  │ Amazon       │
                             │ Claude (Converse)│  │ DynamoDB     │
                             └──────────────────┘  └──────────────┘
                                            ▲
                                            │ ID token (JWKS verify)
                                  ┌──────────────────┐
                                  │ Amazon Cognito   │
                                  │ Hosted UI (OIDC) │
                                  └──────────────────┘
```

**AWS services used:** Bedrock · Lambda · DynamoDB · Cognito · S3 · CloudFront · IAM · CloudWatch Logs · CloudFormation

### Design decisions worth calling out

**One CloudFront distribution serves both the app and the API.** The frontend calls
`/api/*` on its own origin, so there is no CORS preflight, no second domain, and one URL
for judges.

**Structured output via forced tool-use, not "please return JSON".** Every evaluation is
a Bedrock `Converse` call with `toolChoice` pinned to a single tool whose `inputSchema`
is the evaluation shape. The model cannot drift out of shape, which is what makes scores
comparable between runs.

**The model never does arithmetic.** Contribution margin and CAC payback are computed in
`backend/lib/heuristics.mjs` and passed *into* the prompt as facts. LLMs are good at
judgement and bad at being a calculator; this split keeps the numbers trustworthy.

**It degrades instead of failing.** If Bedrock returns `AccessDeniedException`, throttles,
or the account lacks model access, the request falls through to a deterministic local engine.
A founder always gets an evaluation, and the header always shows which engine produced it. The
same fallback applies to DynamoDB — no table, no crash — and to auth: with no Cognito pool
configured (local dev, or an account that is not yet active) sign-in drops to a clearly
labelled guest session instead of blocking the product.

**Authentication is real, but never a gate.** Sign-in uses the Cognito Hosted UI over OAuth 2.0
(implicit flow) — no client secret, no SDK. The browser keeps the ID token and sends it as a
Bearer token; the API verifies signature, issuer, audience, and expiry against the user pool's
JWKS with [`aws-jwt-verify`](https://github.com/awslabs/aws-jwt-verify) before attributing a
published pitch. An invalid token is treated as anonymous rather than an error.

**One deterministic engine, not two code paths.** The assumption board, council, and decision
are pure functions in `backend/lib/engine.mjs`, so the same hypothesis always produces the same
board. Bedrock and BYOK refine the prose; they never own the logic that decides PIVOT vs PROCEED.

**BYOK keys never leave the browser except per request.** A founder's OpenAI / Anthropic /
OpenRouter key is stored in localStorage and sent over HTTPS to this app's own API, which
proxies the call so the browser never needs cross-origin provider access. The server never
persists or logs it, and the key is never written back into a form field after saving.

**Model output is untrusted input.** Every field from Bedrock is coerced, clamped, and
length-capped in `normaliseEvaluation()`, and the frontend renders everything with
`textContent` — never `innerHTML`. The community board is user-generated content and is
treated as such.

## Running it locally

```bash
npm install
npm start          # http://localhost:3000
```

The local server serves the frontend and the API from one port, mirroring the deployed
topology. With no AWS credentials it still runs — the heuristics engine and an in-memory
store cover for Bedrock and DynamoDB.

```bash
DISABLE_BEDROCK=true npm start   # force the offline engine
npm run smoke:bedrock            # can this account actually invoke Claude?
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Local server port |
| `AWS_REGION` | `us-east-1` | Region for Bedrock, DynamoDB, and Cognito |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-5` | Model or inference profile |
| `BEDROCK_MAX_TOKENS` | `3000` | Explicit output cap (never left unset) |
| `TABLE_NAME` | _unset_ | DynamoDB table; falls back to memory when absent |
| `DISABLE_BEDROCK` | `false` | Force the deterministic engine |
| `COGNITO_USER_POOL_ID` | _unset_ | User pool whose ID tokens the API verifies |
| `COGNITO_CLIENT_ID` | _unset_ | Public app client ID (audience check) |
| `COGNITO_DOMAIN` | _unset_ | Hosted UI domain reported to the browser |

With the three `COGNITO_*` variables unset, `/api/auth/config` reports `mode: "guest"` and the
app runs without ever asking for an account.

## Deploying

```bash
npm run deploy
```

One idempotent script: bundles the handler, deploys the stack, pushes the code, syncs the
frontend, invalidates the CDN, and polls `/api/health` until it answers. It prints the
public HTTPS URL at the end.

```bash
npm run validate:infra   # validate the template before deploying
```

**Prerequisite:** the AWS account must be fully activated with a payment method. A
`PENDING_ACTIVATION` account returns `NotSignedUp` / `SubscriptionRequiredException` from
S3, Lambda, and CloudFormation, and nothing can be provisioned. See
[`hackathon-evidence/CONNECTION.md`](hackathon-evidence/CONNECTION.md) for the current
account state.

**Bedrock model access** is granted per-account per-region. If `npm run smoke:bedrock`
reports `AccessDeniedException`, enable the model in the Bedrock console under *Model
access* — the app ships either way, on heuristics.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Which engine is live, storage mode, auth mode, model, region |
| `POST /api/evaluate` | Evaluate a hypothesis; returns the evaluation **plus** the assumption board, council, and a first decision |
| `POST /api/council` | Regenerate the five perspectives, deterministically or through BYOK |
| `POST /api/decision` | Evidence score and PROCEED / PIVOT / PERISH from a board |
| `GET /api/providers` | Providers the BYOK panel can offer |
| `GET /api/auth/config` | Public Cognito configuration (never a secret) |
| `GET /api/auth/me` | Verified identity for the current Bearer token |
| `POST /api/battle` | Compare two evaluated concepts |
| `POST /api/investor-answer` | Score an answer, return an investability delta |
| `GET /api/community` | List published pitches |
| `POST /api/community` | Publish a pitch, attributed to the verified identity when present |

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H 'content-type: application/json' \
    -d '{"name":"CornerCart","sector":"SaaS","market":"Independent neighborhood grocery stores",
      "pitch":"Independent grocery stores spend hours comparing supplier price lists and rebuilding orders by hand. CornerCart brings inventory and supplier catalogs into one workspace, flags cheaper substitutions, and prepares purchase orders for owners to approve. We charge a monthly subscription and will only add automated ordering after owners use the recommendations for four consecutive weeks.",
      "price":99,"cogs":25,"cac":120}'
```

## Layout

```
├── backend/
│   ├── app.mjs                     Transport-agnostic router (shared by server + Lambda)
│   ├── server.mjs                  Local dev server (also serves the frontend)
│   ├── lambda.mjs                  Function URL adapter
│   ├── lib/
│   │   ├── bedrock.mjs             Converse API + forced tool-use + fallback
│   │   ├── engine.mjs              Deterministic assumptions, council, and decision
│   │   ├── byok.mjs                OpenAI / Anthropic / OpenRouter proxy (key never stored)
│   │   ├── auth.mjs                Cognito config + ID-token verification (JWKS)
│   │   ├── prompts.mjs             System prompt and tool schemas
│   │   ├── heuristics.mjs          Deterministic evaluation + economics arithmetic
│   │   └── store.mjs               DynamoDB with in-memory fallback
│   └── scripts/smoke-bedrock.mjs   Model-access probe (writes evidence)
├── frontend/                       Vanilla ES modules, no build step
│   ├── app.js                      Controller: navigation, board, council, decision, vault
│   └── auth.js                     Cognito Hosted UI sign-in with guest fallback
├── infra/template.yaml             CloudFormation: the whole stack, including Cognito
├── scripts/
│   ├── deploy.ps1                  Bundle → deploy → sync → invalidate → verify
│   └── capture-aws-evidence.ps1    Read-only AWS connection proof
└── hackathon-evidence/             Documented agent-to-AWS connection
```

## How the coding agent helped ship this

Built with **Claude Code** (Anthropic) driving the AWS CLI and authoring the stack. The
agent captured its own connection proof (`npm run evidence`), wrote the CloudFormation
template with secure defaults, and chose the Bedrock invocation pattern — Converse with
forced tool-use over `InvokeModel` with hand-rolled provider bodies. See
[`hackathon-evidence/CONNECTION.md`](hackathon-evidence/CONNECTION.md).

## License

MIT
