/**
 * Foundry authentication.
 *
 * Real sign-in uses the Amazon Cognito Hosted UI over OAuth 2.0 (implicit flow), so the
 * browser needs no SDK and the client holds no secret. The ID token is kept in
 * localStorage and sent as a Bearer token; the API verifies it against the user pool's
 * JWKS before attributing anything to the founder.
 *
 * If the deployment has no Cognito pool (local development, or an AWS account that is not
 * yet active), this module drops into guest mode. Guest mode is local-only and clearly
 * labelled. Authentication personalises the workspace; it never blocks the product.
 */

const SESSION_KEY = "foundry.session.v1";
const CONFIG_TIMEOUT_MS = 6000;

let config = { enabled: false, mode: "guest", provider: "Amazon Cognito" };
let session = null;
const listeners = new Set();

/* ── Storage ─────────────────────────────────────────────────────────────── */

function loadStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (raw && typeof raw === "object" && raw.mode) return raw;
  } catch {
    /* corrupt or unavailable storage — treat as signed out */
  }
  return null;
}

function store(next) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage disabled — session is best-effort */
  }
  emit();
}

/* ── JWT (display only) ──────────────────────────────────────────────────── */

/**
 * Reads claims for display. This is NOT verification — the server verifies the token
 * before trusting it. Never gate privileged behaviour on this function.
 */
function decodeClaims(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return {};
    const json = decodeURIComponent(
      atob(part.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/* ── Hosted UI ───────────────────────────────────────────────────────────── */

function redirectUri() {
  return `${window.location.origin}/`;
}

function baseUrl() {
  return `https://${config.domain}`;
}

/** Reads tokens returned in the URL fragment by the Hosted UI, then cleans the URL. */
function consumeRedirect() {
  if (!config.enabled) return false;
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  if (!hash) return false;

  const params = new URLSearchParams(hash);
  const idToken = params.get("id_token");
  if (!idToken) return false;

  const claims = decodeClaims(idToken);
  const expiresIn = Number(params.get("expires_in")) || 3600;

  store({
    mode: "cognito",
    name: claims.name || claims.email || "Founder",
    email: claims.email || "",
    sub: claims.sub || "",
    idToken,
    expiresAt: Date.now() + expiresIn * 1000
  });

  // Remove the fragment so a refresh does not replay it.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return true;
}

/* ── Config ──────────────────────────────────────────────────────────────── */

async function fetchConfig() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
  try {
    const res = await fetch("/api/auth/config", { signal: controller.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (data && typeof data === "object") return { ...config, ...data };
  } catch {
    /* offline or API unreachable — stay in guest mode */
  } finally {
    clearTimeout(timer);
  }
  return { ...config, enabled: false, mode: "guest" };
}

function emit() {
  const state = getState();
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      /* a listener must not break auth */
    }
  }
}

/* ── Public API ──────────────────────────────────────────────────────────── */

export function getState() {
  const signedIn = Boolean(session);
  return {
    configured: config.enabled,
    provider: config.provider || "Amazon Cognito",
    mode: signedIn ? session.mode : "guest",
    signedIn,
    user: session ? { name: session.name, email: session.email, sub: session.sub } : null
  };
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function init() {
  config = await fetchConfig();
  session = loadStored();
  consumeRedirect();

  // An expired Cognito token must not be presented to the API.
  if (session?.mode === "cognito" && session.expiresAt && Date.now() >= session.expiresAt) {
    store(null);
  }
  emit();
  return getState();
}

/** Starts sign-in. Returns "redirect" when it navigated, "guest" when guest mode is needed. */
export function signIn() {
  if (config.enabled) {
    const url = new URL(`${baseUrl()}/oauth2/authorize`);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("response_type", "token");
    url.searchParams.set("scope", (config.scopes || ["openid", "email", "profile"]).join(" "));
    url.searchParams.set("redirect_uri", redirectUri());
    window.location.assign(url.toString());
    return "redirect";
  }
  return "guest";
}

/** Records a local guest identity. No password, no server, nothing leaves the browser. */
export function signInAsGuest(name, email) {
  const cleanName = String(name || "").trim().slice(0, 80) || "Guest founder";
  const cleanEmail = String(email || "").trim().slice(0, 160);
  store({ mode: "guest", name: cleanName, email: cleanEmail, sub: "", idToken: null, expiresAt: null });
  return getState();
}

export function signOut() {
  const wasCognito = session?.mode === "cognito";
  store(null);
  if (wasCognito && config.enabled) {
    const url = new URL(`${baseUrl()}/logout`);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("logout_uri", redirectUri());
    window.location.assign(url.toString());
    return "redirect";
  }
  return "local";
}

/** Headers to attach to API calls. Empty object when signed out. */
export function authHeader() {
  if (session?.mode === "cognito" && session.idToken) {
    return { authorization: `Bearer ${session.idToken}` };
  }
  return {};
}

export function displayName() {
  return session?.name || null;
}
