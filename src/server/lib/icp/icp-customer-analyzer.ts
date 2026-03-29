/**
 * ICP Customer Analyzer — Deterministic firmographic clustering.
 *
 * Pure computation (zero LLM calls): takes CustomerImportEntry[] rows
 * and extracts distribution patterns for industry, company size,
 * geography, and deal value.
 *
 * These patterns ground the ICP inference in reality:
 * "80% of your customers are SaaS companies with 50-200 employees."
 */

import type { CustomerPatterns, DistributionEntry } from "./icp-schema";

// ─── Input type (matches CustomerImportEntry fields) ───

export interface CustomerEntry {
  companyName: string;
  domain?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  dealValue?: number | null;
  country?: string | null;
}

// ─── Size Buckets (matching Apollo ranges) ─────────────

const SIZE_BUCKETS = [
  { label: "1-10", min: 1, max: 10 },
  { label: "11-20", min: 11, max: 20 },
  { label: "21-50", min: 21, max: 50 },
  { label: "51-100", min: 51, max: 100 },
  { label: "101-200", min: 101, max: 200 },
  { label: "201-500", min: 201, max: 500 },
  { label: "501-1000", min: 501, max: 1000 },
  { label: "1001-5000", min: 1001, max: 5000 },
  { label: "5001+", min: 5001, max: Infinity },
] as const;

function getSizeBucket(count: number): string {
  for (const bucket of SIZE_BUCKETS) {
    if (count >= bucket.min && count <= bucket.max) return bucket.label;
  }
  return "Unknown";
}

// ─── Distribution Builder ──────────────────────────────

function buildDistribution(values: string[]): DistributionEntry[] {
  if (values.length === 0) return [];

  const counts = new Map<string, number>();
  for (const v of values) {
    const normalized = v.trim().toLowerCase();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  const total = values.length;
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      count,
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Deal Value Stats ──────────────────────────────────

function computeDealValueStats(values: number[]): {
  avg: number | null;
  median: number | null;
} {
  if (values.length === 0) return { avg: null, median: null };

  const sorted = [...values].sort((a, b) => a - b);
  const avg = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];

  return { avg, median };
}

// ─── Main Analyzer ─────────────────────────────────────

/**
 * Analyze customer import entries to extract firmographic patterns.
 * Pure computation — no API calls, no LLM.
 */
export function analyzeCustomerPatterns(
  entries: CustomerEntry[],
): CustomerPatterns {
  if (entries.length === 0) {
    return {
      industryDist: [],
      sizeDist: [],
      geoDist: [],
      avgDealValue: null,
      medianDealValue: null,
      totalCustomers: 0,
    };
  }

  // Industry distribution
  const industries = entries
    .map((e) => e.industry)
    .filter((i): i is string => !!i);
  const industryDist = buildDistribution(industries);

  // Size distribution (bucketed)
  const sizes = entries
    .map((e) => e.employeeCount)
    .filter((c): c is number => c != null && c > 0)
    .map((c) => getSizeBucket(c));
  const sizeDist = buildDistribution(sizes);

  // Geography distribution
  const geos = entries
    .map((e) => e.country)
    .filter((c): c is string => !!c);
  const geoDist = buildDistribution(geos);

  // Deal value stats
  const dealValues = entries
    .map((e) => e.dealValue)
    .filter((v): v is number => v != null && v > 0);
  const { avg, median } = computeDealValueStats(dealValues);

  return {
    industryDist,
    sizeDist,
    geoDist,
    avgDealValue: avg,
    medianDealValue: median,
    totalCustomers: entries.length,
  };
}

/**
 * Extract dominant patterns from customer data for ICP grounding.
 * Returns the top N entries per dimension that represent >= threshold% of customers.
 */
export function getDominantPatterns(
  patterns: CustomerPatterns,
  topN: number = 3,
  thresholdPercent: number = 10,
): {
  topIndustries: string[];
  topSizes: string[];
  topGeos: string[];
} {
  const filter = (dist: DistributionEntry[]) =>
    dist
      .filter((d) => d.percentage >= thresholdPercent)
      .slice(0, topN)
      .map((d) => d.value);

  return {
    topIndustries: filter(patterns.industryDist),
    topSizes: filter(patterns.sizeDist),
    topGeos: filter(patterns.geoDist),
  };
}
