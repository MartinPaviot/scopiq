/**
 * TAM Account Scorer -- Multidimensional scoring engine.
 *
 * 5-dimension scoring system:
 *   1. Industry Fit (0-25)
 *   2. Size Fit (0-25)
 *   3. Keyword Fit (0-20)
 *   4. Signal Score (0-20)
 *   5. Data Freshness (0-10)
 *
 * Total: 0-100 -> Tier A/B/C/D + Heat Burning/Hot/Warm/Cold
 */

import type { TamICP } from "./tam-icp-inferrer";

// --- Types ---

export interface AccountData {
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  foundedYear: number | null;
  keywords: string[];
  websiteUrl: string | null;
  linkedinUrl: string | null;
  city: string | null;
  country: string | null;
}

export interface ScoreSignal {
  signal: string;
  value: string;
  source: string;
  weight: number;
  category: "fit" | "signal" | "data";
}

export interface ScoringResult {
  tier: "A" | "B" | "C" | "D";
  heat: "Burning" | "Hot" | "Warm" | "Cold";
  heatScore: number;
  breakdown: {
    industryFit: number;
    sizeFit: number;
    keywordFit: number;
    signalScore: number;
    freshness: number;
  };
  industryMatch: boolean;
  sizeMatch: boolean;
  keywordMatch: boolean;
  reasoning: string;
  scoreSignals: ScoreSignal[];
}

// --- Industry Relatedness ---

const RELATED_GROUPS: string[][] = [
  ["saas", "software", "technology", "internet", "information technology", "computer software", "it services"],
  ["fintech", "financial services", "banking", "payments", "insurance", "accounting"],
  ["marketing", "advertising", "digital marketing", "marketing and advertising", "media"],
  ["e-commerce", "retail", "consumer goods", "marketplace", "online retail"],
  ["healthcare", "health", "medical", "biotech", "pharmaceutical", "health care"],
  ["education", "edtech", "e-learning", "training", "higher education"],
  ["real estate", "property", "construction", "architecture"],
  ["consulting", "professional services", "management consulting", "staffing"],
  ["hr", "human resources", "recruiting", "staffing", "talent", "human capital"],
  ["logistics", "supply chain", "transportation", "shipping", "warehousing"],
  ["artificial intelligence", "machine learning", "ai", "deep learning", "data science"],
  ["cybersecurity", "security", "information security", "network security"],
  ["telecommunications", "telecom", "wireless", "networking"],
  ["automotive", "electric vehicles", "ev", "mobility"],
  ["food", "food and beverage", "restaurant", "hospitality"],
];

function areRelatedIndustries(accountIndustry: string, icpIndustries: string[]): boolean {
  const lower = accountIndustry.toLowerCase();
  for (const group of RELATED_GROUPS) {
    const industryInGroup = group.some((g) => lower.includes(g) || g.includes(lower));
    const icpInGroup = icpIndustries.some((i) => group.some((g) => i.includes(g) || g.includes(i)));
    if (industryInGroup && icpInGroup) return true;
  }
  return false;
}

// --- Size Range Helpers ---

function parseRanges(ranges: string[]): Array<{ min: number; max: number }> {
  return ranges.map((r) => {
    const [min, max] = r.split(",").map(Number);
    return { min: min || 0, max: max || Infinity };
  });
}

function getIcpSizeRange(ranges: string[]): [number, number] {
  const parsed = parseRanges(ranges);
  if (parsed.length === 0) return [1, 100000];
  const min = Math.min(...parsed.map((r) => r.min));
  const max = Math.max(...parsed.map((r) => r.max === Infinity ? 100000 : r.max));
  return [min, max];
}

// --- Main Scorer ---

export interface NegativeIcpRules {
  industries: string[];
  titles: string[];
  companyPatterns: string[];
  sizeExclusions: string[];
}

export interface ConfidenceWeights {
  industry: number;
  size: number;
  title: number;
  geo: number;
}

