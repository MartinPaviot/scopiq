/**
 * TAM Engine — Dual-Dimension Scoring (Tier + Heat).
 *
 * Tier = ICP Fit (deterministic from Apollo data vs ICP)
 * Heat = Signal intensity (from detect-signals)
 */

import type { InferredICP } from "./infer-icp";
import type { SignalResult } from "./detect-signals";
import type { NegativeIcp } from "@/server/lib/icp/icp-schema";

// ─── Types ───────────────────────────────────────────────

export type TierGrade = "A" | "B" | "C" | "D";
export type HeatLevel = "Burning" | "Hot" | "Warm" | "Cold";

export interface ScoredLead {
  /** Apollo search data */
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  country?: string;
  linkedinUrl?: string;
  /** Scoring */
  tier: TierGrade;
  tierLabel: string;
  tierReasons: string[];
  tierMatchCount: number;
  heat: HeatLevel;
  heatLabel: string;
  heatReasons: string[];
  heatSignalCount: number;
  actionPhrase: string;
  signals: SignalResult[];
  whyThisLead: string;
  numericScore: number;
}

// ─── Lead Input ──────────────────────────────────────────

export interface LeadInput {
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  country?: string;
  linkedinUrl?: string;
}

// ─── Tier Assignment (Fit) ───────────────────────────────

function computeTier(
  lead: LeadInput,
  icp: InferredICP,
  negativeIcp?: NegativeIcp | null,
): { tier: TierGrade; tierLabel: string; tierReasons: string[]; matchCount: number } {
  // Check negative ICP disqualifiers
  if (negativeIcp) {
    if (lead.title) {
      const titleLower = lead.title.toLowerCase();
      const titleDisqualified = negativeIcp.titles.some((t) =>
        titleLower.includes(t.toLowerCase()) || t.toLowerCase().includes(titleLower),
      );
      if (titleDisqualified) {
        return {
          tier: "D",
          tierLabel: "Disqualified",
          tierReasons: [`Title "${lead.title}" is in negative ICP`],
          matchCount: 0,
        };
      }
    }
    if (lead.industry) {
      const indLower = lead.industry.toLowerCase();
      const indDisqualified = negativeIcp.industries.some((i) =>
        indLower.includes(i.toLowerCase()) || i.toLowerCase().includes(indLower),
      );
      if (indDisqualified) {
        return {
          tier: "D",
          tierLabel: "Disqualified",
          tierReasons: [`Industry "${lead.industry}" is in negative ICP`],
          matchCount: 0,
        };
      }
    }
  }

  const reasons: string[] = [];
  let matches = 0;

  // 1. Title match
  const titleMatch = checkTitleMatch(lead.title, icp);
  if (titleMatch) {
    matches++;
    reasons.push(`Title "${lead.title}" matches ICP role`);
  } else if (lead.title) {
    reasons.push(`Title "${lead.title}" doesn't match ICP roles`);
  }

  // 2. Company size match
  const sizeMatch = checkSizeMatch(lead.employeeCount, icp);
  if (sizeMatch) {
    matches++;
    reasons.push(`Company size ${lead.employeeCount} fits range ${icp.companies.employeeRange.min}-${icp.companies.employeeRange.max}`);
  } else if (lead.employeeCount) {
    reasons.push(`Company size ${lead.employeeCount} outside ICP range`);
  }

  // 3. Industry match
  const industryMatch = checkIndustryMatch(lead.industry, icp);
  if (industryMatch) {
    matches++;
    reasons.push(`Industry "${lead.industry}" matches ICP`);
  } else if (lead.industry) {
    reasons.push(`Industry "${lead.industry}" not in ICP industries`);
  }

  // 4. Geography match
  const geoMatch = checkGeoMatch(lead.country, icp);
  if (geoMatch) {
    matches++;
    reasons.push(`Location "${lead.country}" matches ICP geography`);
  } else if (lead.country) {
    reasons.push(`Location "${lead.country}" not in ICP geography`);
  }

  const tier = matchCountToTier(matches);
  const tierLabel = TIER_LABELS[tier];

  return { tier, tierLabel, tierReasons: reasons, matchCount: matches };
}

