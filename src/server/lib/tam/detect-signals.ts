/**
 * TAM Engine -- 5 Signal Detectors.
 *
 * Each detector checks for a specific buying signal using existing infrastructure
 * (Jina scraping, Apollo org data, hiring-signal-extractor).
 * All detectors have 5s timeout. Failure = detected: false, never blocks.
 */

import { scrapeViaJina } from "@/server/lib/connectors/jina";
import { extractJobTitles } from "@/server/lib/enrichment/hiring-signal-extractor";
import { logger } from "@/lib/logger";
import { detectCommonInvestor, type InvestorInfo, type CommonInvestorResult } from "./detect-investor";
import { detectLinkedInConnections, type ConnectionSignalResult } from "./detect-connections";

// --- Types ---

export interface SignalSource {
  url: string;
  title: string;
  favicon?: string;
}

export interface SignalResult {
  name: string;
  detected: boolean;
  evidence: string;
  sources: SignalSource[];
  reasoning: string;
  points: number;
}

export interface ApolloOrgData {
  domain?: string;
  technologies?: string[];
  latestFundingRoundDate?: string;
  fundingTotal?: string;
  employeeCount?: number;
  industry?: string;
}

export interface ApolloPersonData {
  employmentStartDate?: string;
  title?: string;
}

// --- Sales Role Patterns ---

const SALES_ROLE_PATTERNS = [
  /\b(sdr|bdr|sales\s*development|business\s*development)\b/i,
  /\b(account\s*executive|ae\b)/i,
  /\b(sales\s*manager|sales\s*director|sales\s*lead)\b/i,
  /\b(head\s*of\s*sales|vp\s*sales|vp\s*of\s*sales)\b/i,
  /\b(outbound|inside\s*sales|field\s*sales)\b/i,
  /\b(revenue|demand\s*gen|growth)\b/i,
];

// --- CRM/Sales Tool Patterns ---

const SALES_TOOL_PATTERNS = [
  { pattern: /hubspot/i, name: "HubSpot" },
  { pattern: /salesforce/i, name: "Salesforce" },
  { pattern: /outreach\.io/i, name: "Outreach" },
  { pattern: /salesloft/i, name: "SalesLoft" },
  { pattern: /pipedrive/i, name: "Pipedrive" },
  { pattern: /gong\.io/i, name: "Gong" },
  { pattern: /apollo\.io/i, name: "Apollo" },
  { pattern: /zoominfo/i, name: "ZoomInfo" },
  { pattern: /linkedin\s*sales\s*navigator/i, name: "LinkedIn Sales Navigator" },
];

// --- Detector 1: Hiring Outbound (0-15pts) ---

async function detectHiringOutbound(
  domain: string,
): Promise<SignalResult> {
  const result: SignalResult = {
    name: "Hiring Outbound",
    detected: false,
    evidence: "",
    sources: [],
    reasoning: "No sales hiring signals detected",
    points: 0,
  };

  try {
    const careersUrl = `https://${domain}/careers`;
    const scrapeResult = await Promise.race([
      scrapeViaJina(careersUrl),
      timeoutPromise(5000),
    ]);

    if (!scrapeResult || !scrapeResult.ok) return result;

    const titles = extractJobTitles(scrapeResult.markdown);
    const salesRoles = titles.filter((t) =>
      SALES_ROLE_PATTERNS.some((p) => p.test(t)),
    );

    if (salesRoles.length === 0) return result;

    result.detected = true;
    result.evidence = `Hiring ${salesRoles.length} sales role(s): ${salesRoles.slice(0, 3).join(", ")}`;
    result.sources = [{ url: careersUrl, title: "Careers page" }];
    result.reasoning = `Company is actively recruiting for outbound sales roles, indicating investment in sales-led growth.`;
    result.points = Math.min(salesRoles.length * 5, 15);
  } catch {
    // Graceful degradation
  }

  return result;
}

// --- Detector 2: Sales-Led Growth (0-10pts) ---

async function detectSalesLedGrowth(
  domain: string,
  orgData?: ApolloOrgData,
): Promise<SignalResult> {
  const result: SignalResult = {
    name: "Sales-Led Growth",
    detected: false,
    evidence: "",
    sources: [],
    reasoning: "No sales tools detected",
    points: 0,
  };

  try {
    const homepageUrl = `https://${domain}`;
    const scrapeResult = await Promise.race([
      scrapeViaJina(homepageUrl),
      timeoutPromise(5000),
    ]);

    const detectedTools: string[] = [];

    if (scrapeResult?.ok) {
      for (const tool of SALES_TOOL_PATTERNS) {
        if (tool.pattern.test(scrapeResult.markdown)) {
          detectedTools.push(tool.name);
        }
      }
    }

    if (orgData?.technologies) {
      for (const tech of orgData.technologies) {
        for (const tool of SALES_TOOL_PATTERNS) {
          if (tool.pattern.test(tech) && !detectedTools.includes(tool.name)) {
            detectedTools.push(tool.name);
          }
        }
      }
    }

    if (detectedTools.length === 0) return result;

    result.detected = true;
    result.evidence = `Uses: ${detectedTools.join(", ")}`;
    result.sources = [{ url: `https://${domain}`, title: "Homepage" }];
    result.reasoning = `Company uses ${detectedTools.length} sales/CRM tool(s), indicating a structured sales process.`;
    result.points = Math.min(detectedTools.length * 4, 10);
  } catch {
    // Graceful degradation
  }

  return result;
}

