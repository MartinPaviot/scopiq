/**
 * ICP Confidence Scorer — Data-richness-based confidence per dimension.
 *
 * Computes how confident we are in each ICP dimension based on:
 * - Customer data availability and sample size
 * - CompanyDna richness (social proof, case studies)
 * - User-provided inputs (NL description, ACV, win/loss)
 * - Manual edits (always confidence = 1.0)
 *
 * Confidence scores weight the scoring engine: low-confidence dimensions
 * penalize less for mismatches (don't punish accounts when the ICP itself is uncertain).
 */

import type { ConfidenceScores, CustomerPatterns } from "./icp-schema";

// ─── Input ─────────────────────────────────────────────

export interface ConfidenceInput {
  /** Number of imported customers */
  customerCount: number;
  /** Customer pattern analysis (if available) */
  customerPatterns: CustomerPatterns | null;
  /** CompanyDna social proof entries */
  socialProofCount: number;
  /** CompanyDna case studies */
  caseStudyCount: number;
  /** CompanyDna client portfolio size */
  clientPortfolioCount: number;
  /** User provided NL description */
  hasNlDescription: boolean;
  /** User provided ACV */
  hasAcv: boolean;
  /** User provided win/loss reasons */
  hasWinLoss: boolean;
  /** ICP source — "manual" means user explicitly set values */
  source: "onboarding" | "evolution" | "manual";
  /** Which dimensions the user manually edited (override to 1.0) */
  manualOverrides?: Array<"industry" | "size" | "title" | "geo">;
}

// ─── Confidence Computation ────────────────────────────

/**
 * Compute confidence scores for each ICP dimension.
 *
 * Each dimension starts at a base (0.2) and accumulates bonuses:
 * - Customer data (N≥30): +0.4 for that dimension
 * - Customer data (N≥10): +0.25 for that dimension
 * - Customer data (N≥5): +0.15 for that dimension
 * - CompanyDna social proof: +0.15
 * - CompanyDna case studies: +0.1
 * - NL description: +0.1
 * - ACV: +0.05 (for size dimension specifically)
 * - Win/loss reasons: +0.05
 * - Manual edit: override to 1.0
 */
export function computeConfidence(input: ConfidenceInput): ConfidenceScores {
  const BASE = 0.2;
  const manualSet = new Set(input.manualOverrides ?? []);

  // If source is "manual", everything the user touched is 1.0
  if (input.source === "manual" && manualSet.size === 0) {
    return { industry: 1.0, size: 1.0, title: 1.0, geo: 1.0, overall: 1.0 };
  }

  // ── Industry confidence ──
  let industry = BASE;
  if (input.customerPatterns) {
    const indCount = input.customerPatterns.industryDist
      .reduce((sum, d) => sum + d.count, 0);
    if (indCount >= 30) industry += 0.4;
    else if (indCount >= 10) industry += 0.25;
    else if (indCount >= 5) industry += 0.15;
  }
  if (input.socialProofCount >= 3) industry += 0.15;
  else if (input.socialProofCount >= 1) industry += 0.1;
  if (input.caseStudyCount >= 2) industry += 0.1;
  if (input.hasNlDescription) industry += 0.1;
  if (manualSet.has("industry")) industry = 1.0;

  // ── Size confidence ──
  let size = BASE;
  if (input.customerPatterns) {
    const sizeCount = input.customerPatterns.sizeDist
      .reduce((sum, d) => sum + d.count, 0);
    if (sizeCount >= 30) size += 0.4;
    else if (sizeCount >= 10) size += 0.25;
    else if (sizeCount >= 5) size += 0.15;
  }
  if (input.socialProofCount >= 2) size += 0.1;
  if (input.hasAcv) size += 0.1;
  if (input.hasNlDescription) size += 0.05;
  if (manualSet.has("size")) size = 1.0;

  // ── Title confidence ──
  let title = BASE;
  // Titles are primarily inferred from CompanyDna targetBuyers, not customers
  if (input.socialProofCount >= 2) title += 0.15;
  if (input.clientPortfolioCount >= 5) title += 0.1;
  if (input.caseStudyCount >= 2) title += 0.1;
  if (input.hasNlDescription) title += 0.1;
  if (input.hasWinLoss) title += 0.1;
  // Customer data gives a small title boost (buyer persona patterns)
  if (input.customerCount >= 20) title += 0.15;
  else if (input.customerCount >= 5) title += 0.1;
  if (manualSet.has("title")) title = 1.0;

  // ── Geography confidence ──
  let geo = BASE;
  if (input.customerPatterns) {
    const geoCount = input.customerPatterns.geoDist
      .reduce((sum, d) => sum + d.count, 0);
    if (geoCount >= 30) geo += 0.4;
    else if (geoCount >= 10) geo += 0.25;
    else if (geoCount >= 5) geo += 0.15;
  }
  if (input.socialProofCount >= 2) geo += 0.1;
  if (input.hasNlDescription) geo += 0.05;
  if (manualSet.has("geo")) geo = 1.0;

  // Clamp to [0, 1]
  industry = Math.min(1.0, industry);
  size = Math.min(1.0, size);
  title = Math.min(1.0, title);
  geo = Math.min(1.0, geo);

  // Overall = weighted average (industry and size matter most for outbound)
  const overall = Math.min(
    1.0,
    industry * 0.3 + size * 0.25 + title * 0.25 + geo * 0.2,
  );

  return {
    industry: round2(industry),
    size: round2(size),
    title: round2(title),
    geo: round2(geo),
    overall: round2(overall),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
