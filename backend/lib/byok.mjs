/**
 * Bring-Your-Own-Key provider bridge.
 *
 * The founder's key is stored only in their browser and sent per request over HTTPS to
 * this same-origin API. We never persist it, never log it, and never include it in an
 * error message. The server proxies the call so the browser never needs cross-origin
 * access to a provider — which several of them do not allow.
 *
 * Every function here can throw. Callers (app.mjs) catch and fall back to the
 * deterministic engine, so a bad or expired key degrades instead of breaking the demo.
 */

const PROVIDERS = {
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-5",
    url: "https://api.anthropic.com/v1/messages"
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    url: "https://api.openai.com/v1/chat/completions"
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "anthropic/claude-3.5-sonnet",
    url: "https://openrouter.ai/api/v1/chat/completions"
  }
};

export function supportedProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, defaultModel: p.defaultModel }));
}

function requireProvider(provider) {
  const key = String(provider || "").toLowerCase();
  if (!PROVIDERS[key]) throw new Error(`Unsupported provider: ${provider}`);
  return { id: key, ...PROVIDERS[key] };
}

async function postJson(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      /* provider returned a non-JSON body */
    }
    if (!res.ok) {
      // Surface the status only. The provider body can echo the key; never forward it.
      throw new Error(`provider responded ${res.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/** The instruction shared by every provider. Output is a fixed, parseable JSON shape. */
function councilPrompt(pitch, evaluation, assumptions) {
  const system =
    "You are a founder council of five: Strategist, CFO, Validator, Builder, Skeptic. " +
    "Be specific and direct, never generic. Return ONLY JSON, no prose, no markdown fences.";

  const board = (assumptions || [])
    .map((a) => `- [${a.category} · ${a.risk} risk] ${a.claim}`)
    .join("\n");

  const user = `Hypothesis: ${pitch?.name || "(unnamed)"}
Sector: ${pitch?.sector || "(unspecified)"}
Target market: ${pitch?.market || "(unspecified)"}
Pitch: ${pitch?.pitch || "(none)"}
Unit economics: ${evaluation?.economics?.note || "not supplied"}

Current assumptions:
${board || "(none)"}

Return a JSON array of exactly 5 objects, one per role in this order: Strategist, CFO, Validator, Builder, Skeptic.
Each object: {"role":"...","focus":"...","stance":"supportive|cautious|critical","headline":"one sharp sentence","critique":"2-4 sentences naming specifics from the pitch","question":"the hardest question this role would ask"}`;

  return { system, user };
}

function extractJson(text) {
  if (!text) throw new Error("empty response");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("no JSON array in response");
  return JSON.parse(candidate.slice(start, end + 1));
}

const ORDER = ["Strategist", "CFO", "Validator", "Builder", "Skeptic"];

function normaliseCouncil(raw) {
  if (!Array.isArray(raw)) throw new Error("council response was not an array");
  const byRole = new Map();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = String(item.role || "").trim();
    if (!ORDER.includes(role)) continue;
    byRole.set(role, {
      role,
      focus: String(item.focus || "").trim().slice(0, 80),
      stance: ["supportive", "cautious", "critical"].includes(item.stance) ? item.stance : "cautious",
      headline: String(item.headline || "").trim().slice(0, 240),
      critique: String(item.critique || "").trim().slice(0, 900),
      question: String(item.question || "").trim().slice(0, 300)
    });
  }
  const council = ORDER.map((role) => byRole.get(role)).filter(Boolean);
  if (council.length < 3) throw new Error("council response missing roles");
  return council;
}

/**
 * Calls the founder's chosen provider and returns a normalised council.
 * Throws on any failure — the caller decides whether to fall back.
 */
export async function councilFromProvider({ pitch, evaluation, assumptions, provider, key }) {
  const p = requireProvider(provider);
  const apiKey = String(key || "").trim();
  if (apiKey.length < 8) throw new Error("API key looks too short");

  const model = String(pitch?.model || "").trim() || p.defaultModel;
  const { system, user } = councilPrompt(pitch, evaluation, assumptions);

  let payload;
  let text;

  if (p.id === "anthropic") {
    payload = await postJson(
      p.url,
      {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      {
        model,
        max_tokens: 1600,
        temperature: 0.6,
        system,
        messages: [{ role: "user", content: user }]
      }
    );
    text = payload?.content?.map((b) => b?.text).filter(Boolean).join("\n");
  } else {
    const headers = { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
    if (p.id === "openrouter") {
      headers["http-referer"] = "https://github.com/NathnelTK";
      headers["x-title"] = "Foundry";
    }
    payload = await postJson(p.url, headers, {
      model,
      temperature: 0.6,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });
    text = payload?.choices?.[0]?.message?.content;
  }

  return { council: normaliseCouncil(extractJson(text)), engine: `byok:${p.id}`, model };
}