// --- Detector 3: Recent Funding (0-10pts) ---

function detectRecentFunding(orgData?: ApolloOrgData): SignalResult {
  const result: SignalResult = {
    name: "Recent Funding",
    detected: false,
    evidence: "",
    sources: [],
    reasoning: "No recent funding data available",
    points: 0,
  };

  if (!orgData?.latestFundingRoundDate) return result;

  const fundingDate = new Date(orgData.latestFundingRoundDate);
  if (isNaN(fundingDate.getTime())) return result;

  const monthsAgo = monthsDiff(fundingDate, new Date());

  if (monthsAgo > 12) {
    result.reasoning = `Last funding was ${monthsAgo} months ago (stale)`;
    return result;
  }

  result.detected = true;
  result.evidence = orgData.fundingTotal
    ? `Raised ${orgData.fundingTotal} (${monthsAgo} months ago)`
    : `Funded ${monthsAgo} months ago`;
  result.reasoning = `Recent funding (< 12 months) indicates growth investment and budget for new tools.`;
  result.points = monthsAgo <= 6 ? 10 : 7;

  return result;
}

// --- Detector 4: Tech Stack Fit (0-10pts) ---

function detectTechStackFit(
  orgData?: ApolloOrgData,
  _homepageHtml?: string,
): SignalResult {
  const result: SignalResult = {
    name: "Tech Stack Fit",
    detected: false,
    evidence: "",
    sources: [],
    reasoning: "No tech stack data available",
    points: 0,
  };

  if (!orgData?.technologies?.length) return result;

  const relevantTech = orgData.technologies.filter((t) => {
    const lower = t.toLowerCase();
    return (
      /salesforce|hubspot|marketo|pardot|outreach|salesloft/i.test(lower) ||
      /stripe|intercom|zendesk|drift|segment/i.test(lower) ||
      /slack|zoom|teams|notion/i.test(lower) ||
      /aws|gcp|azure|heroku|vercel/i.test(lower)
    );
  });

  if (relevantTech.length === 0) return result;

  result.detected = true;
  result.evidence = `Uses: ${relevantTech.slice(0, 5).join(", ")}`;
  result.reasoning = `Tech stack includes ${relevantTech.length} B2B-relevant tools, indicating tech-forward organization.`;
  result.points = Math.min(relevantTech.length * 3, 10);

  return result;
}

// --- Detector 5: Recent Job Change (0-5pts) ---

function detectRecentJobChange(personData?: ApolloPersonData): SignalResult {
  const result: SignalResult = {
    name: "New in Role",
    detected: false,
    evidence: "",
    sources: [],
    reasoning: "No employment start date available",
    points: 0,
  };

  if (!personData?.employmentStartDate) return result;

  const startDate = new Date(personData.employmentStartDate);
  if (isNaN(startDate.getTime())) return result;

  const daysAgo = daysDiff(startDate, new Date());

  if (daysAgo > 90) {
    result.reasoning = `Started role ${daysAgo} days ago (not recent)`;
    return result;
  }

  result.detected = true;
  result.evidence = `Started current role ${daysAgo} days ago`;
  result.reasoning = `New in role (< 90 days) -- likely evaluating and adopting new tools.`;
  result.points = daysAgo <= 30 ? 5 : 3;

  return result;
}

// --- Orchestrator ---

export async function detectAllSignals(
  domain: string,
  orgData?: ApolloOrgData,
  personData?: ApolloPersonData,
  userInvestors?: InvestorInfo[],
  workspaceId?: string,
): Promise<SignalResult[]> {
  const detectors: Promise<SignalResult>[] = [
    detectHiringOutbound(domain),
    detectSalesLedGrowth(domain, orgData),
    Promise.resolve(detectRecentFunding(orgData)),
    Promise.resolve(detectTechStackFit(orgData)),
    Promise.resolve(detectRecentJobChange(personData)),
  ];

  if (userInvestors && userInvestors.length > 0) {
    detectors.push(detectCommonInvestor(domain, userInvestors));
  }

  if (workspaceId) {
    detectors.push(detectLinkedInConnections(domain, workspaceId));
  }

  return Promise.all(detectors);
}

export type { InvestorInfo, CommonInvestorResult, ConnectionSignalResult };

// --- Helpers ---

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
  );
}

function monthsDiff(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function daysDiff(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}
