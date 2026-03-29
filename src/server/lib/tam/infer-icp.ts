/**
 * TAM Engine -- ICP Inference from Company DNA.
 *
 * Uses Mistral Large to infer a structured ICP from the workspace's Company DNA.
 * Output is used by count-tam (Apollo queries) and score-leads (tier assignment).
 */

import { z } from "zod/v4";
import { mistralClient } from "@/server/lib/llm/mistral-client";
import type { CompanyDna } from "@/server/lib/enrichment/company-analyzer";

// --- Schema ---

const icpRoleSchema = z.object({
  title: z.string(),
  variations: z.array(z.string()).default([]),
  seniority: z.string().default(""),
  why: z.string().default(""),
});

const inferredIcpSchema = z.object({
  roles: z.array(icpRoleSchema).default([]),
  companies: z.object({
    industries: z.array(z.string()).default([]),
    employeeRange: z.object({
      min: z.number().default(10),
      max: z.number().default(10000),
      sweetSpot: z.number().default(200),
    }).default({ min: 10, max: 10000, sweetSpot: 200 }),
    geography: z.array(z.string()).default([]),
  }).default({ industries: [], employeeRange: { min: 10, max: 10000, sweetSpot: 200 }, geography: [] }),
  buyingSignals: z.array(z.object({
    name: z.string(),
    detectionMethod: z.string().default(""),
    why: z.string().default(""),
    strength: z.enum(["strong", "moderate", "weak"]).default("moderate"),
  })).default([]),
  disqualifiers: z.array(z.string()).default([]),
  summary: z.string().default(""),
});

export type InferredICP = z.infer<typeof inferredIcpSchema>;
export type ICPRole = z.infer<typeof icpRoleSchema>;

// --- System Prompt ---

const INFER_ICP_SYSTEM = `You are an expert B2B sales strategist. Given a Company DNA (what a company sells, to whom, and why), you infer the Ideal Customer Profile (ICP) -- the types of people and companies most likely to buy.

Return a JSON object with:
{
  "roles": [{"title": "VP Sales", "variations": ["Head of Sales", "Sales Director", "Chief Revenue Officer"], "seniority": "VP/Director", "why": "Decision maker for sales tools"}],
  "companies": {
    "industries": ["SaaS", "B2B Tech", "FinTech"],
    "employeeRange": {"min": 50, "max": 1000, "sweetSpot": 200},
    "geography": ["United States", "United Kingdom", "Canada"]
  },
  "buyingSignals": [{"name": "Hiring SDRs", "detectionMethod": "careers page", "why": "Scaling outbound = needs tools", "strength": "strong"}],
  "disqualifiers": ["Consulting firms", "Agencies under 10 people"],
  "summary": "Mid-market B2B SaaS companies scaling their outbound sales team, specifically VP Sales and Head of Growth roles."
}

RULES:
- Infer roles from targetBuyers -- expand with title variations and seniority levels
- Infer industries from socialProof industries + clientPortfolio
- Infer company size from socialProof companySize distribution
- Infer geography from clientPortfolio patterns or default to US/UK/Canada
- Identify 3-5 buying signals that indicate purchase readiness
- Be specific and actionable -- these will become Apollo search filters
- If clientPortfolio is empty, use problemsSolved to infer likely industries
- JSON only, no markdown.`;

// --- Main Function ---

export async function inferICP(
  companyDna: CompanyDna,
  workspaceId: string,
): Promise<InferredICP> {
  const dnaContext = buildDnaContext(companyDna);

  return mistralClient.json<InferredICP>({
    model: "mistral-large-latest",
    system: INFER_ICP_SYSTEM,
    prompt: `Analyze this Company DNA and infer the Ideal Customer Profile:\n\n${dnaContext}`,
    schema: inferredIcpSchema,
    workspaceId,
    action: "tam-infer-icp",
    temperature: 0.3,
  });
}

// --- Helpers ---

function buildDnaContext(dna: CompanyDna): string {
  const sections: string[] = [];

  sections.push(`ONE-LINER: ${dna.oneLiner}`);

  if (dna.targetBuyers.length > 0) {
    sections.push(`TARGET BUYERS:\n${dna.targetBuyers.map((b) => `- ${b.role}: ${b.sellingAngle}`).join("\n")}`);
  }

  if (dna.problemsSolved.length > 0) {
    sections.push(`PROBLEMS SOLVED:\n${dna.problemsSolved.map((p) => `- ${p}`).join("\n")}`);
  }

  if (dna.differentiators.length > 0) {
    sections.push(`DIFFERENTIATORS:\n${dna.differentiators.map((d) => `- ${d}`).join("\n")}`);
  }

  if (dna.socialProof.length > 0) {
    sections.push(`SOCIAL PROOF:\n${dna.socialProof.map((sp) => {
      const parts = [`Industry: ${sp.industry}`, `Clients: ${sp.clients.join(", ")}`];
      if (sp.keyMetric) parts.push(`Metric: ${sp.keyMetric}`);
      if (sp.companySize) parts.push(`Size: ${sp.companySize}`);
      return `- ${parts.join(" | ")}`;
    }).join("\n")}`);
  }

  if (dna.clientPortfolio.length > 0) {
    sections.push(`CLIENT PORTFOLIO:\n${dna.clientPortfolio.slice(0, 20).map((c) => {
      const parts = [c.name];
      if (c.industry) parts.push(c.industry);
      if (c.vertical) parts.push(c.vertical);
      return `- ${parts.join(" | ")}`;
    }).join("\n")}`);
  }

  if (dna.caseStudies.length > 0) {
    sections.push(`CASE STUDIES:\n${dna.caseStudies.slice(0, 5).map((cs) => {
      return `- ${cs.client} (${cs.industry}): ${cs.result} in ${cs.timeline}`;
    }).join("\n")}`);
  }

  return sections.join("\n\n");
}