export function scoreAccount(
  account: AccountData,
  icp: TamICP,
  signals: { hiring: boolean; funded: boolean } = { hiring: false, funded: false },
  confidence?: ConfidenceWeights,
  negativeIcp?: NegativeIcpRules | null,
): ScoringResult {
  // Check negative ICP disqualifiers first
  if (negativeIcp && account.industry) {
    const accountIndustryLower = account.industry.toLowerCase();
    const isDisqualified = negativeIcp.industries.some((ni) =>
      accountIndustryLower.includes(ni.toLowerCase()) || ni.toLowerCase().includes(accountIndustryLower),
    );
    if (isDisqualified) {
      return {
        tier: "D",
        heat: "Cold",
        heatScore: 0,
        breakdown: { industryFit: 0, sizeFit: 0, keywordFit: 0, signalScore: 0, freshness: 0 },
        industryMatch: false,
        sizeMatch: false,
        keywordMatch: false,
        reasoning: `Disqualified: "${account.industry}" is in negative ICP`,
        scoreSignals: [{
          signal: "Negative ICP",
          value: `Industry "${account.industry}" excluded`,
          source: "ICP Profile",
          weight: 0,
          category: "fit",
        }],
      };
    }
    if (account.name) {
      const nameLower = account.name.toLowerCase();
      const nameDisqualified = negativeIcp.companyPatterns.some((p) =>
        nameLower.includes(p.toLowerCase()),
      );
      if (nameDisqualified) {
        return {
          tier: "D",
          heat: "Cold",
          heatScore: 0,
          breakdown: { industryFit: 0, sizeFit: 0, keywordFit: 0, signalScore: 0, freshness: 0 },
          industryMatch: false,
          sizeMatch: false,
          keywordMatch: false,
          reasoning: `Disqualified: company name matches negative ICP pattern`,
          scoreSignals: [{
            signal: "Negative ICP",
            value: `Company "${account.name}" matches exclusion pattern`,
            source: "ICP Profile",
            weight: 0,
            category: "fit",
          }],
        };
      }
    }
  }

  const conf = confidence ?? { industry: 1, size: 1, title: 1, geo: 1 };
  const icpIndustries = (icp.industries ?? []).map((i) => i.toLowerCase());
  const icpKeywords = [
    ...(icp.keywords ?? []),
    ...(icp.industries ?? []),
    ...(icp.buying_signals ?? []),
  ].map((k) => k.toLowerCase());

  let industryFit = 5;
  let industryMatch = false;
  if (account.industry) {
    const accountIndustry = account.industry.toLowerCase();
    if (icpIndustries.some((i) => accountIndustry.includes(i) || i.includes(accountIndustry))) {
      industryFit = 25;
      industryMatch = true;
    } else if (areRelatedIndustries(accountIndustry, icpIndustries)) {
      industryFit = 15;
      industryMatch = true;
    }
  }

  let sizeFit = 5;
  let sizeMatch = false;
  if (account.employeeCount) {
    const [minIcp, maxIcp] = getIcpSizeRange(icp.employee_ranges ?? []);
    if (account.employeeCount >= minIcp && account.employeeCount <= maxIcp) {
      sizeFit = 25;
      sizeMatch = true;
    } else if (account.employeeCount >= minIcp * 0.5 && account.employeeCount <= maxIcp * 2) {
      sizeFit = 15;
      sizeMatch = true;
    } else {
      sizeFit = 5;
    }
  }

  let keywordFit = 0;
  let keywordMatch = false;
  if (account.keywords.length > 0 && icpKeywords.length > 0) {
    const accountKw = account.keywords.map((k) => k.toLowerCase());
    const matches = icpKeywords.filter((kw) =>
      accountKw.some((ak) => ak.includes(kw) || kw.includes(ak)),
    ).length;
    keywordFit = Math.min(20, Math.round((matches / Math.max(icpKeywords.length, 1)) * 20));
    keywordMatch = keywordFit >= 8;
  }

  let signalScore = 0;
  if (signals.hiring) signalScore += 10;
  if (signals.funded) signalScore += 10;

  let freshness = 0;
  if (account.domain) freshness += 2;
  if (account.websiteUrl) freshness += 2;
  if (account.linkedinUrl) freshness += 2;
  if (account.foundedYear) freshness += 2;
  if (account.employeeCount) freshness += 2;

  industryFit = Math.round(industryFit * conf.industry);
  sizeFit = Math.round(sizeFit * conf.size);

  const total = industryFit + sizeFit + keywordFit + signalScore + freshness;

  const tier = total >= 70 ? "A" as const : total >= 50 ? "B" as const : total >= 30 ? "C" as const : "D" as const;

  const intentScore = signalScore + (keywordFit >= 15 ? 5 : 0);
  const heat = intentScore >= 15 ? "Burning" as const
    : intentScore >= 10 ? "Hot" as const
    : total >= 50 ? "Warm" as const
    : "Cold" as const;

  const scoreSignals: ScoreSignal[] = [];

  if (account.industry) {
    scoreSignals.push({
      signal: "Industry",
      value: account.industry,
      source: "Apollo",
      weight: industryFit,
      category: "fit",
    });
  }
  if (account.employeeCount) {
    scoreSignals.push({
      signal: "Headcount",
      value: `${account.employeeCount.toLocaleString()} employees`,
      source: "Apollo",
      weight: sizeFit,
      category: "fit",
    });
  }
  if (keywordFit > 0) {
    const accountKw = account.keywords.map((k) => k.toLowerCase());
    const matchedKw = icpKeywords.filter((kw) =>
      accountKw.some((ak) => ak.includes(kw) || kw.includes(ak)),
    );
    scoreSignals.push({
      signal: "Keywords",
      value: matchedKw.slice(0, 3).join(", ") || "partial match",
      source: "Apollo",
      weight: keywordFit,
      category: "fit",
    });
  }

  if (signals.hiring) {
    scoreSignals.push({
      signal: "Hiring Outbound",
      value: "Actively hiring sales roles",
      source: "Careers page",
      weight: 10,
      category: "signal",
    });
  }
  if (signals.funded) {
    scoreSignals.push({
      signal: "Recently Funded",
      value: "Recent funding round",
      source: "Apollo",
      weight: 10,
      category: "signal",
    });
  }

  const missingFields = [];
  if (!account.domain) missingFields.push("domain");
  if (!account.websiteUrl) missingFields.push("website");
  if (!account.employeeCount) missingFields.push("headcount");
  if (missingFields.length > 0) {
    scoreSignals.push({
      signal: "Data Gaps",
      value: `Missing: ${missingFields.join(", ")}`,
      source: "Apollo",
      weight: freshness,
      category: "data",
    });
  }

  const reasons: string[] = [];
  if (industryFit >= 20) reasons.push(`${account.industry ?? "industry"} match`);
  if (sizeFit >= 20) reasons.push(`${account.employeeCount?.toLocaleString() ?? "?"} employees`);
  if (keywordFit >= 12) reasons.push("strong keyword overlap");
  if (signals.hiring) reasons.push("actively hiring");
  if (signals.funded) reasons.push("recently funded");

  const reasoning = tier === "A"
    ? `Perfect fit: ${reasons.join(", ")}`
    : tier === "B"
      ? `Good fit: ${reasons.join(", ")}`
      : tier === "C"
        ? `Partial fit: ${reasons.slice(0, 2).join(", ") || "limited data"}`
        : "Low fit: outside ICP parameters";

  return {
    tier,
    heat,
    heatScore: total,
    breakdown: { industryFit, sizeFit, keywordFit, signalScore, freshness },
    industryMatch,
    sizeMatch,
    keywordMatch,
    reasoning,
    scoreSignals,
  };
}
