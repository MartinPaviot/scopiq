/**
 * Mistral LLM Client — Simplified for Scopiq.
 *
 * Only exposes: complete(), json(), jsonRaw()
 * No chat stream, no tool loop, no phantom recovery, no email drafting.
 */

import { Mistral, HTTPClient } from "@mistralai/mistralai";
import { z } from "zod/v4";
import { logger } from "@/lib/logger";
import { logAIEvent } from "@/lib/ai-events";

// ─── Client Singleton ─────────────────────────────────────

let _client: Mistral | null = null;

/**
 * Ensure Content-Length is set on POST requests.
 * The Mistral SDK can lose the auto-computed header after
 * internal request.clone() on Node.js 22 + Windows.
 */
async function ensureContentLength(req: Request): Promise<Request | void> {
  if (req.method !== "POST" || !req.body || req.headers.has("content-length")) {
    return;
  }
  const cloned = req.clone();
  const bodyText = await cloned.text();
  const byteLength = Buffer.byteLength(bodyText, "utf-8");
  const headers = new Headers(req.headers);
  headers.set("content-length", String(byteLength));
  return new Request(req.url, {
    method: req.method,
    headers,
    body: bodyText,
  });
}

function getClient(): Mistral {
  if (!_client) {
    const httpClient = new HTTPClient();
    httpClient.addHook("beforeRequest", ensureContentLength);
    _client = new Mistral({
      apiKey: process.env.MISTRAL_API_KEY!,
      httpClient,
    });
  }
  return _client;
}

// ─── Types ────────────────────────────────────────────────

interface CompleteOptions {
  system: string;
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  workspaceId: string;
  action: string;
}

interface CompleteResult {
  text: string;
  usage: { tokensIn: number; tokensOut: number };
}

interface JsonOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  model?: string;
  temperature?: number;
  workspaceId: string;
  action: string;
}

interface JsonRawOptions {
  system: string;
  prompt: string;
  model?: string;
  temperature?: number;
  workspaceId: string;
  action: string;
}

// ─── complete — Simple non-streaming call ──────────────────

export async function complete(options: CompleteOptions): Promise<CompleteResult> {
  const client = getClient();
  const model = options.model ?? "mistral-large-latest";
  const startMs = Date.now();

  const response = await client.chat.complete({
    model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.prompt },
    ],
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens,
  });

  const latencyMs = Date.now() - startMs;
  const tokensIn = response.usage?.promptTokens ?? 0;
  const tokensOut = response.usage?.completionTokens ?? 0;

  logAIEvent({
    workspaceId: options.workspaceId,
    model,
    action: options.action,
    tokensIn,
    tokensOut,
    latencyMs,
  }).catch(() => {});

  const text =
    typeof response.choices?.[0]?.message?.content === "string"
      ? response.choices[0].message.content
      : "";

  return { text, usage: { tokensIn, tokensOut } };
}

// ─── json<T> — JSON output with Zod validation ──────────────

export async function json<T>(options: JsonOptions<T>): Promise<T> {
  const client = getClient();
  const model = options.model ?? "mistral-small-latest";
  const startMs = Date.now();

  const response = await client.chat.complete({
    model,
    messages: [
      {
        role: "system",
        content: `${options.system}\n\nJSON only, no markdown, no comments.`,
      },
      { role: "user", content: options.prompt },
    ],
    responseFormat: { type: "json_object" },
    temperature: options.temperature ?? 0.3,
  });

  const latencyMs = Date.now() - startMs;
  const tokensIn = response.usage?.promptTokens ?? 0;
  const tokensOut = response.usage?.completionTokens ?? 0;

  logAIEvent({
    workspaceId: options.workspaceId,
    model,
    action: options.action,
    tokensIn,
    tokensOut,
    latencyMs,
  }).catch(() => {});

  const raw =
    typeof response.choices?.[0]?.message?.content === "string"
      ? response.choices[0].message.content
      : "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `LLM returned invalid JSON for action "${options.action}": ${raw.slice(0, 200)}`,
    );
  }
  return options.schema.parse(parsed);
}

// ─── jsonRaw — JSON output without Zod ──────────────────────

export async function jsonRaw(options: JsonRawOptions): Promise<unknown> {
  const client = getClient();
  const model = options.model ?? "mistral-small-latest";
  const startMs = Date.now();

  const response = await client.chat.complete({
    model,
    messages: [
      {
        role: "system",
        content: `${options.system}\n\nJSON only, no markdown, no comments.`,
      },
      { role: "user", content: options.prompt },
    ],
    responseFormat: { type: "json_object" },
    temperature: options.temperature ?? 0.3,
  });

  const latencyMs = Date.now() - startMs;
  const tokensIn = response.usage?.promptTokens ?? 0;
  const tokensOut = response.usage?.completionTokens ?? 0;

  logAIEvent({
    workspaceId: options.workspaceId,
    model,
    action: options.action,
    tokensIn,
    tokensOut,
    latencyMs,
  }).catch(() => {});

  const raw =
    typeof response.choices?.[0]?.message?.content === "string"
      ? response.choices[0].message.content
      : "";

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `LLM returned invalid JSON for action "${options.action}": ${raw.slice(0, 200)}`,
    );
  }
}

// ─── Export ─────────────────────────────────────────────────

export const mistralClient = {
  complete,
  json,
  jsonRaw,
};
