/**
 * TAM Signal Detector — Common Investor.
 *
 * Detects shared investors between the user's company and a prospect.
 * Uses Crunchbase org pages via Jina Reader (free).
 *
 * Returns investor names, reasoning, and source URLs.
 */

import { scrapeViaJina } from "@/server/lib/connectors/jina";
import { logger } from "@/lib/logger";
import type { SignalResult } from "./detect-signals";

// ─── Types ──────────────────────────────────────────────

export interface InvestorInfo {
  name: string;
  type: "vc" | "angel" | "accelerator" | "corporate";
  source?: string;
}

export interface CommonInvestorResult extends SignalResult {
  commonInvestors: string[];
  investorSources: Array<{ url: string; title: string; investorName: string }>;
}

// ─── Investor Extraction ────────────────────────────────

const INVESTOR_PATTERNS = [
  /(?:backed by|funded by|invested by|investors?(?:\s+include)?)[:\s]+([^\n.]+)/gi,
  /(?:series\s+[a-d]|seed|pre-seed)\s+(?:round\s+)?(?:led by|from)\s+([^\n.]+)/gi,
  /(?:raised\s+\$[\d,.]+[mk]?\s+(?:from|led by))\s+([^\n.]+)/gi,
];

const KNOWN_VC_NAMES = new Set([
  "founders fund", "sequoia", "a16z", "andreessen horowitz", "accel",
  "benchmark", "greylock", "lightspeed", "index ventures", "bessemer",
  "general catalyst", "tiger global", "insight partners", "ribbit capital",
  "first round", "khosla", "kleiner perkins", "ivp", "spark capital",
  "yc", "y combinator", "techstars", "500 startups", "500 global",
  "sutter hill", "human capital", "greenoaks", "menlo ventures",
  "matrix partners", "ggv capital", "softbank", "coatue",
]);

const ACCELERATOR_NAMES = new Set([
  "y combinator", "yc", "techstars", "500 startups", "500 global",
  "plug and play", "alchemist", "seedcamp", "entrepreneur first",
]);

/**
 * Extract investor names from Crunchbase-scraped markdown.
 */
function extractInvestors(markdown: string): InvestorInfo[] {
  const investors: InvestorInfo[] = [];
  const seen = new Set<string>();

  for (const pattern of INVESTOR_PATTERNS) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(markdown)) !== null) {
      const raw = match[1];
      // Split by common separators
      const names = raw.split(/[,&]|(?:\s+and\s+)/i).map((n) => n.trim()).filter((n) => n.length > 1 && n.length < 60);
      for (const name of names) {
        const normalized = name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
        if (seen.has(normalized) || normalized.length < 2) continue;
        seen.add(normalized);

        const type = ACCELERATOR_NAMES.has(normalized) ? "accelerator" as const
          : KNOWN_VC_NAMES.has(normalized) ? "vc" as const
          : "vc" as const;

        investors.push({ name: name.trim(), type });
      }
    }
  }

  // Also check for known VC names directly in the markdown
  const lowerMarkdown = markdown.toLowerCase();
  for (const vcName of KNOWN_VC_NAMES) {
    if (lowerMarkdown.includes(vcName) && !seen.has(vcName)) {
      seen.add(vcName);
      const type = ACCELERATOR_NAMES.has(vcName) ? "accelerator" as const : "vc" as const;
      investors.push({
        name: vcName.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
        type,
      });
    }
  }

  return investors;
}

// ─── Crunchbase Scraper ─────────────────────────────────

function domainToSlug(domain: string): string {
  return domain.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

async function scrapeInvestorsForDomain(domain: string): Promise<{
  investors: InvestorInfo[];
  sourceUrl: string;
}> {
  const slug = domainToSlug(domain);
  const crunchbaseUrl = `https://www.crunchbase.com/organization/${slug}`;

  const result = await Promise.race([
    scrapeViaJina(crunchbaseUrl),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 8000),
    ),
  ]);

  if (!result.ok) {
    return { investors: [], sourceUrl: crunchbaseUrl };
  }

  return {
    investors: extractInvestors(result.markdown),
    sourceUrl: crunchbaseUrl,
  };
}

// ─── Main Detector ──────────────────────────────────────

/**
 * Detect common investors between user's company and a prospect.
 */
export async function detectCommonInvestor(
  domain: string,
  userInvestors: InvestorInfo[],
): Promise<CommonInvestorResult> {
  const result: CommonInvestorResult = {
    name: "Common Investor",
    detected: false,
    evidence: "",
    sources: [],
    reasoning: "No shared investors detected",
    points: 0,
    commonInvestors: [],
    investorSources: [],
  };

  if (userInvestors.length === 0) {
    result.reasoning = "No user investors configured — set them via chat or onboarding";
    return result;
  }

  try {
    const { investors: prospectInvestors, sourceUrl } = await scrapeInvestorsForDomain(domain);

    if (prospectInvestors.length === 0) {
      result.reasoning = "Could not find investor data for this company";
      return result;
    }

    // Cross-reference: find shared investors
    const userInvestorNames = new Set(
      userInvestors.map((i) => i.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim()),
    );

    const common: string[] = [];
    const sources: Array<{ url: string; title: string; investorName: string }> = [];

    for (const prospectInvestor of prospectInvestors) {
      const normalized = prospectInvestor.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      if (userInvestorNames.has(normalized)) {
        common.push(prospectInvestor.name);
        sources.push({
          url: sourceUrl,
          title: `Crunchbase — ${domain}`,
          investorName: prospectInvestor.name,
        });
      }
    }

    if (common.length === 0) {
      result.reasoning = `Prospect investors (${prospectInvestors.map((i) => i.name).join(", ")}) don't overlap with yours`;
      return result;
    }

    result.detected = true;
    result.commonInvestors = common;
    result.investorSources = sources;
    result.evidence = `Shared investor${common.length > 1 ? "s" : ""}: ${common.join(", ")}`;
    result.sources = [{ url: sourceUrl, title: `Crunchbase — ${domain}` }];
    result.reasoning = `${domain} shares investor${common.length > 1 ? "s" : ""} with your company: ${common.join(", ")}. This creates a warm connection path.`;
    result.points = Math.min(common.length * 8, 15);

    return result;
  } catch (err) {
    logger.debug("[detect-investor] Failed", {
      domain,
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }
}
