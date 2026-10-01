/**
 * Persistence for published community pitches.
 *
 * DynamoDB when TABLE_NAME is set and reachable; otherwise an in-process Map so the
 * app is fully usable locally and during the window before the AWS account is active.
 * The fallback is intentionally ephemeral — it is a dev convenience, not a database.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";

import { randomUUID } from "node:crypto";

const TABLE_NAME = process.env.TABLE_NAME || "";
const REGION = process.env.AWS_REGION || "us-east-1";

/** Single partition keeps the board queryable in created-at order for a small dataset. */
const BOARD_PK = "BOARD";

const memory = new Map();
let doc;
let dynamoBroken = false;

function getDoc() {
  if (!doc) {
    doc = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: REGION, maxAttempts: 3 }),
      { marshallOptions: { removeUndefinedValues: true } }
    );
  }
  return doc;
}

function usingDynamo() {
  return Boolean(TABLE_NAME) && !dynamoBroken;
}

export function storageMode() {
  return usingDynamo() ? `dynamodb:${TABLE_NAME}` : "memory";
}

/** Strips a full evaluation down to what the public board should expose. */
function toPublicRecord(input) {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    name: String(input.name || "Unnamed concept").slice(0, 120),
    sector: String(input.sector || "").slice(0, 80),
    market: String(input.market || "").slice(0, 120),
    pitch: String(input.pitch || "").slice(0, 1200),
    roast: String(input.roast || "").slice(0, 600),
    scores: {
      global: Number(input.scores?.global) || 0,
      investability: Number(input.scores?.investability) || 0
    },
    engine: String(input.engine || "unknown"),
    founder: String(input.founder || "Anonymous founder").slice(0, 80)
  };
}

export async function publishPitch(input) {
  const record = toPublicRecord(input);

  if (usingDynamo()) {
    try {
      await getDoc().send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { pk: BOARD_PK, sk: `${record.createdAt}#${record.id}`, ...record }
        })
      );
      return record;
    } catch (err) {
      console.warn(`[store] DynamoDB put failed, using memory — ${err?.name}: ${err?.message}`);
      dynamoBroken = true;
    }
  }

  memory.set(record.id, record);
  return record;
}

export async function listPitches(limit = 50) {
  const capped = Math.max(1, Math.min(100, Number(limit) || 50));

  if (usingDynamo()) {
    try {
      const out = await getDoc().send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": BOARD_PK },
          ScanIndexForward: false, // newest first
          Limit: capped
        })
      );
      return (out.Items || []).map(({ pk, sk, ...rest }) => rest);
    } catch (err) {
      console.warn(`[store] DynamoDB query failed, using memory — ${err?.name}: ${err?.message}`);
      dynamoBroken = true;
    }
  }

  return [...memory.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, capped);
}

export async function deletePitch(id, createdAt) {
  if (usingDynamo() && createdAt) {
    try {
      await getDoc().send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: BOARD_PK, sk: `${createdAt}#${id}` }
        })
      );
      return true;
    } catch (err) {
      console.warn(`[store] DynamoDB delete failed — ${err?.name}: ${err?.message}`);
      dynamoBroken = true;
    }
  }

  return memory.delete(id);
}
