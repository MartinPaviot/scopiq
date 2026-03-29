import { z } from "zod/v4";
import { scrapeViaJina } from "@/server/lib/connectors/jina";
import { mistralClient } from "@/server/lib/llm/mistral-client";

// --- Schema ---

export const companyDnaSchema = z.object({
  // --- Core ---
  oneLiner: z.string().default(""),
  targetBuyers: z
    .array(
      z.object({
        role: z.string(),
        sellingAngle: z.string().default(""),
      }),
    )
    .default([]),
  keyResults: z.array(z.string()).default([]),
  differentiators: z.array(z.string()).default([]),
  problemsSolved: z.array(z.string()).default([]),
  pricingModel: z.string().nullable().default(null),

  // --- Legacy (kept for migration, optional) ---
  proofPoints: z.array(z.string()).optional(),

  // --- New fields ---
  socialProof: z
    .array(
      z.object({
        industry: z.string(),
        clients: z.array(z.string()),
        keyMetric: z.string().optional(),
        vertical: z.string().optional(),
        companySize: z.enum(["startup", "smb", "mid-market", "enterprise"]).optional(),
        useCase: z.string().optional(),
        testimonialQuote: z.string().optional(),
      }),
    )
    .default([]),

  toneOfVoice: z
    .object({
      register: z
        .enum(["formal", "conversational", "casual"])
        .default("conversational"),
      traits: z.array(z.string()).default([]),
      avoidWords: z.array(z.string()).default([]),
    })
    .default({ register: "conversational", traits: [], avoidWords: [] }),

  ctas: z
    .array(
      z.object({
        label: z.string(),
        commitment: z.enum(["low", "medium", "high"]).default("low"),
        url: z.string().optional(),
      }),
    )
    .default([]),

  senderIdentity: z
    .object({
      name: z.string().default(""),
      role: z.string().default(""),
      signatureHook: z.string().default(""),
    })
    .default({ name: "", role: "", signatureHook: "" }),

  caseStudies: z
    .array(
      z.object({
        client: z.string(),
        industry: z.string(),
        timeline: z.string(),
        result: z.string(),
        context: z.string().optional(),
        vertical: z.string().optional(),
        companySize: z.enum(["startup", "smb", "mid-market", "enterprise"]).optional(),
        productUsed: z.string().optional(),
        quote: z.string().optional(),
        beforeState: z.string().optional(),
      }),
    )
    .default([]),

  clientPortfolio: z
    .array(
      z.object({
        name: z.string(),
        industry: z.string().optional(),
        vertical: z.string().optional(),
      }),
    )
    .default([]),

  objections: z
    .array(
      z.object({
        objection: z.string(),
        response: z.string(),
      }),
    )
    .default([]),

  // --- Investors + team for connection graph ---
  investors: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["vc", "angel", "accelerator", "corporate"]).default("vc"),
        source: z.string().optional(),
      }),
    )
    .default([]),

  teamMembers: z
    .array(
      z.object({
        name: z.string(),
        role: z.string(),
        linkedinUrl: z.string().optional(),
      }),
    )
    .default([]),
});

export type CompanyDna = z.infer<typeof companyDnaSchema>;

/**
 * Safely parse raw DB value into CompanyDna | string | null.
 */
export function parseCompanyDna(raw: unknown): CompanyDna | string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  const result = companyDnaSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(`Invalid CompanyDna in database: ${result.error.message}`);
}

// --- System Prompt ---

