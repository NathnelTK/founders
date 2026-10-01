/**
 * System prompt + tool schema for the Founder Arena evaluation.
 *
 * The schema is enforced through Bedrock Converse tool-use (forced toolChoice)
 * rather than "please return JSON" prompting, so the model cannot drift out of
 * shape. The shape is identical to what heuristics.mjs returns, which lets the
 * frontend stay engine-agnostic.
 */

export const SYSTEM_PROMPT = `You are the evaluation engine behind Founder Arena, a startup stress-test for founders worldwide.

Your job is to be the investor who actually reads the data room — witty, specific, and brutally honest, never cruel and never generic.

Rules:
- Use the payment methods, regulations, competitors, and operating realities of the market the founder describes. Never assume a country or region; name specific local examples only when relevant.
- Attack vagueness. A broad marketplace is not a strategy; start with a defined customer, location, channel, and product.
- Do the arithmetic when unit economics are supplied. Reference the actual contribution margin and CAC payback in your prose.
- Reward operational wedges (reconciliation, dispute handling, working-capital timing) over feature lists.
- The roast must be one sharp sentence a founder would screenshot, not a paragraph.
- Scores: global 38-92, investability 22-88, confidence 35-86. Be stingy. Most ideas are a 55, not an 80.
- Never invent traction, funding, or customers the founder did not state.

Write for a founder with limited runway who needs the truth this week, wherever they operate.`;

/** JSON Schema for the forced tool call. Mirrors the heuristics output shape. */
export const EVALUATION_SCHEMA = {
  type: "object",
  properties: {
    roast: {
      type: "string",
      description: "One sharp, witty, screenshot-worthy sentence naming this concept's core delusion."
    },
    marketPotential: {
      type: "string",
      description: "2-3 sentences on realistic demand density, not TAM slides. Name the corridor or customer segment."
    },
    monetization: {
      type: "string",
      description: "2-3 sentences on how this collects cash, through which rail, and why that take-rate survives."
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "3-4 concrete risks. Regulatory, operational, competitive. No generic 'market risk'."
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description: "3-4 actions the founder can start this week, each with a number or a name attached."
    },
    roadmap: {
      type: "array",
      items: {
        type: "object",
        properties: {
          week: { type: "string", description: "e.g. 'Week 1'" },
          item: { type: "string", description: "One concrete, verifiable deliverable." }
        },
        required: ["week", "item"]
      },
      description: "Exactly 4 entries, Week 1 through Week 4."
    },
    crowded: {
      type: "string",
      description: "Which part of this space is already saturated, and by whom."
    },
    opportunity: {
      type: "string",
      description: "The underserved gap worth owning, stated operationally."
    },
    confidence: {
      type: "integer",
      description: "35-86. How confident you are in this assessment given the information supplied."
    },
    missingSkills: {
      type: "array",
      items: { type: "string" },
      description: "1-3 roles absent from the founding team that this specific business cannot survive without."
    },
    investorQuestion: {
      type: "string",
      description: "The single hardest question a real VC asks in the first 10 minutes. Must be answerable with data, not vision."
    },
    regionalAnalysis: {
      type: "string",
      description: "What expansion into nearby markets requires: local regulations, channels, operations, and currency considerations."
    },
    scores: {
      type: "object",
      properties: {
        global: { type: "integer", description: "38-92 overall concept strength." },
        investability: { type: "integer", description: "22-88 willingness to write a cheque today." }
      },
      required: ["global", "investability"]
    },
    vcTakeaway: {
      type: "string",
      description: "One line: the verdict a partner writes in the deal memo."
    },
    coreAdvice: {
      type: "string",
      description: "One line: the single change that most improves this concept."
    }
  },
  required: [
    "roast",
    "marketPotential",
    "monetization",
    "risks",
    "suggestions",
    "roadmap",
    "crowded",
    "opportunity",
    "confidence",
    "missingSkills",
    "investorQuestion",
    "regionalAnalysis",
    "scores",
    "vcTakeaway",
    "coreAdvice"
  ]
};

export const EVALUATION_TOOL = {
  toolSpec: {
    name: "submit_evaluation",
    description: "Submit the structured startup evaluation. Call this exactly once.",
    inputSchema: { json: EVALUATION_SCHEMA }
  }
};

/** Builds the user turn describing the pitch under evaluation. */
export function buildPitchMessage(pitch, audit) {
  const lines = [
    `Startup name: ${pitch.name || "(unnamed)"}`,
    `Sector: ${pitch.sector || "(unspecified)"}`,
    `Target market: ${pitch.market || "(unspecified)"}`,
    `Team skills present: ${(pitch.skills || []).join(", ") || "(none stated)"}`,
    "",
    "Pitch:",
    pitch.pitch || "(no pitch text supplied)"
  ];

  if (audit && audit.contribution !== null && audit.contribution !== undefined) {
    lines.push(
      "",
      "Unit economics supplied by the founder:",
      `- Price per unit: ${pitch.price}`,
      `- COGS per unit: ${pitch.cogs}`,
      `- CAC: ${pitch.cac}`,
      `- Contribution margin: ${audit.contribution} (${(audit.marginPct ?? 0).toFixed(1)}%)`,
      audit.paybackUnits
        ? `- CAC payback: ~${audit.paybackUnits.toFixed(1)} units`
        : "- CAC payback: not computable",
      "",
      "Reference these numbers explicitly in marketPotential or monetization."
    );
  } else {
    lines.push(
      "",
      "No unit economics were supplied. Say so plainly and cap investability accordingly."
    );
  }

  return lines.join("\n");
}

export const BATTLE_TOOL = {
  toolSpec: {
    name: "submit_battle_verdict",
    description: "Submit the head-to-head verdict between two startup concepts. Call this exactly once.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          winner: { type: "string", description: "The name of the winning concept, exactly as supplied." },
          rationale: { type: "string", description: "2-3 sentences on why it wins on risk-adjusted collectability." },
          axes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                a: { type: "integer" },
                b: { type: "integer" }
              },
              required: ["label", "a", "b"]
            },
            description: "3-4 comparison axes scored 0-100 for concept A and concept B."
          }
        },
        required: ["winner", "rationale", "axes"]
      }
    }
  }
};

export const BATTLE_SYSTEM_PROMPT = `You are judging two startup concepts head to head for founders worldwide.

Pick a winner on risk-adjusted collectability: which one can earn real revenue sooner through a viable channel in its stated market, with fewer unresolved dependencies. Ignore which story is more exciting. Be decisive — no ties, no "it depends".`;
