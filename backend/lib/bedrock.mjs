/**
 * Amazon Bedrock evaluation engine (Claude via the Converse API).
 *
 * Design notes:
 * - Converse over InvokeModel: one request shape across models, no provider-specific bodies.
 * - Forced tool-use guarantees the JSON shape instead of hoping the model returns valid JSON.
 * - maxTokens is always explicit. Leaving it unset defaults to the model max and silently
 *   reserves far more quota than needed, which is the usual cause of surprise throttling.
 * - Every failure degrades to the local heuristics engine so the app never hard-fails for a
 *   founder. This matters here: the demo account may not have Bedrock model access granted.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand
} from "@aws-sdk/client-bedrock-runtime";

import {
  heuristicsEvaluate,
  battleHeuristics,
  marginAudit
} from "./heuristics.mjs";

import {
  SYSTEM_PROMPT,
  EVALUATION_TOOL,
  BATTLE_TOOL,
  BATTLE_SYSTEM_PROMPT,
  buildPitchMessage
} from "./prompts.mjs";

export const REGION = process.env.AWS_REGION || process.env.BEDROCK_REGION || "us-east-1";

/**
 * Cross-region inference profile ID ("us." prefix) for higher availability.
 * Verified ACTIVE in this account via `aws bedrock list-inference-profiles`
 * (hackathon-evidence/07). Routes across us-east-1, us-east-2, us-west-2.
 * Override with BEDROCK_MODEL_ID.
 */
export const MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-sonnet-5";

const MAX_TOKENS = Number(process.env.BEDROCK_MAX_TOKENS) || 3000;

/** Errors that mean "stop asking" — retrying these just burns latency. */
const FATAL_ERRORS = new Set([
  "AccessDeniedException",
  "ValidationException",
  "ResourceNotFoundException",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "SubscriptionRequiredException"
]);

let client;

function getClient() {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: REGION,
      maxAttempts: 5,
      retryMode: "adaptive"
    });
  }
  return client;
}

/** True when Bedrock is switched off by configuration. */
export function bedrockDisabled() {
  return String(process.env.DISABLE_BEDROCK || "").toLowerCase() === "true";
}

/**
 * Runs one Converse call with a forced tool choice and returns the parsed tool input.
 * Throws on any Bedrock or shape failure; callers decide whether to fall back.
 */
async function converseForTool({ system, userText, tool }) {
  const response = await getClient().send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: system }],
      messages: [{ role: "user", content: [{ text: userText }] }],
      inferenceConfig: {
        maxTokens: MAX_TOKENS,
        temperature: 0.7
      },
      toolConfig: {
        tools: [tool],
        toolChoice: { tool: { name: tool.toolSpec.name } }
      }
    })
  );

  const blocks = response.output?.message?.content ?? [];
  const toolUse = blocks.find((b) => b.toolUse)?.toolUse;

  if (!toolUse?.input) {
    throw new Error(
      `Bedrock returned no tool input (stopReason=${response.stopReason ?? "unknown"})`
    );
  }

  return {
    data: toolUse.input,
    usage: response.usage ?? null,
    stopReason: response.stopReason ?? null
  };
}

function clampInt(value, lo, hi, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function asStringArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const out = value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
  return out.length ? out : fallback;
}

/**
 * Normalises model output into the exact contract the frontend renders.
 * Model output is untrusted input: every field is coerced, clamped, or defaulted.
 */
function normaliseEvaluation(raw, audit, meta) {
  const roadmap = Array.isArray(raw.roadmap)
    ? raw.roadmap
        .filter((r) => r && typeof r.item === "string" && r.item.trim())
        .slice(0, 6)
        .map((r, i) => ({
          week: typeof r.week === "string" && r.week.trim() ? r.week.trim() : `Week ${i + 1}`,
          item: r.item.trim()
        }))
    : [];

  return {
    engine: "bedrock",
    model: MODEL_ID,
    region: REGION,
    roast: String(raw.roast || "").trim() || "No verdict returned.",
    marketPotential: String(raw.marketPotential || "").trim(),
    monetization: String(raw.monetization || "").trim(),
    risks: asStringArray(raw.risks, []),
    suggestions: asStringArray(raw.suggestions, []),
    roadmap,
    crowded: String(raw.crowded || "").trim(),
    opportunity: String(raw.opportunity || "").trim(),
    confidence: clampInt(raw.confidence, 35, 86, 55),
    missingSkills: asStringArray(raw.missingSkills, []).slice(0, 3),
    investorQuestion: String(raw.investorQuestion || "").trim(),
    regionalAnalysis: String(raw.regionalAnalysis || "").trim(),
    scores: {
      global: clampInt(raw.scores?.global, 38, 92, 55),
      investability: clampInt(raw.scores?.investability, 22, 88, 45)
    },
    // Economics stay deterministic — arithmetic is not the model's job.
    economics: audit,
    vcTakeaway: String(raw.vcTakeaway || "").trim(),
    coreAdvice: String(raw.coreAdvice || "").trim(),
    usage: meta?.usage ?? null
  };
}

/**
 * Evaluates a pitch with Claude on Bedrock, degrading to local heuristics on any failure.
 * Always resolves — never throws — and reports which engine produced the answer.
 */
export async function evaluatePitch(pitch) {
  const audit = marginAudit(pitch);

  if (bedrockDisabled()) {
    return { ...heuristicsEvaluate(pitch), fallbackReason: "bedrock disabled by config" };
  }

  try {
    const { data, usage, stopReason } = await converseForTool({
      system: SYSTEM_PROMPT,
      userText: buildPitchMessage(pitch, audit),
      tool: EVALUATION_TOOL
    });

    return normaliseEvaluation(data, audit, { usage, stopReason });
  } catch (err) {
    const name = err?.name || "Error";
    const reason = FATAL_ERRORS.has(name)
      ? `${name}: ${err.message}`
      : `${name}: ${err.message}`;

    console.warn(`[bedrock] evaluate failed, using heuristics — ${reason}`);

    return {
      ...heuristicsEvaluate(pitch),
      fallbackReason: reason,
      attemptedModel: MODEL_ID
    };
  }
}