function matchCountToTier(matches: number): TierGrade {
  if (matches >= 4) return "A";
  if (matches >= 3) return "B";
  if (matches >= 2) return "C";
  return "D";
}

const TIER_LABELS: Record<TierGrade, string> = {
  A: "Perfect Fit",
  B: "Strong Fit",
  C: "Moderate Fit",
  D: "Weak Fit",
};

// ─── Heat Assignment (Weighted Signals) ─────────────────

/** Signal weights: relational signals > intent signals > base signals */
const SIGNAL_WEIGHTS: Record<string, number> = {
  "Common Investor": 1.5,
  "LinkedIn Connection": 2,
  "Recent Funding": 1.5,
  "Hiring Outbound": 1,
  "Sales-Led Growth": 1,
  "Tech Stack Fit": 1,
  "New in Role": 1,
};

function computeHeat(
  signals: SignalResult[],
): { heat: HeatLevel; heatLabel: string; heatReasons: string[]; signalCount: number } {
  const detected = signals.filter((s) => s.detected);
  const reasons = detected.map((s) => s.evidence || s.name);

  // Weighted heat score
  const weightedScore = detected.reduce((sum, s) => {
    return sum + (SIGNAL_WEIGHTS[s.name] ?? 1);
  }, 0);

  const heat = weightedScoreToHeat(weightedScore);
  const heatLabel = HEAT_LABELS[heat];

  return { heat, heatLabel, heatReasons: reasons, signalCount: detected.length };
}

function weightedScoreToHeat(score: number): HeatLevel {
  if (score >= 5) return "Burning";
  if (score >= 3) return "Hot";
  if (score >= 1.5) return "Warm";
  return "Cold";
}

const HEAT_LABELS: Record<HeatLevel, string> = {
  Burning: "Great Signals",
  Hot: "Good Signals",
  Warm: "Some Signals",
  Cold: "No Signals",
};

// ─── Action Phrases (4×4 matrix) ─────────────────────────

const ACTION_MATRIX: Record<TierGrade, Record<HeatLevel, string>> = {
  A: {
    Burning: "Stellar account — take action immediately",
    Hot: "Strong account — prioritize this week",
    Warm: "Great fit — worth reaching out",
    Cold: "Perfect fit but no signals yet — monitor",
  },
  B: {
    Burning: "Good fit with great signals — prioritize",
    Hot: "Solid opportunity — add to sequence",
    Warm: "Decent match — include in campaign",
    Cold: "Good fit, needs warming — nurture",
  },
  C: {
    Burning: "Hot signals but moderate fit — test carefully",
    Hot: "Some potential — lower priority",
    Warm: "Marginal match — batch outreach only",
    Cold: "Low priority — skip for now",
  },
  D: {
    Burning: "Signals are hot but fit is weak — risky bet",
    Hot: "Weak fit — only if capacity allows",
    Warm: "Poor match — skip",
    Cold: "No fit, no signals — skip",
  },
};

// ─── Numeric Score ───────────────────────────────────────

const TIER_SCORES: Record<TierGrade, number> = { A: 10, B: 8, C: 5, D: 2 };
const HEAT_SCORES: Record<HeatLevel, number> = { Burning: 10, Hot: 7, Warm: 4, Cold: 1 };

function computeNumericScore(tier: TierGrade, heat: HeatLevel): number {
  // Weighted: Tier 60%, Heat 40%
  return Math.round(TIER_SCORES[tier] * 0.6 + HEAT_SCORES[heat] * 0.4);
}

// ─── Why This Lead ───────────────────────────────────────

