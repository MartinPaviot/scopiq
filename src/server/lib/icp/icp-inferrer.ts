/**
 * ICP Inference Engine — Unified.
 *
 * Merges the two existing inference paths (tam-icp-inferrer.ts + infer-icp.ts)
 * into a single function that accepts all available inputs:
 *   CompanyDna + CustomerPatterns + NL description + ACV + win/loss + negative ICP
 *
 * Priority hierarchy for grounding:
 *   1. Customer patterns (highest — real data)
 *   2. CompanyDna analysis (social proof, case studies, target buyers)
 *   3. NL description from user
 *   4. Defaults
 */

import { z } from "zod/v4";
import { mistralClient } from "@/server/lib/llm/mistral-client";
import { logger } from "@/lib/logger";
import type { CompanyDna } from "@/server/lib/enrichment/company-analyzer";
import type {
  IcpProfileData,
  IcpInferenceInput,
  CustomerPatterns,
  NegativeIcp,
} from "./icp-schema";
import { icpProfileDataSchema, negativeIcpSchema } from "./icp-schema";
import { computeConfidence, type ConfidenceInput } from "./icp-confidence";
import { getDominantPatterns } from "./icp-customer-analyzer";

// ─── LLM Output Schema ────────────────────────────────

const llmOutputSchema = z.object({
  roles: z.array(z.object({
    title: z.string().default(""),
    variations: z.array(z.string()).default([]),
    seniority: z.string().default(""),
    why: z.string().default(""),
  })).default([]),
  industries: z.array(z.string()).default([]),
  employee_range: z.object({
    min: z.number().default(10),
    max: z.number().default(10000),
    sweet_spot: z.number().default(200),
  }).default({ min: 10, max: 10000, sweet_spot: 200 }),
  geographies: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  buying_signals: z.array(z.object({
    name: z.string().default(""),
    detection_method: z.string().default(""),
    why: z.string().default(""),
    strength: z.enum(["strong", "moderate", "weak"]).default("moderate"),
  })).default([]),
  disqualifiers: z.array(z.string()).default([]),
  competitors: z.array(z.string()).default([]),
  segments: z.array(z.object({
    name: z.string().default(""),
    titles: z.array(z.string()).default([]),
    industries: z.array(z.string()).default([]),
    sizes: z.array(z.string()).default([]),
    geos: z.array(z.string()).default([]),
  })).default([]),
  negative_icp: z.object({
    industries: z.array(z.string()).default([]),
    titles: z.array(z.string()).default([]),
    company_patterns: z.array(z.string()).default([]),
    size_exclusions: z.array(z.string()).default([]),
  }).nullable().default(null),
});

type LlmOutput = z.infer<typeof llmOutputSchema>;

// ─── System Prompt ─────────────────────────────────────

