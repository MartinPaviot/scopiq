import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// ─── Mistral Pricing (per 1M tokens, USD) ─────────────────

const MISTRAL_PRICING: Record<string, { input: number; output: number }> = {
  "mistral-large-latest": { input: 2.0, output: 6.0 },
  "mistral-small-latest": { input: 0.1, output: 0.3 },
};

export function calculateCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const pricing = MISTRAL_PRICING[model];
  if (!pricing) return 0;
  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
}

// ─── AI Event Logger ──────────────────────────────────────

export async function logAIEvent(params: {
  workspaceId: string;
  model: string;
  action: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const cost = calculateCost(params.model, params.tokensIn, params.tokensOut);

  await prisma.aIEvent.create({
    data: {
      workspaceId: params.workspaceId,
      provider: "mistral",
      model: params.model,
      action: params.action,
      tokensIn: params.tokensIn,
      tokensOut: params.tokensOut,
      cost,
      latencyMs: params.latencyMs,
      metadata: (params.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
