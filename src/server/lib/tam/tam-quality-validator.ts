/**
 * TAM Quality Validator — Post-build sanity check via LLM.
 *
 * After the TAM is built and scored, this function validates
 * that the results make sense. It catches:
 * - Wrong-size companies in Tier A
 * - Irrelevant industries
 * - Anomalous distributions
 * - Missing or overrepresented segments
 *
 * Returns a quality report with scores and actionable issues.
 */

import { mistralClient } from "@/server/lib/llm/mistral-client";
import { z } from "zod/v4";
import { logger } from "@/lib/logger";

// ─── Types ──────────────────────────────────────────────

const qualityReportSchema = z.object({
  overall_score: z.number().min(0).max(10),
  scores: z.object({
    tam_size: z.object({ score: z.number(), comment: z.string() }),
    tier_a_relevance: z.object({ score: z.number(), comment: z.string() }),
    distribution: z.object({ score: z.number(), comment: z.string() }),
    industry_coherence: z.object({ score: z.number(), comment: z.string() }),
    anomalies: z.object({ score: z.number(), comment: z.string() }),
  }),
  issues: z.array(z.object({
    severity: z.enum(["high", "medium", "low"]),
    description: z.string(),
  })).default([]),
  suggestions: z.array(z.string()).default([]),
});

export type QualityReport = z.infer<typeof qualityReportSchema>;

// ─── System Prompt ──────────────────────────────────────

const VALIDATE_SYSTEM = `You are an expert in sales intelligence and TAM analysis. You just built a TAM (Total Addressable Market) for a company. Verify that the results are coherent.

Evaluate on 5 criteria (score 1-10 each):

1. TAM SIZE: Is the total number realistic for this product?
   Niche tool → 2K-20K accounts. Horizontal tool → 20K-200K accounts.
   >500K = probably too broad. <500 = probably too narrow.

2. TIER A RELEVANCE: Are the top 10 Tier A plausible customers?
   A Tier A for Lemlist should be a SaaS startup of 50 people, not Microsoft.
   A Tier A for Salesforce should be a 500+ company, not a freelancer.

3. DISTRIBUTION: Is the Tier A/B/C/D distribution healthy?
   Ideal: A=5-15%, B=15-30%, C=30-40%, D=20-30%
   A>30% = scoring too lax. A<2% = scoring too strict.

4. INDUSTRY COHERENCE: Do the dominant industries match the product?

5. ANOMALIES: Any obvious aberrations?
   Restaurants in a SaaS TAM? 50K employee companies in an SMB TAM?

Return ONLY valid JSON:
{
  "overall_score": 7.5,
  "scores": {
    "tam_size": { "score": 8, "comment": "..." },
    "tier_a_relevance": { "score": 7, "comment": "..." },
    "distribution": { "score": 9, "comment": "..." },
    "industry_coherence": { "score": 8, "comment": "..." },
    "anomalies": { "score": 6, "comment": "..." }
  },
  "issues": [
    { "severity": "medium", "description": "..." }
  ],
  "suggestions": ["..."]
}`;

// ─── Main Function ──────────────────────────────────────

export interface ValidationInput {
  siteUrl: string;
  productSummary: string;
  icpSummary: string;
  totalAccounts: number;
  tierCounts: { A: number; B: number; C: number; D: number };
  topTierA: Array<{ name: string; industry: string | null; employeeCount: number | null }>;
  industryBreakdown: Array<{ name: string; count: number }>;
  sizeBreakdown: { under50: number; from50to200: number; from200to1000: number; over1000: number };
  geoBreakdown: Array<{ name: string; count: number }>;
}

export async function validateTamQuality(
  input: ValidationInput,
  workspaceId: string,
): Promise<QualityReport> {
  const totalPct = input.totalAccounts || 1;
  const tierPcts = {
    A: Math.round((input.tierCounts.A / totalPct) * 100),
    B: Math.round((input.tierCounts.B / totalPct) * 100),
    C: Math.round((input.tierCounts.C / totalPct) * 100),
    D: Math.round((input.tierCounts.D / totalPct) * 100),
  };

  const prompt = `Company: ${input.siteUrl}
Product: ${input.productSummary}
ICP: ${input.icpSummary}

TAM Results:
  Total accounts: ${input.totalAccounts}
  Tier A: ${input.tierCounts.A} (${tierPcts.A}%)
  Tier B: ${input.tierCounts.B} (${tierPcts.B}%)
  Tier C: ${input.tierCounts.C} (${tierPcts.C}%)
  Tier D: ${input.tierCounts.D} (${tierPcts.D}%)

Top 10 Tier A:
${input.topTierA.slice(0, 10).map((a, i) => `  ${i + 1}. ${a.name} — ${a.industry ?? "unknown"} — ${a.employeeCount?.toLocaleString() ?? "?"} employees`).join("\n")}

Industry distribution:
${input.industryBreakdown.slice(0, 8).map((i) => `  ${i.name}: ${i.count}`).join("\n")}

Size distribution:
  <50: ${input.sizeBreakdown.under50}
  50-200: ${input.sizeBreakdown.from50to200}
  200-1000: ${input.sizeBreakdown.from200to1000}
  >1000: ${input.sizeBreakdown.over1000}

Geo distribution:
${input.geoBreakdown.slice(0, 5).map((g) => `  ${g.name}: ${g.count}`).join("\n")}`;

  try {
    const report = await mistralClient.json<QualityReport>({
      model: "mistral-small-latest",
      system: VALIDATE_SYSTEM,
      prompt,
      schema: qualityReportSchema,
      workspaceId,
      action: "tam-quality-validation",
      temperature: 0.2,
    });

    logger.info("[tam/quality] Validation complete", {
      siteUrl: input.siteUrl,
      overallScore: report.overall_score,
      issues: report.issues.length,
    });

    return report;
  } catch (err) {
    logger.error("[tam/quality] Validation failed", {
      error: err instanceof Error ? err.message : String(err),
    });

    // Return a neutral report on failure — don't block the build
    return {
      overall_score: 5,
      scores: {
        tam_size: { score: 5, comment: "Validation skipped — LLM call failed" },
        tier_a_relevance: { score: 5, comment: "Not validated" },
        distribution: { score: 5, comment: "Not validated" },
        industry_coherence: { score: 5, comment: "Not validated" },
        anomalies: { score: 5, comment: "Not validated" },
      },
      issues: [{ severity: "low", description: "Quality validation could not complete — results not verified" }],
      suggestions: [],
    };
  }
}