const INFER_ICP_SYSTEM = `You are a senior GTM consultant with 15 years in B2B SaaS sales. Given a company's DNA and optionally their existing customer data, infer the IDEAL CUSTOMER PROFILE for outbound prospecting.

Your analysis must cover:

1. BUYER ROLES — Who DECIDES to buy? Who USES? Who INFLUENCES?
   Use exact LinkedIn titles. Include variations and seniority level.

2. INDUSTRIES — Which industries buy this? Be specific (use Apollo categories: "saas", "fintech", not just "technology").

3. COMPANY SIZE — What employee range? Justify with pricing/product fit.
   Sweet spot = the most common size where the product delivers best ROI.

4. GEOGRAPHY — Which countries? Check site language, office locations, currencies, client locations.

5. BUYING SIGNALS — What events trigger purchase? "Hired VP Sales" → needs outreach tools.

6. KEYWORDS — Lowercase Apollo keyword tags for company search.

7. COMPETITORS — 5-10 direct and indirect competitors.

8. DISQUALIFIERS — What types of companies should NEVER be targeted?

9. SEGMENTS — 2-5 distinct buyer persona groups.

10. NEGATIVE ICP — If the user specified companies to never target, parse into structured exclusions:
    industries (industry names to exclude), titles (job titles to never target),
    company_patterns (name patterns like "consulting", "agency"),
    size_exclusions (Apollo ranges like "1,10" to exclude).

STRICT RULES:
- Return a FLAT JSON object. NO wrapper key like "icp" or "ideal_customer_profile". Root keys must be: roles, industries, employee_range, geographies, keywords, buying_signals, disqualifiers, competitors, segments.
- "roles" must be a FLAT array of objects: [{"title": "VP Sales", "variations": ["Head of Sales"], "seniority": "vp", "why": "Decision maker"}]
- "seniority" must be a single string, NOT an array
- titles: EXACT LinkedIn titles ("VP Sales" not "Vice President of Sales")
- seniorities: Apollo values: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry
- employee_range: {"min": 20, "max": 500, "sweet_spot": 100}
- geographies: full country names ("United States" not "USA")
- keywords: lowercase Apollo tags
- WHEN CUSTOMER DATA IS PROVIDED: it is GROUND TRUTH. Your industries, sizes, and geos MUST primarily reflect customer patterns.
- Return ONLY valid JSON, no markdown, no wrapper key.`;

// ─── Unwrap LLM Output ────────────────────────────────

/**
 * Mistral often wraps JSON in a top-level key like "icp" or "ideal_customer_profile".
 * It also uses variant key names ("buyer_roles" vs "roles", "deciders"/"users" nesting).
 * This function normalizes the output to match our expected schema.
 */
function unwrapLlmOutput(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;

  // If the output has a single top-level key that's an object, unwrap it
  const keys = Object.keys(obj);
  let data = obj;
  if (keys.length === 1 && typeof obj[keys[0]] === "object" && obj[keys[0]] !== null) {
    data = obj[keys[0]] as Record<string, unknown>;
  }

  // Normalize key variants
  const result: Record<string, unknown> = {};

  // Roles: might be "buyer_roles" (object with deciders/users/influencers) or "roles" (array)
  if (Array.isArray(data.roles)) {
    result.roles = data.roles;
  } else if (data.buyer_roles) {
    const br = data.buyer_roles;
    if (Array.isArray(br)) {
      result.roles = br;
    } else if (typeof br === "object" && br !== null) {
      // Flatten { deciders: [...], users: [...], influencers: [...] } into a single array
      const brObj = br as Record<string, unknown>;
      const allRoles: unknown[] = [];
      for (const group of Object.values(brObj)) {
        if (Array.isArray(group)) allRoles.push(...group);
      }
      result.roles = allRoles.map((r) => {
        const role = r as Record<string, unknown>;
        return {
          title: role.title ?? "",
          variations: Array.isArray(role.variations) ? role.variations : [],
          seniority: typeof role.seniority === "string" ? role.seniority
            : Array.isArray(role.seniority) ? (role.seniority as string[])[0] ?? ""
            : "",
          why: role.why ?? role.role ?? "",
        };
      });
    }
  }

  // Industries
  result.industries = data.industries ?? data.industry ?? [];

  // Employee range
  if (data.employee_range) {
    result.employee_range = data.employee_range;
  } else if (data.company_size) {
    const cs = data.company_size as Record<string, unknown>;
    result.employee_range = {
      min: cs.min ?? cs.minimum ?? 10,
      max: cs.max ?? cs.maximum ?? 10000,
      sweet_spot: cs.sweet_spot ?? cs.sweetSpot ?? cs.ideal ?? 200,
    };
  }

  // Geography
  result.geographies = data.geographies ?? data.geography ?? data.countries ?? data.geos ?? [];

  // Keywords
  result.keywords = data.keywords ?? data.keyword_tags ?? [];

  // Buying signals — normalize variant key names (signal/trigger → name)
  const rawSignals = data.buying_signals ?? data.buyingSignals ?? data.signals ?? [];
  if (Array.isArray(rawSignals)) {
    result.buying_signals = rawSignals.map((s: unknown) => {
      if (typeof s === "string") return { name: s };
      const sig = s as Record<string, unknown>;
      return {
        name: sig.name ?? sig.signal ?? sig.trigger ?? sig.event ?? "",
        detection_method: sig.detection_method ?? sig.detectionMethod ?? sig.method ?? "",
        why: sig.why ?? sig.reason ?? sig.description ?? "",
        strength: sig.strength ?? "moderate",
      };
    });
  } else {
    result.buying_signals = [];
  }

  // Disqualifiers
  result.disqualifiers = data.disqualifiers ?? data.exclusions ?? [];

  // Competitors — might be array of strings or objects
  const rawComp = data.competitors ?? [];
  if (Array.isArray(rawComp)) {
    result.competitors = rawComp.map((c: unknown) =>
      typeof c === "string" ? c : (c as Record<string, unknown>).name ?? String(c),
    );
  } else {
    result.competitors = [];
  }

  // Segments — normalize structure
  const rawSegs = data.segments ?? [];
  if (Array.isArray(rawSegs)) {
    result.segments = rawSegs.map((s: unknown) => {
      if (typeof s !== "object" || !s) return { name: String(s) };
      const seg = s as Record<string, unknown>;
      return {
        name: seg.name ?? "",
        titles: Array.isArray(seg.titles) ? seg.titles : [],
        industries: Array.isArray(seg.industries) ? seg.industries : [],
        sizes: Array.isArray(seg.sizes) ? seg.sizes : [],
        geos: Array.isArray(seg.geos) ? seg.geos : [],
      };
    });
  } else {
    result.segments = [];
  }

  // Negative ICP
  result.negative_icp = data.negative_icp ?? data.negativeIcp ?? null;

  return result;
}

