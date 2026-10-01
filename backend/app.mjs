/**
 * Shared HTTP routing for Founder Arena / Foundry.
 *
 * Deliberately transport-agnostic: it takes a plain {method, path, body, query, headers}
 * and returns a plain {status, body}. server.mjs adapts node:http onto it for local
 * development and lambda.mjs adapts a Lambda Function URL event onto it in production.
 * One router, so local behaviour and deployed behaviour cannot drift.
 */

import { evaluatePitch, battleConcepts, scoreInvestorAnswer, probeBedrock, MODEL_ID, REGION } from "./lib/bedrock.mjs";
import { publishPitch, listPitches, storageMode } from "./lib/store.mjs";
import { buildAssumptions, buildCouncil, computeDecision, buildAnalysis } from "./lib/engine.mjs";
import { councilFromProvider, supportedProviders } from "./lib/byok.mjs";
import { authConfig, authEnabled, identityFromHeader } from "./lib/auth.mjs";

const MAX_PITCH_CHARS = 4000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Coerces a numeric field, returning undefined for blanks so the audit can detect absence. */
function optionalNumber(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new HttpError(400, `${field} must be a non-negative number`);
  }
  return n;
}

/** Validates and normalises a founder-submitted pitch. User input is never trusted. */
function parsePitch(raw, { requirePitch = true } = {}) {
  if (!raw || typeof raw !== "object") {
    throw new HttpError(400, "Request body must be a JSON object");
  }

  const text = String(raw.pitch ?? "").trim();
  if (requirePitch && text.length < 20) {
    throw new HttpError(400, "Pitch must be at least 20 characters");
  }
  if (text.length > MAX_PITCH_CHARS) {
    throw new HttpError(400, `Pitch must be under ${MAX_PITCH_CHARS} characters`);
  }

  const skills = Array.isArray(raw.skills)
    ? raw.skills.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim().slice(0, 40)).slice(0, 12)
    : [];

  return {
    name: String(raw.name ?? "").trim().slice(0, 120),
    sector: String(raw.sector ?? "").trim().slice(0, 80),
    market: String(raw.market ?? "").trim().slice(0, 120),
    pitch: text,
    skills,
    price: optionalNumber(raw.price, "price"),
    cogs: optionalNumber(raw.cogs, "cogs"),
    cac: optionalNumber(raw.cac, "cac")
  };
}

/** Normalises a client-supplied assumption board before scoring it. */
function parseAssumptions(raw) {
  if (!Array.isArray(raw)) return [];
  const statuses = new Set(["unvalidated", "testing", "validated", "invalidated"]);
  const risks = new Set(["High", "Medium", "Low"]);
  const categories = new Set(["Desirability", "Viability", "Feasibility"]);

  return raw.slice(0, 60).map((a, i) => ({
    id: String(a?.id || `a${i}`).slice(0, 40),
    category: categories.has(a?.category) ? a.category : "Desirability",
    claim: String(a?.claim || "").slice(0, 400),
    risk: risks.has(a?.risk) ? a.risk : "Medium",
    experiment: String(a?.experiment || "").slice(0, 600),
    status: statuses.has(a?.status) ? a.status : "unvalidated"
  }));
}

/** Reads BYOK settings off a request, validating the provider. */
function parseByok(raw) {
  if (!raw || typeof raw !== "object") return null;
  const provider = String(raw.provider || "").toLowerCase();
  const key = String(raw.key || "");
  if (!provider || !key) return null;
  if (!supportedProviders().some((p) => p.id === provider)) {
    throw new HttpError(400, `Unsupported provider: ${raw.provider}`);
  }
  if (key.length > 400) throw new HttpError(400, "API key is too long");
  return { provider, key, model: String(raw.model || "").slice(0, 120) };
}