const COMPANY_ANALYSIS_SYSTEM = `You analyze scraped website content from a company to understand PRECISELY what it sells, to whom, and why it's useful. Your analysis will be used to write B2B cold prospecting emails — so it must be oriented toward "selling points", not neutral description.

You MUST return a JSON object with EXACTLY these keys (camelCase, no snake_case):

{
  "oneLiner": "ONE sentence. Format: '[Name] helps [who] to [do what] through [how].'",

  "problemsSolved": ["The 2-4 concrete problems the product/service solves."],

  "targetBuyers": [{"role": "Job title", "sellingAngle": "The selling angle that resonates for this role"}],

  "socialProof": [{"industry": "Industry sector", "clients": ["Client name 1", "Client name 2"], "keyMetric": "+45% conversion (optional)", "vertical": "Sub-industry — optional", "companySize": "startup|smb|mid-market|enterprise — optional", "useCase": "What product/feature this client uses — optional", "testimonialQuote": "Verbatim quote if available — optional"}],

  "keyResults": ["Numbers, stats, metrics ACTUALLY mentioned on the site. If NO numbers are mentioned, return []."],

  "differentiators": ["2-3 points that distinguish the company from competition."],

  "toneOfVoice": {"register": "formal|conversational|casual", "traits": ["2-3 adjectives"], "avoidWords": []},

  "ctas": [{"label": "The CTA text visible on the site", "commitment": "low|medium|high", "url": "CTA URL if visible"}],

  "pricingModel": "The pricing model if visible. null if not found.",

  "caseStudies": [{"client": "Client name", "industry": "Sector", "timeline": "In 90 days", "result": "+45% pipeline", "context": "Optional context", "vertical": "Sub-industry — optional", "companySize": "startup|smb|mid-market|enterprise — optional", "productUsed": "Which product/feature — optional", "quote": "Verbatim quote — optional", "beforeState": "Situation BEFORE — optional"}],

  "clientPortfolio": [{"name": "Client/company name", "industry": "Industry sector — optional", "vertical": "Sub-industry — optional"}],

  "investors": [{"name": "Investor/VC name", "type": "vc|angel|accelerator|corporate", "source": "URL or page where mentioned — optional"}],

  "teamMembers": [{"name": "Full name", "role": "Job title / role", "linkedinUrl": "LinkedIn profile URL — optional"}],

  "senderIdentity": {"name": "", "role": "", "signatureHook": ""},
  "objections": []
}

STRICT RULES:
- Base yourself EXCLUSIVELY on the provided content. Do NOT invent anything.
- EACH field must be filled from the actual site content.
- "problemsSolved": Deduce from value proposition, "why us" sections, pain points. CRITICAL field.
- "targetBuyers": Deduce from use cases, testimonials, page titles.
- "socialProof": THE most important field. ACTIVELY search for: "trusted by" sections, client logos, case studies, testimonials.
- "clientPortfolio": COMPLETE list of ALL client/company names visible on the site.
- "keyResults": ONLY numbers/stats explicitly written on the site. NEVER invent numbers.
- "investors": Extract ALL investor/VC/accelerator names from the site.
- "teamMembers": Extract key team members from /about, /team, or leadership sections. Max 10 entries.
- "senderIdentity" and "objections": ALWAYS return empty.
- If info is TRULY absent from the content, use [] or null.
- USE EXACTLY the key names above (camelCase). NO snake_case.`;

// --- Scraping ---

function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith("http")) {
    normalized = `https://${normalized}`;
  }
  return normalized.replace(/\/+$/, "");
}

const ABOUT_PATHS = ["/about", "/about-us", "/a-propos", "/qui-sommes-nous"];
const PRICING_PATHS = ["/pricing", "/tarifs", "/plans", "/offres"];
const CASE_STUDY_PATHS = [
  "/case-studies",
  "/customers",
  "/clients",
  "/success-stories",
  "/temoignages",
  "/cas-clients",
  "/results",
  "/roi",
];
const TESTIMONIAL_PATHS = ["/testimonials", "/reviews", "/temoignages", "/avis"];
const PARTNER_PATHS = ["/partners", "/integrations", "/partenaires", "/ecosystem"];
const TEAM_PATHS = ["/team", "/about/team", "/equipe", "/leadership", "/about-us/team"];

const JINA_DELAY_MS = 3400;
const SCRAPE_TIMEOUT_MS = 120_000;
const MAX_INDIVIDUAL_CASE_STUDIES = 3;
const MAX_COMBINED_CHARS = 35_000;

function extractMarkdown(result: Awaited<ReturnType<typeof scrapeViaJina>>): string | null {
  return result.ok ? result.markdown : null;
}

