/**
 * ICP Converters — Bridge between IcpProfile and external systems.
 *
 * Handles:
 * - IcpProfile → Apollo Organization Search filters
 * - IcpProfile → Apollo People Search filters
 * - Legacy TamICP → IcpProfileData (migration)
 * - Legacy InferredICP → IcpProfileData (migration)
 */

import type { ApolloOrgSearchParams } from "@/server/lib/apollo/client";
import type { IcpProfileData, ConfidenceScores } from "./icp-schema";
import type { TamICP } from "@/server/lib/tam/tam-icp-inferrer";
import type { InferredICP } from "@/server/lib/tam/infer-icp";

// ─── IcpProfile → Apollo Org Search ───────────────────

export function icpProfileToOrgFilters(
  profile: IcpProfileData,
): ApolloOrgSearchParams {
  // Combine industries + keywords for broad coverage
  const keywordTags = new Set<string>();
  for (const ind of profile.industries) keywordTags.add(ind);
  for (const kw of profile.keywords) keywordTags.add(kw);
  for (const seg of profile.segments) {
    for (const ind of seg.industries) keywordTags.add(ind);
  }

  const employeeRanges =
    profile.employeeRange.min && profile.employeeRange.max
      ? [`${profile.employeeRange.min},${profile.employeeRange.max}`]
      : ["1,10000"];

  return {
    organization_num_employees_ranges: employeeRanges,
    q_organization_keyword_tags:
      keywordTags.size > 0 ? [...keywordTags] : undefined,
    organization_locations:
      profile.geographies.length > 0
        ? profile.geographies
        : ["United States"],
  };
}

// ─── IcpProfile → Apollo People Search ────────────────

export interface ApolloPeopleSearchParams {
  person_titles: string[];
  person_seniorities: string[];
  person_locations: string[];
  organization_num_employees_ranges: string[];
  q_organization_keyword_tags: string[];
}

export function icpProfileToPeopleFilters(
  profile: IcpProfileData,
): ApolloPeopleSearchParams {
  const allTitles = profile.roles.flatMap((r) => [r.title, ...r.variations]);
  const allSeniorities = [
    ...new Set(profile.roles.map((r) => r.seniority).filter(Boolean)),
  ];

  return {
    person_titles: allTitles,
    person_seniorities: allSeniorities,
    person_locations:
      profile.geographies.length > 0
        ? profile.geographies
        : ["United States"],
    organization_num_employees_ranges: [
      `${profile.employeeRange.min},${profile.employeeRange.max}`,
    ],
    q_organization_keyword_tags: profile.industries,
  };
}

// ─── Legacy TamICP → IcpProfileData ───────────────────

/**
 * Convert the legacy TamICP (from tam-icp-inferrer.ts) to the new unified schema.
 * Used for migration of existing workspaces.
 */
export function tamIcpToProfileData(tamIcp: TamICP): IcpProfileData {
  // Parse employee ranges to find min/max/sweetSpot
  const ranges = tamIcp.employee_ranges.map((r) => {
    const [min, max] = r.split(",").map(Number);
    return { min: min || 0, max: max || 100000 };
  });
  const allMins = ranges.map((r) => r.min);
  const allMaxs = ranges.map((r) => r.max);
  const min = allMins.length > 0 ? Math.min(...allMins) : 10;
  const max = allMaxs.length > 0 ? Math.max(...allMaxs) : 10000;
  const sweetSpot = Math.round((min + max) / 2);

  return {
    nlDescription: null,
    acv: null,
    salesCycleLength: null,
    winReasons: null,
    lossReasons: null,
    roles: tamIcp.titles.map((title, i) => ({
      title,
      variations: [],
      seniority: tamIcp.seniorities[i] ?? "",
      why: "",
    })),
    industries: tamIcp.industries,
    employeeRange: { min, max, sweetSpot },
    geographies: tamIcp.geos,
    keywords: tamIcp.keywords,
    buyingSignals: tamIcp.buying_signals.map((bs) => ({
      name: bs,
      detectionMethod: "",
      why: "",
      strength: "moderate" as const,
    })),
    disqualifiers: [],
    competitors: tamIcp.competitors,
    segments: tamIcp.segments.map((s) => ({
      name: s.name,
      titles: s.titles,
      industries: s.industries,
      sizes: s.sizes,
      geos: s.geos,
    })),
    negativeIcp: null,
    confidence: {
      industry: 0.4,
      size: 0.4,
      title: 0.4,
      geo: 0.4,
      overall: 0.4,
    },
    customerPatterns: null,
  };
}