const routes = {
  "GET /api/health": async () => {
    const bedrock = await probeBedrock();
    return {
      status: 200,
      body: {
        ok: true,
        service: "foundry",
        // The app is healthy whether or not Bedrock is reachable — heuristics cover the gap.
        engine: bedrock.ok ? "bedrock" : "heuristics",
        bedrock,
        storage: storageMode(),
        auth: authConfig(),
        model: MODEL_ID,
        region: REGION,
        time: new Date().toISOString()
      }
    };
  },

  /** Public auth configuration for the browser (never a secret). */
  "GET /api/auth/config": async () => ({ status: 200, body: authConfig() }),

  /** Who is calling, according to a verified Cognito ID token. */
  "GET /api/auth/me": async (_body, _query, headers) => {
    if (!authEnabled()) {
      return { status: 200, body: { authenticated: false, mode: "guest", auth: authConfig() } };
    }
    const identity = await identityFromHeader(headers?.authorization);
    return {
      status: identity ? 200 : 401,
      body: identity
        ? { authenticated: true, mode: "cognito", identity }
        : { authenticated: false, mode: "cognito", error: "No valid session" }
    };
  },

  "POST /api/evaluate": async (body) => {
    const pitch = parsePitch(body);
    const result = await evaluatePitch(pitch);
    // The Foundry loop rides on the evaluation: assumptions, council, and a first call.
    const analysis = buildAnalysis(pitch, result);
    return {
      status: 200,
      body: {
        ...result,
        ...analysis,
        name: pitch.name,
        sector: pitch.sector,
        market: pitch.market,
        pitch: pitch.pitch
      }
    };
  },

  /** Regenerates the five founder perspectives, optionally through the founder's own key. */
  "POST /api/council": async (body) => {
    const pitch = parsePitch(body?.pitch || body, { requirePitch: false });
    const assumptions = Array.isArray(body?.assumptions)
      ? parseAssumptions(body.assumptions)
      : buildAssumptions(pitch, body?.evaluation);
    const byok = parseByok(body?.byok);

    if (byok) {
      try {
        const result = await councilFromProvider({
          pitch,
          evaluation: body?.evaluation,
          assumptions,
          provider: byok.provider,
          key: byok.key
        });
        return { status: 200, body: { ...result, assumptions } };
      } catch (err) {
        console.warn(`[council] BYOK failed, using deterministic engine — ${err?.name || "Error"}: ${err?.message}`);
        return {
          status: 200,
          body: {
            engine: "heuristics",
            council: buildCouncil(pitch, body?.evaluation, assumptions),
            assumptions,
            fallbackReason: `${byok.provider}: ${err?.message || "request failed"}`
          }
        };
      }
    }

    return {
      status: 200,
      body: {
        engine: "heuristics",
        council: buildCouncil(pitch, body?.evaluation, assumptions),
        assumptions
      }
    };
  },

  /** Evidence score and PROCEED / PIVOT / PERISH from the current board. */
  "POST /api/decision": async (body) => {
    const assumptions = parseAssumptions(body?.assumptions);
    return { status: 200, body: { ...computeDecision(assumptions), assumptions } };
  },

  /** Providers the BYOK panel can offer. */
  "GET /api/providers": async () => ({
    status: 200,
    body: { providers: supportedProviders(), default: "bedrock" }
  }),

  "POST /api/battle": async (body) => {
    if (!body?.a || !body?.b) {
      throw new HttpError(400, "Body must contain two evaluated concepts: a and b");
    }
    const result = await battleConcepts(body.a, body.b);
    return { status: 200, body: result };
  },

  "POST /api/investor-answer": async (body) => {
    const question = String(body?.question ?? "").trim();
    const answer = String(body?.answer ?? "").trim();
    if (!question) throw new HttpError(400, "question is required");
    if (!answer) throw new HttpError(400, "answer is required");
    if (answer.length > 2000) throw new HttpError(400, "answer must be under 2000 characters");

    const result = await scoreInvestorAnswer({
      question,
      answer,
      pitchName: String(body?.pitchName ?? "").trim().slice(0, 120)
    });
    return { status: 200, body: result };
  },

  "GET /api/community": async (_body, query) => {
    const items = await listPitches(query?.limit);
    return { status: 200, body: { items, storage: storageMode() } };
  },

  "POST /api/community": async (body, _query, headers) => {
    const pitch = parsePitch(body, { requirePitch: true });
    // A verified Cognito identity attributes the post; otherwise it is anonymous.
    const identity = await identityFromHeader(headers?.authorization);
    const record = await publishPitch({
      ...pitch,
      roast: body?.roast,
      scores: body?.scores,
      engine: body?.engine,
      founder: identity?.name || identity?.email || body?.founder
    });
    return { status: 201, body: record };
  }
};

/**
 * Dispatches a request. Always resolves to {status, body} — routing and handler errors
 * are converted to JSON error responses rather than propagating to the transport.
 */
export async function handleRequest({ method, path, body, query, headers }) {
  const key = `${String(method || "GET").toUpperCase()} ${path}`;
  const handler = routes[key];

  if (!handler) {
    return { status: 404, body: { error: `No route for ${key}` } };
  }

  try {
    return await handler(body, query, headers);
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status, body: { error: err.message } };
    }
    console.error("[app] unhandled error", err);
    return { status: 500, body: { error: "Internal error" } };
  }
}

export const API_ROUTES = Object.keys(routes);
