/**
 * TAM Engine — ICP Inference from Website Content.
 *
 * Uses Mistral Large to analyze raw website content and infer
 * a structured ICP optimized for Apollo search filters.
 *
 * Different from infer-icp.ts (which takes CompanyDna).
 * This version works directly from scraped website text.
 */

import { z } from "zod/v4";
import { mistralClient } from "@/server/lib/llm/mistral-client";
import { logger } from "@/lib/logger";
import type { ApolloOrgSearchParams } from "@/server/lib/apollo/client";

// ─── Schema ─────────────────────────────────────────────

const tamSegmentSchema = z.object({
  name: z.string(),
  titles: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  sizes: z.array(z.string()).default([]),
  geos: z.array(z.string()).default([]),
});

const tamIcpSchema = z.object({
  product_summary: z.string().default(""),
  pricing_tier: z.string().default("mid_market"),
  titles: z.array(z.string()).default([]),
  seniorities: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  employee_ranges: z.array(z.string()).default([]),
  geos: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  buying_signals: z.array(z.string()).default([]),
  competitors: z.array(z.string()).default([]),
  reasoning: z.object({
    why_these_titles: z.string().default(""),
    why_this_size: z.string().default(""),
    why_these_industries: z.string().default(""),
  }).default({ why_these_titles: "", why_this_size: "", why_these_industries: "" }),
  segments: z.array(tamSegmentSchema).default([]),
});

export type TamICP = z.infer<typeof tamIcpSchema>;
export type TamSegment = z.infer<typeof tamSegmentSchema>;

// ─── System Prompt ──────────────────────────────────────

const INFER_ICP_SYSTEM = `You are a senior GTM consultant with 15 years in B2B SaaS sales. Analyze this website to infer the IDEAL CUSTOMER PROFILE for outbound prospecting.

Your analysis must cover:

1. PRODUCT — What does this company sell? What problem? How do they monetize?
   Pricing tier: "plg" (<$50/mo), "mid_market" ($50-500/mo), "enterprise" (>$500/mo)

2. BUYER PROFILE — Who DECIDES to buy? (exact LinkedIn titles)
   Who USES the product? Who INFLUENCES the decision?

3. MARKET FIT — Which INDUSTRIES buy this? What COMPANY SIZE?
   Justify size: "20-200 because pricing at $99/mo is too expensive for <20 and too small for >200 who want enterprise"
   Which COUNTRIES? (check site language, office locations, currencies, case studies)

4. BUYING SIGNALS — What events trigger purchase?
   "Company hires VP Sales" → needs outreach tools. "Raised Series A" → has budget.

5. COMPETITORS — Name 5-10 direct and indirect competitors.

Return ONLY valid JSON:
{
  "product_summary": "One sentence",
  "pricing_tier": "plg | mid_market | enterprise",
  "titles": ["VP Sales", "Head of Growth", "CEO"],
  "seniorities": ["vp", "director", "c_suite"],
  "industries": ["saas", "technology", "marketing"],
  "employee_ranges": ["21,50", "51,100", "101,200"],
  "geos": ["United States", "United Kingdom", "France"],
  "keywords": ["cold email", "outbound", "sales automation"],
  "buying_signals": ["Hiring VP Sales", "Recently raised Series A/B", "Using Salesforce CRM"],
  "competitors": ["Instantly", "Smartlead", "Reply.io"],
  "reasoning": {
    "why_these_titles": "explain",
    "why_this_size": "explain",
    "why_these_industries": "explain"
  },
  "segments": [
    {
      "name": "SaaS founders US",
      "titles": ["CEO", "Founder"],
      "industries": ["saas"],
      "sizes": ["11,20", "21,50"],
      "geos": ["United States"]
    }
  ]
}

STRICT RULES:
- titles: EXACT LinkedIn titles ("VP Sales" not "Vice President of Sales")
- seniorities: ONLY Apollo values: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern
- employee_ranges: format "min,max" with comma. Valid: "1,10", "11,20", "21,50", "51,100", "101,200", "201,500", "501,1000", "1001,5000", "5001,10000", "10001,"
- geos: full country names ("United States" not "USA", "United Kingdom" not "UK")
- keywords: lowercase terms Apollo uses to tag companies ("cold email", "saas", "fintech")
- industries: Apollo industry categories — be specific ("saas" not "technology")
- JUSTIFY every choice in "reasoning" — if you can't justify it, it's probably wrong
- 2-5 segments, each = a distinct buyer persona
- JSON only, no markdown.`;

