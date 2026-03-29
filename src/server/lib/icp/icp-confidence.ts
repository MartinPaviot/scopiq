/**
 * ICP Confidence Scorer -- Data-richness-based confidence per dimension.
 *
 * Computes how confident we are in each ICP dimension based on:
 * - Customer data availability and sample size
 * - CompanyDna richness (social proof, case studies)
 * - User-provided inputs (NL description, ACV, win/loss)
 * - Manual edits (always confidence = 1.0)
 *
 * Confidence scores weight the scoring engine: low-confidence dimensions
 * penalize less for mismatches.
 */

import type { ConfidenceScores, CustomerPatterns } from "./icp-schema";

// --- Input ---

export interface ConfidenceInput {
  customerCount: number;
  customerPatterns: CustomerPatterns | null;
  socialProofCount: number;
  caseStudyCount: number;
  clientPortfolioCount: number;
  hasNlDescription: boolean;
  hasAcv: boolean;
  hasWinLoss: boolean;
  source: "onboarding" | "evolution" | "manual";
  manualOverrides?: Array<"industry" | "size" | "title" | "geo">;
}

// --- Confidence Computation ---

export function computeConfidence(input: ConfidenceInput): ConfidenceScores {
  const BASE = 0.2;
  const manualSet = new Set(input.manualOverrides ?? []);

  if (input.source === "manual" && manualSet.size === 0) {
    return { industry: 1.0, size: 1.0, title: 1.0, geo: 1.0, overall: 1.0 };
  }

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

  let title = BASE;
  if (input.socialProofCount >= 2) title += 0.15;
  if (input.clientPortfolioCount >= 5) title += 0.1;
  if (input.caseStudyCount >= 2) title += 0.1;
  if (input.hasNlDescription) title += 0.1;
  if (input.hasWinLoss) title += 0.1;
  if (input.customerCount >= 20) title += 0.15;
  else if (input.customerCount >= 5) title += 0.1;
  if (manualSet.has("title")) title = 1.0;

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

  industry = Math.min(1.0, industry);
  size = Math.min(1.0, size);
  title = Math.min(1.0, title);
  geo = Math.min(1.0, geo);

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