async function scrapeWithFallbacks(
  baseUrl: string,
  paths: string[],
): Promise<string | null> {
  for (const path of paths) {
    await delay(JINA_DELAY_MS);
    const md = extractMarkdown(await scrapeViaJina(`${baseUrl}${path}`));
    if (md && md.length > 100) return md;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractCaseStudyUrls(markdown: string, baseUrl: string): string[] {
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  const caseStudySegments = ["/case-study/", "/case-studies/", "/customer/", "/customers/", "/success-story/", "/success-stories/", "/cas-client/"];
  const urls: string[] = [];

  let match;
  while ((match = linkPattern.exec(markdown)) !== null) {
    const href = match[2];
    if (caseStudySegments.some((seg) => href.includes(seg))) {
      const fullUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
      if (!urls.includes(fullUrl)) urls.push(fullUrl);
    }
  }

  return urls.slice(0, MAX_INDIVIDUAL_CASE_STUDIES);
}

async function scrapeWithRetry(
  fn: () => Promise<string | null>,
): Promise<string | null> {
  const first = await fn();
  if (first) return first;
  await delay(1000);
  return fn();
}

async function scrapeClientSite(
  url: string,
  onStatus?: (label: string) => void,
): Promise<string> {
  const baseUrl = normalizeUrl(url);

  const scrapePromise = async (): Promise<string> => {
    onStatus?.("Scraping homepage...");
    const homepageResult = await scrapeViaJina(baseUrl);

    if (!homepageResult.ok) {
      throw new Error(
        `Could not access ${baseUrl}: ${homepageResult.message}. Check that the URL is correct and the site is accessible.`,
      );
    }

    const homepage = homepageResult.markdown;

    onStatus?.("Looking for about page...");
    const about = await scrapeWithRetry(() =>
      scrapeWithFallbacks(baseUrl, ABOUT_PATHS),
    );

    onStatus?.("Looking for pricing page...");
    const pricing = await scrapeWithRetry(() =>
      scrapeWithFallbacks(baseUrl, PRICING_PATHS),
    );

    onStatus?.("Looking for case studies / clients page...");
    const caseStudiesListing = await scrapeWithRetry(() =>
      scrapeWithFallbacks(baseUrl, CASE_STUDY_PATHS),
    );

    const individualCaseStudies: string[] = [];
    if (caseStudiesListing) {
      const csUrls = extractCaseStudyUrls(caseStudiesListing, baseUrl);
      if (csUrls.length > 0) {
        onStatus?.(`Found ${csUrls.length} individual case study page(s)...`);
        for (const csUrl of csUrls) {
          await delay(JINA_DELAY_MS);
          const md = extractMarkdown(await scrapeViaJina(csUrl));
          if (md && md.length > 100) individualCaseStudies.push(md);
        }
      }
    }

    onStatus?.("Looking for testimonials page...");
    const testimonials = await scrapeWithFallbacks(baseUrl, TESTIMONIAL_PATHS);

    onStatus?.("Looking for partners / integrations page...");
    const partners = await scrapeWithFallbacks(baseUrl, PARTNER_PATHS);

    onStatus?.("Looking for team page...");
    const team = await scrapeWithFallbacks(baseUrl, TEAM_PATHS);

    const sections: { label: string; content: string | null }[] = [
      { label: "homepage", content: homepage },
      { label: "about", content: about },
      { label: "pricing", content: pricing },
      { label: "case studies listing", content: caseStudiesListing },
      ...individualCaseStudies.map((cs, i) => ({
        label: `case study ${i + 1}`,
        content: cs,
      })),
      { label: "testimonials", content: testimonials },
      { label: "partners/integrations", content: partners },
      { label: "team/leadership", content: team },
    ];

    const found = sections.filter((s) => s.content);
    onStatus?.(`Scraped ${found.length} page(s): ${found.map((s) => s.label).join(", ")}`);

    const combined = found
      .map((s) => `---${s.label.toUpperCase()}---\n\n${s.content}`)
      .join("\n\n---NEXT PAGE---\n\n");

    return combined.slice(0, MAX_COMBINED_CHARS);
  };

  const result = await Promise.race([
    scrapePromise(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Scraping timed out after 120s")), SCRAPE_TIMEOUT_MS),
    ),
  ]);

  return result;
}

// --- Key normalization (snake_case -> camelCase) ---

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function normalizeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamel(key)] = normalizeKeys(value);
    }
    return result;
  }
  return obj;
}

// --- Analysis ---

export async function analyzeClientSite(
  url: string,
  workspaceId: string,
  onStatus?: (label: string) => void,
): Promise<CompanyDna> {
  const markdown = await scrapeClientSite(url, onStatus);

  if (!markdown || markdown.length < 50) {
    throw new Error("Could not scrape enough content from the provided URL.");
  }

  onStatus?.("Analyzing with Mistral...");

  const raw = await mistralClient.jsonRaw({
    model: "mistral-large-latest",
    system: COMPANY_ANALYSIS_SYSTEM,
    prompt: `Analyze this website and extract the commercial information:\n\n${markdown}`,
    workspaceId,
    action: "company-analysis",
    temperature: 0.3,
  });

  const normalized = normalizeKeys(raw);
  return companyDnaSchema.parse(normalized);
}