/** Head-to-head verdict between two already-evaluated concepts. */
export async function battleConcepts(a, b) {
  if (bedrockDisabled()) {
    return { ...battleHeuristics(a, b), fallbackReason: "bedrock disabled by config" };
  }

  const describe = (c, label) =>
    [
      `Concept ${label}: ${c.name || label}`,
      `Investability: ${c.scores?.investability ?? "n/a"}`,
      `Global rating: ${c.scores?.global ?? "n/a"}`,
      `Confidence: ${c.confidence ?? "n/a"}`,
      `Market: ${c.market || "n/a"}`,
      `Monetization: ${c.monetization || "n/a"}`,
      `Economics: ${c.economics?.note || "not supplied"}`
    ].join("\n");

  try {
    const { data, usage } = await converseForTool({
      system: BATTLE_SYSTEM_PROMPT,
      userText: `${describe(a, "A")}\n\n${describe(b, "B")}\n\nPick the winner.`,
      tool: BATTLE_TOOL
    });

    const axes = Array.isArray(data.axes)
      ? data.axes
          .filter((x) => x && typeof x.label === "string")
          .slice(0, 4)
          .map((x) => ({
            label: x.label.trim(),
            a: clampInt(x.a, 0, 100, 50),
            b: clampInt(x.b, 0, 100, 50)
          }))
      : [];

    return {
      engine: "bedrock",
      model: MODEL_ID,
      winner: String(data.winner || "").trim() || (a.name || "A"),
      rationale: String(data.rationale || "").trim(),
      axes: axes.length ? axes : battleHeuristics(a, b).axes,
      usage: usage ?? null
    };
  } catch (err) {
    console.warn(`[bedrock] battle failed, using heuristics — ${err?.name}: ${err?.message}`);
    return {
      ...battleHeuristics(a, b),
      fallbackReason: `${err?.name}: ${err?.message}`
    };
  }
}

/**
 * Answers a simulated investor follow-up and returns an investability delta.
 * Falls back to a deterministic scorer keyed on answer substance.
 */
export async function scoreInvestorAnswer({ question, answer, pitchName }) {
  const trimmed = String(answer || "").trim();

  const localScore = () => {
    const hasNumbers = /\d/.test(trimmed);
    const hasPaymentMethod = /visa|mastercard|stripe|paypal|adyen|square|shopify payments|bank transfer|bank|cash|card|wallet|mobile money|cash on delivery|cod|ussd|m-?pesa|telebirr|momo|paystack|flutterwave|agent/i.test(trimmed);
    const substantive = trimmed.length > 120;
    const delta =
      (hasNumbers ? 4 : -2) + (hasPaymentMethod ? 3 : 0) + (substantive ? 2 : -3);
    return {
      engine: "heuristics",
      delta: Math.max(-8, Math.min(9, delta)),
      critique: hasNumbers
        ? "Numbers present. Tighten it further by naming the payment method and collection window."
        : "No numbers. An investor reads this as a guess — quantify the claim or drop it."
    };
  };

  if (bedrockDisabled() || trimmed.length < 3) {
    return localScore();
  }

  const tool = {
    toolSpec: {
      name: "submit_answer_score",
      description: "Score the founder's answer to an investor question. Call exactly once.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            delta: {
              type: "integer",
              description: "Investability change from -8 (evasive) to +9 (fully substantiated)."
            },
            critique: {
              type: "string",
              description: "1-2 sentences an investor would actually say back. Direct, specific."
            }
          },
          required: ["delta", "critique"]
        }
      }
    }
  };

  try {
    const { data } = await converseForTool({
      system:
        "You are a venture investor grading a founder's live answer. Reward numbers, named rails, and falsifiable claims. Punish vision-speak and evasion. Be terse.",
      userText: `Startup: ${pitchName || "(unnamed)"}\n\nYour question was:\n${question}\n\nThe founder answered:\n${trimmed}\n\nScore it.`,
      tool
    });

    return {
      engine: "bedrock",
      model: MODEL_ID,
      delta: clampInt(data.delta, -8, 9, 0),
      critique: String(data.critique || "").trim() || "No critique returned."
    };
  } catch (err) {
    console.warn(`[bedrock] answer scoring failed — ${err?.name}: ${err?.message}`);
    return { ...localScore(), fallbackReason: `${err?.name}: ${err?.message}` };
  }
}

/**
 * Connectivity probe used by /api/health and the Bedrock smoke test.
 * Returns a plain result object rather than throwing so callers can render status.
 */
export async function probeBedrock() {
  if (bedrockDisabled()) {
    return { ok: false, reason: "disabled by config", model: MODEL_ID, region: REGION };
  }

  try {
    const response = await getClient().send(
      new ConverseCommand({
        modelId: MODEL_ID,
        messages: [{ role: "user", content: [{ text: "Reply with the single word: ready" }] }],
        inferenceConfig: { maxTokens: 16, temperature: 0 }
      })
    );

    return {
      ok: true,
      model: MODEL_ID,
      region: REGION,
      reply: response.output?.message?.content?.[0]?.text?.trim() ?? "",
      usage: response.usage ?? null
    };
  } catch (err) {
    return {
      ok: false,
      model: MODEL_ID,
      region: REGION,
      error: err?.name || "Error",
      reason: err?.message || String(err)
    };
  }
}