function buildWhyThisLead(
  lead: LeadInput,
  tier: TierGrade,
  heat: HeatLevel,
  signals: SignalResult[],
): string {
  const detectedSignals = signals.filter((s) => s.detected);
  const parts: string[] = [];

  parts.push(`${lead.firstName ?? ""} ${lead.lastName ?? ""} is ${lead.title ?? "unknown role"} at ${lead.company ?? "unknown company"}.`);

  if (tier === "A" || tier === "B") {
    parts.push(`Their profile is a ${TIER_LABELS[tier].toLowerCase()} for your ICP.`);
  } else {
    parts.push(`Their profile is a ${TIER_LABELS[tier].toLowerCase()} — some criteria don't match.`);
  }

  if (detectedSignals.length > 0) {
    parts.push(`Key signals: ${detectedSignals.map((s) => s.evidence || s.name).join("; ")}.`);
  }

  return parts.join(" ");
}

// ─── Match Helpers ───────────────────────────────────────

function checkTitleMatch(title: string | undefined, icp: InferredICP): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return icp.roles.some((role) => {
    const allTitles = [role.title, ...role.variations];
    return allTitles.some((t) => {
      const tLower = t.toLowerCase();
      return lower.includes(tLower) || tLower.includes(lower);
    });
  });
}

function checkSizeMatch(count: number | undefined, icp: InferredICP): boolean {
  if (!count) return false;
  const { min, max } = icp.companies.employeeRange;
  return count >= min && count <= max;
}

function checkIndustryMatch(industry: string | undefined, icp: InferredICP): boolean {
  if (!industry) return false;
  const lower = industry.toLowerCase();
  return icp.companies.industries.some((ind) => {
    const indLower = ind.toLowerCase();
    return lower.includes(indLower) || indLower.includes(lower);
  });
}

function checkGeoMatch(country: string | undefined, icp: InferredICP): boolean {
  if (!country) return false;
  if (icp.companies.geography.length === 0) return true; // No geo constraint
  const lower = country.toLowerCase();
  return icp.companies.geography.some((g) => {
    const gLower = g.toLowerCase();
    return lower.includes(gLower) || gLower.includes(lower);
  });
}

// ─── Main Scoring Function ───────────────────────────────

export function scoreLead(
  lead: LeadInput,
  icp: InferredICP,
  signals: SignalResult[],
  negativeIcp?: NegativeIcp | null,
): ScoredLead {
  const { tier, tierLabel, tierReasons, matchCount } = computeTier(lead, icp, negativeIcp);
  const { heat, heatLabel, heatReasons, signalCount } = computeHeat(signals);
  const actionPhrase = ACTION_MATRIX[tier][heat];
  const numericScore = computeNumericScore(tier, heat);
  const whyThisLead = buildWhyThisLead(lead, tier, heat, signals);

  return {
    ...lead,
    tier,
    tierLabel,
    tierReasons,
    tierMatchCount: matchCount,
    heat,
    heatLabel,
    heatReasons,
    heatSignalCount: signalCount,
    actionPhrase,
    signals,
    whyThisLead,
    numericScore,
  };
}

/**
 * Score multiple leads against an ICP with their detected signals.
 */
export function scoreLeads(
  leads: Array<{ lead: LeadInput; signals: SignalResult[] }>,
  icp: InferredICP,
  negativeIcp?: NegativeIcp | null,
): ScoredLead[] {
  return leads
    .map(({ lead, signals }) => scoreLead(lead, icp, signals, negativeIcp))
    .sort((a, b) => {
      // Sort: Tier ASC (A < B < C < D), Heat DESC (Burning > Hot > Warm > Cold)
      const tierOrder = { A: 0, B: 1, C: 2, D: 3 };
      const heatOrder = { Burning: 0, Hot: 1, Warm: 2, Cold: 3 };
      const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
      if (tierDiff !== 0) return tierDiff;
      return heatOrder[a.heat] - heatOrder[b.heat];
    });
}
