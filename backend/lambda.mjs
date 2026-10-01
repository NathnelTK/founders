/**
 * Lambda handler for a Function URL (payload format 2.0).
 *
 * Only handles /api/*; the frontend is served by CloudFront from S3. Requests arrive
 * through the same router as local development, so there is one behaviour to reason about.
 */

import { handleRequest } from "./app.mjs";

const CORS = {
  "access-control-allow-origin": process.env.ALLOWED_ORIGIN || "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400"
};

function response(status, payload) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
    body: JSON.stringify(payload)
  };
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method || "GET";
  // Function URLs behind CloudFront may carry a stage-like prefix; rawPath is authoritative.
  const path = event?.rawPath || "/";

  if (method === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  let body;
  if (event?.body) {
    const text = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    try {
      body = JSON.parse(text);
    } catch {
      return response(400, { error: "Invalid JSON body" });
    }
  }

  try {
    const result = await handleRequest({
      method,
      path,
      body,
      query: event?.queryStringParameters || {},
      headers: event?.headers || {}
    });
    return response(result.status, result.body);
  } catch (err) {
    console.error("[lambda] unhandled error", err);
    return response(500, { error: "Internal error" });
  }
}
