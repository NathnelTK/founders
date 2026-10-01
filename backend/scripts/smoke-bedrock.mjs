/**
 * Bedrock connectivity smoke test.
 *
 * Run: npm run smoke:bedrock
 *
 * Reports whether this AWS account can actually invoke the configured Claude model,
 * and writes the result to hackathon-evidence/ as proof of the agent-to-AWS connection.
 * Exits 0 even on failure — an inaccessible model is a documented state, not a crash.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { probeBedrock, MODEL_ID, REGION } from "../lib/bedrock.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EVIDENCE_DIR = resolve(HERE, "..", "..", "hackathon-evidence");

const result = await probeBedrock();

const report = {
  capturedAt: new Date().toISOString(),
  agent: "Claude Code (Anthropic) — claude-opus-5",
  check: "Amazon Bedrock Converse — model invocation",
  region: REGION,
  modelId: MODEL_ID,
  ...result
};

console.log("\n  Bedrock smoke test");
console.log(`  Region : ${REGION}`);
console.log(`  Model  : ${MODEL_ID}`);

if (result.ok) {
  console.log(`  Status : OK — model replied ${JSON.stringify(result.reply)}`);
  if (result.usage) {
    console.log(`  Tokens : ${result.usage.inputTokens} in, ${result.usage.outputTokens} out`);
  }
} else {
  console.log(`  Status : UNAVAILABLE — ${result.error || "error"}`);
  console.log(`  Reason : ${result.reason}`);
  console.log(`  The app falls back to the local heuristics engine, so it still ships.`);
}

await mkdir(EVIDENCE_DIR, { recursive: true });
const out = resolve(EVIDENCE_DIR, "06-bedrock-invoke-claude.json");
await writeFile(out, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`\n  Evidence written: ${out}\n`);
