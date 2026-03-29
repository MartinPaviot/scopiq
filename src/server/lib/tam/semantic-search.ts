/**
 * TAM Semantic Search — NL queries over TamAccounts.
 *
 * Architecture:
 * - Embeddings generated via Mistral Embed (mistral-embed model)
 * - Stored as JSON array on TamAccount.embedding (Json field)
 * - Search: generate query embedding, compute cosine similarity in-memory
 *
 * NOTE: This is a V1 approach using JSON storage + in-memory similarity.
 * For >10K accounts, migrate to pgvector for DB-level similarity search.
 */

import { Mistral } from "@mistralai/mistralai";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

// ─── Mistral Embed Client ───────────────────────────────

function getMistralClient(): Mistral {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY not set");
  return new Mistral({ apiKey });
}

/**
 * Generate embeddings for a batch of texts using Mistral Embed.
 * Returns array of float arrays (1024 dimensions).
 */
export async function generateEmbeddings(
  texts: string[],
): Promise<number[][]> {
  const client = getMistralClient();
  const response = await client.embeddings.create({
    model: "mistral-embed",
    inputs: texts,
  });
  return response.data.map((d) => d.embedding).filter((e): e is number[] => !!e);
}

/**
 * Build a searchable text representation of a TamAccount.
 */
function accountToText(account: {
  name: string;
  industry: string | null;
  keywords: string[];
  country: string | null;
  city: string | null;
  domain: string | null;
  scoreReasoning: string | null;
}): string {
  const parts = [account.name];
  if (account.industry) parts.push(account.industry);
  if (account.keywords.length > 0) parts.push(account.keywords.join(", "));
  if (account.country) parts.push(account.country);
  if (account.city) parts.push(account.city);
  if (account.domain) parts.push(account.domain);
  if (account.scoreReasoning) parts.push(account.scoreReasoning);
  return parts.join(" | ");
}

// ─── Embedding Generation (batch) ───────────────────────

/**
 * Generate and store embeddings for all TamAccounts in a build.
 * Processes in batches of 50 (Mistral embed limit).
 */
export async function generateAccountEmbeddings(
  tamBuildId: string,
): Promise<number> {
  const accounts = await prisma.tamAccount.findMany({
    where: { tamBuildId, embedding: { equals: Prisma.DbNull } },
    select: {
      id: true,
      name: true,
      industry: true,
      keywords: true,
      country: true,
      city: true,
      domain: true,
      scoreReasoning: true,
    },
    take: 2000,
  });

  if (accounts.length === 0) return 0;

  const BATCH_SIZE = 50;
  let embedded = 0;

  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    const batch = accounts.slice(i, i + BATCH_SIZE);
    const texts = batch.map(accountToText);

    try {
      const embeddings = await generateEmbeddings(texts);

      for (let j = 0; j < batch.length; j++) {
        await prisma.tamAccount.update({
          where: { id: batch[j].id },
          data: {
            embedding: embeddings[j] as unknown as Prisma.InputJsonValue,
          },
        });
      }

      embedded += batch.length;
    } catch (err) {
      logger.warn("[semantic-search] Embedding batch failed", {
        offset: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("[semantic-search] Embeddings generated", { tamBuildId, embedded });
  return embedded;
}

// ─── Cosine Similarity ──────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Search ─────────────────────────────────────────────

export interface SemanticSearchResult {
  accountId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  tier: string | null;
  heat: string | null;
  similarity: number;
}

/**
 * Semantic search over TamAccounts using NL query.
 *
 * 1. Generate embedding for query text
 * 2. Load all account embeddings for the workspace
 * 3. Compute cosine similarity
 * 4. Return top-N results
 */
export async function semanticSearchTam(
  workspaceId: string,
  query: string,
  topN = 20,
): Promise<SemanticSearchResult[]> {
  // Get latest build
  const latestBuild = await prisma.tamBuild.findFirst({
    where: { workspaceId, status: "complete" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (!latestBuild) return [];

  // Generate query embedding
  const [queryEmbedding] = await generateEmbeddings([query]);

  // Load accounts with embeddings
  const accounts = await prisma.tamAccount.findMany({
    where: {
      tamBuildId: latestBuild.id,
      embedding: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      name: true,
      domain: true,
      industry: true,
      tier: true,
      heat: true,
      embedding: true,
    },
  });

  if (accounts.length === 0) return [];

  // Compute similarity scores
  const scored = accounts.map((account) => ({
    accountId: account.id,
    name: account.name,
    domain: account.domain,
    industry: account.industry,
    tier: account.tier,
    heat: account.heat,
    similarity: cosineSimilarity(queryEmbedding, account.embedding as number[]),
  }));

  // Sort by similarity and return top N
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN).filter((s) => s.similarity > 0.3);
}