// ─── Build Context for LLM ────────────────────────────

function buildInferenceContext(input: IcpInferenceInput): string {
  const sections: string[] = [];
  const dna = input.companyDna as Record<string, unknown>;

  // Company DNA sections
  if (dna.oneLiner) {
    sections.push(`PRODUCT: ${dna.oneLiner}`);
  }

  const buyers = dna.targetBuyers as Array<{ role: string; sellingAngle?: string }> | undefined;
  if (buyers?.length) {
    sections.push(`TARGET BUYERS:\n${buyers.map((b) => `- ${b.role}: ${b.sellingAngle ?? ""}`).join("\n")}`);
  }

  const problems = dna.problemsSolved as string[] | undefined;
  if (problems?.length) {
    sections.push(`PROBLEMS SOLVED: ${problems.join("; ")}`);
  }

  const socialProof = dna.socialProof as Array<{ industry: string; clients: string[]; companySize?: string }> | undefined;
  if (socialProof?.length) {
    sections.push(`SOCIAL PROOF:\n${socialProof.map((sp) => {
      const parts = [`Industry: ${sp.industry}`, `Clients: ${sp.clients.join(", ")}`];
      if (sp.companySize) parts.push(`Size: ${sp.companySize}`);
      return `- ${parts.join(" | ")}`;
    }).join("\n")}`);
  }

  const clientPortfolio = dna.clientPortfolio as Array<{ name: string; industry?: string }> | undefined;
  if (clientPortfolio?.length) {
    const portfolioIndustries = [...new Set(clientPortfolio.map((c) => c.industry).filter(Boolean))];
    if (portfolioIndustries.length) {
      sections.push(`PORTFOLIO INDUSTRIES: ${portfolioIndustries.join(", ")}`);
    }
  }

  const caseStudies = dna.caseStudies as Array<{ client: string; industry: string; result: string }> | undefined;
  if (caseStudies?.length) {
    sections.push(`CASE STUDIES:\n${caseStudies.slice(0, 5).map((cs) => `- ${cs.client} (${cs.industry}): ${cs.result}`).join("\n")}`);
  }

  if (dna.pricingModel) {
    sections.push(`PRICING: ${dna.pricingModel}`);
  }

  if (dna.differentiators) {
    const diffs = dna.differentiators as string[];
    if (diffs.length) sections.push(`DIFFERENTIATORS: ${diffs.join("; ")}`);
  }

  // Customer patterns (ground truth)
  if (input.customerPatterns && input.customerPatterns.totalCustomers > 0) {
    const cp = input.customerPatterns;
    const dominant = getDominantPatterns(cp);
    const lines: string[] = [`${cp.totalCustomers} existing customers analyzed:`];
    if (dominant.topIndustries.length) {
      lines.push(`Top industries: ${cp.industryDist.slice(0, 5).map((d) => `${d.value} (${d.percentage}%)`).join(", ")}`);
    }
    if (dominant.topSizes.length) {
      lines.push(`Size distribution: ${cp.sizeDist.slice(0, 5).map((d) => `${d.value} (${d.percentage}%)`).join(", ")}`);
    }
    if (dominant.topGeos.length) {
      lines.push(`Top geos: ${cp.geoDist.slice(0, 5).map((d) => `${d.value} (${d.percentage}%)`).join(", ")}`);
    }
    if (cp.avgDealValue) {
      lines.push(`Average deal value: $${cp.avgDealValue.toLocaleString()}`);
    }
    sections.push(`\nEXISTING CUSTOMERS (GROUND TRUTH — ICP must reflect these patterns):\n${lines.join("\n")}`);
  }

  // User NL description
  if (input.nlDescription) {
    sections.push(`\nUSER'S ICP DESCRIPTION: "${input.nlDescription}"`);
  }

  // ACV
  if (input.acv) {
    sections.push(`AVERAGE CONTRACT VALUE: $${input.acv.toLocaleString()}/month`);
  }

  // Win/loss reasons
  if (input.winReasons) {
    sections.push(`WHY DEALS CLOSE: ${input.winReasons}`);
  }
  if (input.lossReasons) {
    sections.push(`WHY DEALS ARE LOST: ${input.lossReasons}`);
  }

  // Negative ICP
  if (input.negativeIcpText) {
    sections.push(`\nNEVER TARGET (parse into negative_icp): ${input.negativeIcpText}`);
  }

  return sections.join("\n\n");
}