// ─── Legacy InferredICP → IcpProfileData ──────────────

/**
 * Convert the legacy InferredICP (from infer-icp.ts) to the new unified schema.
 */
export function inferredIcpToProfileData(
  inferredIcp: InferredICP,
): IcpProfileData {
  return {
    nlDescription: inferredIcp.summary || null,
    acv: null,
    salesCycleLength: null,
    winReasons: null,
    lossReasons: null,
    roles: inferredIcp.roles.map((r) => ({
      title: r.title,
      variations: r.variations,
      seniority: r.seniority,
      why: r.why,
    })),
    industries: inferredIcp.companies.industries,
    employeeRange: {
      min: inferredIcp.companies.employeeRange.min,
      max: inferredIcp.companies.employeeRange.max,
      sweetSpot: inferredIcp.companies.employeeRange.sweetSpot,
    },
    geographies: inferredIcp.companies.geography,
    keywords: [],
    buyingSignals: inferredIcp.buyingSignals.map((bs) => ({
      name: bs.name,
      detectionMethod: bs.detectionMethod,
      why: bs.why,
      strength: bs.strength,
    })),
    disqualifiers: inferredIcp.disqualifiers,
    competitors: [],
    segments: [],
    negativeIcp: null,
    confidence: {
      industry: 0.4,
      size: 0.4,
      title: 0.4,
      geo: 0.4,
      overall: 0.4,
    },
    customerPatterns: null,
  };
}

// ─── IcpProfileData → Legacy InferredICP ──────────────

/**
 * Convert IcpProfileData back to InferredICP format for backward compat
 * with existing score-leads.ts and tam-engine.ts consumers.
 */
export function profileDataToInferredIcp(
  profile: IcpProfileData,
): InferredICP {
  return {
    roles: profile.roles.map((r) => ({
      title: r.title,
      variations: r.variations,
      seniority: r.seniority,
      why: r.why,
    })),
    companies: {
      industries: profile.industries,
      employeeRange: {
        min: profile.employeeRange.min,
        max: profile.employeeRange.max,
        sweetSpot: profile.employeeRange.sweetSpot,
      },
      geography: profile.geographies,
    },
    buyingSignals: profile.buyingSignals.map((bs) => ({
      name: bs.name,
      detectionMethod: bs.detectionMethod,
      why: bs.why,
      strength: bs.strength,
    })),
    disqualifiers: profile.disqualifiers,
    summary: profile.nlDescription ?? "",
  };
}

// ─── IcpProfileData → Legacy TamICP ───────────────────

/**
 * Convert IcpProfileData back to TamICP format for backward compat
 * with existing tam-build.ts Apollo filter conversion.
 */
export function profileDataToTamIcp(profile: IcpProfileData): TamICP {
  return {
    product_summary: "",
    pricing_tier: profile.acv
      ? profile.acv < 50
        ? "plg"
        : profile.acv > 500
          ? "enterprise"
          : "mid_market"
      : "mid_market",
    titles: profile.roles.map((r) => r.title),
    seniorities: [
      ...new Set(profile.roles.map((r) => r.seniority).filter(Boolean)),
    ],
    industries: profile.industries,
    employee_ranges: [
      `${profile.employeeRange.min},${profile.employeeRange.max}`,
    ],
    geos: profile.geographies,
    keywords: profile.keywords,
    buying_signals: profile.buyingSignals.map((bs) => bs.name),
    competitors: profile.competitors,
    reasoning: {
      why_these_titles: "",
      why_this_size: "",
      why_these_industries: "",
    },
    segments: profile.segments.map((s) => ({
      name: s.name,
      titles: s.titles,
      industries: s.industries,
      sizes: s.sizes,
      geos: s.geos,
    })),
  };
}