// ─── Main Function ──────────────────────────────────────

/**
 * Infer ICP from website content using Mistral Large.
 * Returns Apollo-compatible filters and segments.
 *
 * Retries once with a stricter prompt if the first attempt returns invalid JSON.
 */
export async function inferTamICP(
  siteUrl: string,
  content: string,
  workspaceId: string,
): Promise<TamICP> {
  const prompt = `Website: ${siteUrl}\n\nContent:\n${content}`;

  try {
    const result = await mistralClient.json<TamICP>({
      model: "mistral-large-latest",
      system: INFER_ICP_SYSTEM,
      prompt,
      schema: tamIcpSchema,
      workspaceId,
      action: "tam-infer-icp-from-site",
      temperature: 0.3,
    });

    // Validate minimum viable ICP
    if (result.titles.length === 0) {
      logger.warn("[tam/icp] ICP has no titles, retrying with stricter prompt");
      return retryInference(siteUrl, content, workspaceId);
    }

    logger.info("[tam/icp] ICP inferred", {
      url: siteUrl,
      titles: result.titles.length,
      industries: result.industries.length,
      segments: result.segments.length,
    });

    return result;
  } catch (err) {
    logger.warn("[tam/icp] First inference attempt failed, retrying", {
      error: err instanceof Error ? err.message : String(err),
    });
    return retryInference(siteUrl, content, workspaceId);
  }
}

// ─── Retry with Stricter Prompt ─────────────────────────

async function retryInference(
  siteUrl: string,
  content: string,
  workspaceId: string,
): Promise<TamICP> {
  const stricterPrompt = `Website: ${siteUrl}

Content:
${content}

IMPORTANT: You MUST return valid JSON with at least:
- 3 titles (job titles of potential buyers)
- 2 industries
- 2 employee_ranges in "min,max" format
- 1 geo (country name)
- 1 segment

If you cannot determine the ICP from the content, make reasonable assumptions for a B2B SaaS company.`;

  return mistralClient.json<TamICP>({
    model: "mistral-large-latest",
    system: INFER_ICP_SYSTEM,
    prompt: stricterPrompt,
    schema: tamIcpSchema,
    workspaceId,
    action: "tam-infer-icp-from-site-retry",
    temperature: 0.2,
  });
}

// ─── Infer from Company DNA (no scraping) ───────────────

/**
 * Derive TamICP from an existing Company DNA analysis.
 * This avoids re-scraping the website — uses the rich Company DNA
 * that was already built in the onboarding Step 1.
 *
 * Falls back to LLM inference if the Company DNA is too sparse.
 */
export interface CustomerContext {
  companyName: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  dealValue?: number;
  country?: string;
}

