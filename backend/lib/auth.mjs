/**
 * Amazon Cognito authentication.
 *
 * Sign-in happens in the browser through the Cognito Hosted UI (OAuth 2.0 / OIDC),
 * which needs no client SDK and no client secret. This module supplies the public
 * configuration the browser needs and verifies the resulting ID token server-side
 * before we attribute anything to a founder.
 *
 * Everything degrades: if the pool is not configured (local development, or the AWS
 * account is not yet active) the app runs in guest mode and the API stays usable. Auth
 * gates identity, never the demo.
 */

import { CognitoJwtVerifier } from "aws-jwt-verify";

export const AUTH_REGION = process.env.AWS_REGION || process.env.COGNITO_REGION || "us-east-1";

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || "";
const CLIENT_ID = process.env.COGNITO_CLIENT_ID || "";
const DOMAIN = (process.env.COGNITO_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

const ISSUER = USER_POOL_ID
  ? `https://cognito-idp.${AUTH_REGION}.amazonaws.com/${USER_POOL_ID}`
  : "";

/** True when a Cognito user pool is wired into this deployment. */
export function authEnabled() {
  return Boolean(USER_POOL_ID && CLIENT_ID && DOMAIN);
}

/** Public configuration for the browser. Never contains a secret. */
export function authConfig() {
  return {
    enabled: authEnabled(),
    provider: "Amazon Cognito",
    region: AUTH_REGION,
    userPoolId: USER_POOL_ID || null,
    clientId: CLIENT_ID || null,
    domain: DOMAIN || null,
    issuer: ISSUER || null,
    scopes: ["openid", "email", "profile"],
    mode: authEnabled() ? "cognito" : "guest"
  };
}

let verifier = null;

function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: USER_POOL_ID,
      tokenUse: "id",
      clientId: CLIENT_ID
    });
  }
  return verifier;
}

/**
 * Verifies a Cognito ID token: signature, issuer, audience, and expiry.
 * Returns a minimal identity, or throws. Callers treat failure as "anonymous".
 */
export async function verifyToken(token) {
  if (!authEnabled()) throw new Error("auth not configured");
  const raw = String(token || "").replace(/^Bearer\s+/i, "").trim();
  if (!raw) throw new Error("missing token");

  const payload = await getVerifier().verify(raw);

  return {
    sub: String(payload.sub || ""),
    email: String(payload.email || "").slice(0, 160),
    name: String(payload.name || payload["cognito:username"] || "").slice(0, 120),
    emailVerified: Boolean(payload.email_verified)
  };
}

/** Best-effort identity from an Authorization header; undefined when anonymous. */
export async function identityFromHeader(header) {
  if (!header) return undefined;
  try {
    return await verifyToken(header);
  } catch (err) {
    console.warn(`[auth] token rejected — ${err?.name || "Error"}: ${err?.message}`);
    return undefined;
  }
}