// ─── Main Inference Function ───────────────────────────

/**
 * Infer a complete ICP from all available data sources.
 * Returns a fully structured IcpProfileData ready to persist.
 */
export async function inferIcpProfile(
  input: IcpInferenceInput,
): Promise<IcpProfileData> {
  const context = buildInferenceContext(input);
  const dna = input.companyDna as Record<string, unknown>;

  logger.info("[icp/infer] Starting unified ICP inference", {
    url: input.siteUrl,
    hasCustomers: (input.customerPatterns?.totalCustomers ?? 0) > 0,
    hasNlDescription: !!input.nlDescription,
    hasAcv: !!input.acv,
    contentLength: context.length,
  });

  const rawResult = await mistralClient.jsonRaw({
    model: "mistral-large-latest",
    system: INFER_ICP_SYSTEM,
    prompt: `Website: ${input.siteUrl}\n\n${context}`,
    workspaceId: input.workspaceId,
    action: "icp-unified-inference",
    temperature: 0.3,
  });

  // Mistral often wraps output in a top-level key — unwrap it
  const unwrapped = unwrapLlmOutput(rawResult);

  logger.info("[icp/infer] LLM output (unwrapped)", {
    keys: unwrapped ? Object.keys(unwrapped) : "null",
  });

  const parseResult = llmOutputSchema.safeParse(unwrapped);
  if (!parseResult.success) {
    logger.warn("[icp/infer] Schema validation issues, using partial data", {
      errors: parseResult.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  const llmResult = parseResult.success ? parseResult.data : llmOutputSchema.parse({});

  // Validate minimum viable ICP — retry if empty
  if (llmResult.roles.length === 0) {
    logger.warn("[icp/infer] No roles inferred, retrying with stricter prompt");
    const retryRaw = await mistralClient.jsonRaw({
      model: "mistral-large-latest",
      system: INFER_ICP_SYSTEM,
      prompt: `Website: ${input.siteUrl}\n\n${context}\n\nIMPORTANT: Return a FLAT JSON object (no wrapper key). The root object MUST contain "roles", "industries", "geographies", "employee_range", "keywords", "buying_signals", "competitors", "segments".`,
      workspaceId: input.workspaceId,
      action: "icp-unified-inference-retry",
      temperature: 0.2,
    });

    const retryUnwrapped = unwrapLlmOutput(retryRaw);
    const retryParsed = llmOutputSchema.safeParse(retryUnwrapped);
    const retryResult = retryParsed.success ? retryParsed.data : llmOutputSchema.parse({});
    return transformLlmOutput(retryResult, input, dna);
  }

  return transformLlmOutput(llmResult, input, dna);
}

// ─── Transform LLM Output → IcpProfileData ─────────────

function transformLlmOutput(
  result: LlmOutput,
  input: IcpInferenceInput,
  dna: Record<string, unknown>,
): IcpProfileData {
  // Compute confidence based on data richness
  const socialProof = dna.socialProof as Array<unknown> | undefined;
  const caseStudies = dna.caseStudies as Array<unknown> | undefined;
  const clientPortfolio = dna.clientPortfolio as Array<unknown> | undefined;

  const confidenceInput: ConfidenceInput = {
    customerCount: input.customerPatterns?.totalCustomers ?? 0,
    customerPatterns: input.customerPatterns ?? null,
    socialProofCount: socialProof?.length ?? 0,
    caseStudyCount: caseStudies?.length ?? 0,
    clientPortfolioCount: clientPortfolio?.length ?? 0,
    hasNlDescription: !!input.nlDescription,
    hasAcv: !!input.acv,
    hasWinLoss: !!(input.winReasons || input.lossReasons),
    source: "onboarding",
  };

  const confidence = computeConfidence(confidenceInput);

  // Parse negative ICP
  let negativeIcp: NegativeIcp | null = null;
  if (result.negative_icp) {
    negativeIcp = negativeIcpSchema.parse({
      industries: result.negative_icp.industries,
      titles: result.negative_icp.titles,
      companyPatterns: result.negative_icp.company_patterns,
      sizeExclusions: result.negative_icp.size_exclusions,
    });
  }

  const profileData: IcpProfileData = {
    nlDescription: input.nlDescription ?? null,
    acv: input.acv ?? null,
    salesCycleLength: input.salesCycleLength ?? null,
    winReasons: input.winReasons ?? null,
    lossReasons: input.lossReasons ?? null,
    roles: result.roles.map((r) => ({
      title: r.title,
      variations: r.variations,
      seniority: r.seniority,
      why: r.why,
    })),
    industries: result.industries,
    employeeRange: {
      min: result.employee_range.min,
      max: result.employee_range.max,
      sweetSpot: result.employee_range.sweet_spot,
    },
    geographies: result.geographies,
    keywords: result.keywords,
    buyingSignals: result.buying_signals.map((bs) => ({
      name: bs.name,
      detectionMethod: bs.detection_method,
      why: bs.why,
      strength: bs.strength,
    })),
    disqualifiers: result.disqualifiers,
    competitors: result.competitors,
    segments: result.segments,
    negativeIcp,
    confidence,
    customerPatterns: input.customerPatterns ?? null,
  };

  // Validate with Zod
  return icpProfileDataSchema.parse(profileData);
}