export async function inferTamICPFromDna(
  siteUrl: string,
  companyDna: Record<string, unknown>,
  workspaceId: string,
  existingCustomers?: CustomerContext[],
): Promise<TamICP> {
  // Build a rich summary from Company DNA fields
  const parts: string[] = [];

  if (companyDna.oneLiner) {
    parts.push(`Product: ${companyDna.oneLiner}`);
  }

  const buyers = companyDna.targetBuyers as Array<{ role: string; sellingAngle?: string }> | undefined;
  if (buyers?.length) {
    parts.push(`Target buyers: ${buyers.map((b) => b.role).join(", ")}`);
  }

  const problems = companyDna.problemsSolved as string[] | undefined;
  if (problems?.length) {
    parts.push(`Problems solved: ${problems.join("; ")}`);
  }

  const socialProof = companyDna.socialProof as Array<{ industry: string; clients: string[]; companySize?: string }> | undefined;
  if (socialProof?.length) {
    const industries = [...new Set(socialProof.map((sp) => sp.industry))];
    parts.push(`Client industries: ${industries.join(", ")}`);

    const sizes = [...new Set(socialProof.map((sp) => sp.companySize).filter(Boolean))];
    if (sizes.length) parts.push(`Client sizes: ${sizes.join(", ")}`);
  }

  const clientPortfolio = companyDna.clientPortfolio as Array<{ name: string; industry?: string }> | undefined;
  if (clientPortfolio?.length) {
    const portfolioIndustries = [...new Set(clientPortfolio.map((c) => c.industry).filter(Boolean))];
    if (portfolioIndustries.length) {
      parts.push(`Portfolio industries: ${portfolioIndustries.join(", ")}`);
    }
  }

  if (companyDna.pricingModel) {
    parts.push(`Pricing: ${companyDna.pricingModel}`);
  }

  if (companyDna.differentiators) {
    const diffs = companyDna.differentiators as string[];
    if (diffs.length) parts.push(`Differentiators: ${diffs.join("; ")}`);
  }

  // Inject existing customer data to ground ICP in reality
  if (existingCustomers?.length) {
    const customerLines = existingCustomers.slice(0, 50).map((c) => {
      const fields = [c.companyName];
      if (c.industry) fields.push(c.industry);
      if (c.employeeCount) fields.push(`${c.employeeCount} employees`);
      if (c.dealValue) fields.push(`$${c.dealValue.toLocaleString()} deal`);
      if (c.country) fields.push(c.country);
      return `- ${fields.join(" | ")}`;
    });
    parts.push(`\nEXISTING CUSTOMERS (ground truth — ICP should match these patterns):\n${customerLines.join("\n")}`);
  }

  const content = parts.join("\n");

  logger.info("[tam/icp] Inferring ICP from Company DNA", {
    url: siteUrl,
    dnaFields: parts.length,
    contentLength: content.length,
    customerCount: existingCustomers?.length ?? 0,
  });

  return inferTamICP(siteUrl, content, workspaceId);
}

// ─── Helpers ────────────────────────────────────────────

/**
 * Convert TamICP to Apollo People Search filters.
 * Merges all segments into a single broad query.
 */
export function icpToApolloFilters(icp: TamICP): {
  person_titles: string[];
  person_seniorities: string[];
  person_locations: string[];
  organization_num_employees_ranges: string[];
  q_organization_keyword_tags: string[];
} {
  return {
    person_titles: icp.titles,
    person_seniorities: icp.seniorities,
    person_locations: icp.geos.length > 0 ? icp.geos : ["United States"],
    organization_num_employees_ranges:
      icp.employee_ranges.length > 0 ? icp.employee_ranges : ["1,10000"],
    q_organization_keyword_tags: icp.industries,
  };
}

/**
 * Convert TamICP to Apollo Organization Search filters.
 * Maps ICP fields to the org search endpoint params:
 *  - industries + keywords → q_organization_keyword_tags
 *  - companySize → organization_num_employees_ranges
 *  - geos → organization_locations
 */
export function icpToOrgFilters(icp: TamICP): ApolloOrgSearchParams {
  // Combine industries + keywords + segment industries for broad coverage
  const keywordTags = new Set<string>();
  for (const ind of icp.industries) keywordTags.add(ind);
  for (const kw of (icp.keywords ?? [])) keywordTags.add(kw);
  for (const seg of icp.segments) {
    for (const ind of seg.industries) keywordTags.add(ind);
  }

  return {
    organization_num_employees_ranges:
      icp.employee_ranges.length > 0 ? icp.employee_ranges : ["1,10000"],
    q_organization_keyword_tags: keywordTags.size > 0 ? [...keywordTags] : undefined,
    organization_locations: icp.geos.length > 0 ? icp.geos : ["United States"],
  };
}
