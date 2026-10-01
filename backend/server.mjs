/**
 * Local development server.
 *
 * Serves the static frontend and proxies /api/* into the shared router, so `npm start`
 * reproduces the deployed behaviour without any AWS resources. Not used in production —
 * CloudFront + S3 serve the frontend and Lambda serves the API.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { handleRequest, API_ROUTES } from "./app.mjs";
import { MODEL_ID, REGION, bedrockDisabled } from "./lib/bedrock.mjs";
import { storageMode } from "./lib/store.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..", "frontend");
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 256 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function sendJson(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store"
  });
  res.end(data);
}

/** Reads the body with a hard cap so a large upload cannot exhaust memory. */
function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Resolves a URL path to a file inside FRONTEND_DIR.
 * Returns null for anything that escapes the directory — path traversal guard.
 */
function safeStaticPath(urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const full = resolve(join(FRONTEND_DIR, rel));
  if (full !== FRONTEND_DIR && !full.startsWith(FRONTEND_DIR + sep)) return null;
  return full;
}

async function serveStatic(res, urlPath) {
  const candidate = safeStaticPath(urlPath === "/" ? "index.html" : urlPath);

  if (!candidate) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  let target = candidate;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, "index.html");
  } catch {
    // Unknown path: fall back to the SPA entry point.
    target = join(FRONTEND_DIR, "index.html");
  }

  try {
    const data = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
      "content-length": data.length,
      "cache-control": "no-store"
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    res.end();
    return;
  }

  if (!url.pathname.startsWith("/api/")) {
    await serveStatic(res, url.pathname);
    return;
  }

  let body;
  if (req.method === "POST") {
    let text;
    try {
      text = await readBody(req);
    } catch (err) {
      sendJson(res, 413, { error: err.message });
      return;
    }
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }
    }
  }

  const started = Date.now();
  const result = await handleRequest({
    method: req.method,
    path: url.pathname,
    body,
    query: Object.fromEntries(url.searchParams),
    headers: req.headers
  });

  res.setHeader("access-control-allow-origin", "*");
  sendJson(res, result.status, result.body);
  console.log(`${req.method} ${url.pathname} ${result.status} ${Date.now() - started}ms`);
});

server.listen(PORT, () => {
  console.log(`\n  Founder Arena — local dev server`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Engine   : ${bedrockDisabled() ? "heuristics (Bedrock disabled)" : `Bedrock ${MODEL_ID}`}`);
  console.log(`  Region   : ${REGION}`);
  console.log(`  Storage  : ${storageMode()}`);
  console.log(`  Routes   : ${API_ROUTES.length} API routes\n`);
});
