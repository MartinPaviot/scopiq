import { z } from "zod/v4";
import { scrapeViaJina } from "@/server/lib/connectors/jina";
import { mistralClient } from "@/server/lib/llm/mistral-client";

// ─── Schema ──────────────────────────────────────────────

export const companyDnaSchema = z.object({
  // --- Core (existants) ---
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

  // --- Monaco-level fields (investors + team for connection graph & common investor) ---
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
 * Returns null if the value is falsy, string if it's a plain string,
 * or validated CompanyDna if it's a valid object.
 * Throws if the value is an object but doesn't match the schema.
 */
export function parseCompanyDna(raw: unknown): CompanyDna | string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  const result = companyDnaSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(`Invalid CompanyDna in database: ${result.error.message}`);
}

// ─── System Prompt ───────────────────────────────────────

const COMPANY_ANALYSIS_SYSTEM = `You analyze scraped website content from a company to understand PRECISELY what it sells, to whom, and why it's useful. Your analysis will be used to write B2B cold prospecting emails — so it must be oriented toward "selling points", not neutral description.

You MUST return a JSON object with EXACTLY these keys (camelCase, no snake_case):

{
  "oneLiner": "ONE sentence. Format: '[Name] helps [who] to [do what] through [how].'",

  "problemsSolved": ["The 2-4 concrete problems the product/service solves. Extract them from the content (client pain points, frustrations, inefficiencies). Short phrase starting with a verb or noun."],

  "targetBuyers": [{"role": "Job title (e.g.: VP Sales, Head of Growth, CTO)", "sellingAngle": "The selling angle that resonates for this role — what specific benefit matters to them"}],

  "socialProof": [{"industry": "Industry sector (e.g.: SaaS, E-commerce, FinTech, Healthcare)", "clients": ["Client name 1", "Client name 2"], "keyMetric": "+45% conversion at Client 1 (optional, only if mentioned)", "vertical": "Sub-industry (e.g.: HR Tech under SaaS, InsurTech under FinTech) — optional", "companySize": "startup|smb|mid-market|enterprise — deduce from context if possible (Fortune 500 = enterprise, 'team of 50' = startup/smb)", "useCase": "What product/feature this client uses — optional", "testimonialQuote": "Verbatim quote from a testimonial if available — optional"}],

  "keyResults": ["Numbers, stats, metrics, case study results ACTUALLY mentioned on the site. E.g.: '+45% conversion', '500+ clients', '3x faster'. If NO numbers are mentioned, return []."],

  "differentiators": ["2-3 points that distinguish the company from competition. Unique advantages, proprietary tech, different approach."],

  "toneOfVoice": {"register": "formal|conversational|casual", "traits": ["2-3 adjectives describing the site's writing style: direct, empathetic, technical, data-driven, etc."], "avoidWords": []},

  "ctas": [{"label": "The CTA text visible on the site (e.g.: 'Start for free', 'Book a demo')", "commitment": "low|medium|high", "url": "CTA URL if visible"}],

  "pricingModel": "The pricing model if visible (freemium, per seat, custom quote, free trial, etc.). null if not found.",

  "caseStudies": [{"client": "Client name", "industry": "Sector (SaaS, E-commerce, etc.)", "timeline": "In 90 days / After their Series B / In 6 months", "result": "+45% pipeline / 3x more demos / -60% churn", "context": "Optional context: company size, situation before, trigger", "vertical": "Sub-industry (e.g.: MarTech, EdTech) — optional", "companySize": "startup|smb|mid-market|enterprise — optional", "productUsed": "Which product/feature of the sender was used — optional", "quote": "Verbatim testimonial quote from the case study — optional", "beforeState": "Situation BEFORE using the product (for contrast) — optional"}],

  "clientPortfolio": [{"name": "Client/company name", "industry": "Industry sector — optional", "vertical": "Sub-industry — optional"}],

  "investors": [{"name": "Investor/VC name", "type": "vc|angel|accelerator|corporate", "source": "URL or page where mentioned — optional"}],

  "teamMembers": [{"name": "Full name", "role": "Job title / role", "linkedinUrl": "LinkedIn profile URL — optional"}],

  "senderIdentity": {"name": "", "role": "", "signatureHook": ""},
  "objections": []
}

STRICT RULES:
- Base yourself EXCLUSIVELY on the provided content. Do NOT invent anything. NEVER supplement with your own knowledge.
- EACH field must be filled from the actual site content. Actively search through all provided pages.
- "problemsSolved": Deduce problems from the value proposition, "why us" sections, mentioned pain points. This is a CRITICAL field for cold emails.
- "targetBuyers": Deduce from use cases, testimonials, page titles (e.g.: "for sales teams", "for marketers").
- "socialProof": This is THE most important field for cold emails. ACTIVELY search for: "trusted by" sections, client logos, case studies, testimonials, partner pages. GROUP clients by industry/sector. If a quantified result is associated with a client, put it in keyMetric. If you don't know a client's industry, use "General". For EACH entry, try to add:
  - "vertical": the sub-industry (e.g. "HR Tech" under "SaaS", "InsurTech" under "FinTech")
  - "companySize": deduce from context clues (Fortune 500 / enterprise mentions = "enterprise", "team of 50" / seed stage = "startup", etc.)
  - "useCase": what specific product/feature this client uses
  - "testimonialQuote": verbatim quote if a testimonial is present. Include the speaker's name/role if available.
- "clientPortfolio": This is the COMPLETE list of ALL client/company names visible on the site — the "logo wall". Extract EVERY name from "trusted by", "our clients", logo sections, partner pages, integration pages, case study listings, and testimonial pages. Tag each with industry and vertical if deducible. This is DISTINCT from socialProof (which has metrics). clientPortfolio = exhaustive inventory.
- LOGO WALLS: Actively search for sections labeled "trusted by", "nos clients", "they trust us", "our customers", logo grids. Extract EVERY company name.
- TESTIMONIALS: Extract verbatim quotes with attribution (name, role, company). Put quotes in the relevant socialProof entry's "testimonialQuote" field.
- VERTICALS: Tag each client with its sub-vertical (e.g.: "MarTech" under "SaaS", "PropTech" under "Real Estate"). Be specific.
- INTEGRATIONS/PARTNERS: Integration partners = implicit social proof. Add them to clientPortfolio.
- BEFORE STATE: For case studies, extract the situation BEFORE using the product. This creates powerful contrast in emails (Step 2: Social Proof).
- "keyResults": ONLY numbers/stats explicitly written on the site. NEVER invent numbers.
- "toneOfVoice": Analyze the site's writing style. Formal = corporate, distant. Conversational = natural, friendly. Casual = very informal, startup-like. Traits = 2-3 adjectives. avoidWords = always [].
- "ctas": Extract visible CTAs from the site (buttons, action links). Commitment: low = free resource, newsletter. medium = demo, call, audit. high = purchase, subscription.
- "caseStudies": Extract case studies with TIMELINE. For each quantified result found in case study, client, or testimonial pages, extract: the client, their industry, the TIMELINE (how long, after what event), and the result. Results with timelines are 2.3x more impactful in cold email. If no explicit timeline, deduce from context ("after their migration", "in Q1 2024"). If truly impossible, use "N/A". Also extract: vertical, companySize, productUsed, quote (testimonial), and beforeState (situation before). Search through ALL provided pages.
- "pricingModel": Look in the pricing page if provided.
- "investors": Extract ALL investor/VC/accelerator names from the site. Search for: "backed by", "funded by", "investors", "partners" (financial), YC/Techstars badges, funding announcements, press pages, footer logos. For each investor, classify type: "vc" (venture capital firms), "angel" (individual angels), "accelerator" (YC, Techstars, 500 Startups), "corporate" (strategic investors). Include the source URL/page where mentioned.
- "teamMembers": Extract key team members from /about, /team, or leadership sections. Include name, role/title, and LinkedIn URL if present. Focus on founders, C-suite, and VP+ level. Max 10 entries.
- "senderIdentity" and "objections": ALWAYS return empty — this info is not on the site, the user will fill it in.
- If info is TRULY absent from the content → [] or null. But search carefully before concluding it's absent.
- USE EXACTLY the key names above (camelCase). NO snake_case.`;

// ─── Scraping ────────────────────────────────────────────

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

const JINA_DELAY_MS = 3400; // ~18 req/min rate limit
const SCRAPE_TIMEOUT_MS = 120_000; // 2 min global timeout
const MAX_INDIVIDUAL_CASE_STUDIES = 3;
const MAX_COMBINED_CHARS = 35_000;

/** Extract markdown from Jina result, return null on failure. */
function extractMarkdown(result: Awaited<ReturnType<typeof scrapeViaJina>>): string | null {
  return result.ok ? result.markdown : null;
}

/** Try primary path, then fallbacks. Returns first successful result. Respects Jina rate limit. */
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

/** Extract individual case study URLs from a case study listing page markdown. */
function extractCaseStudyUrls(markdown: string, baseUrl: string): string[] {
  // Match markdown links that look like case study URLs
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  const caseStudySegments = ["/case-study/", "/case-studies/", "/customer/", "/customers/", "/success-story/", "/success-stories/", "/cas-client/"];
  const urls: string[] = [];

  let match;
  while ((match = linkPattern.exec(markdown)) !== null) {
    const href = match[2];
    if (caseStudySegments.some((seg) => href.includes(seg))) {
      // Resolve relative URLs
      const fullUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
      if (!urls.includes(fullUrl)) urls.push(fullUrl);
    }
  }

  return urls.slice(0, MAX_INDIVIDUAL_CASE_STUDIES);
}

/** Retry a scrape once after a short delay (for transient Jina failures). */
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

  // Wrap all scraping in a global timeout
  const scrapePromise = async (): Promise<string> => {
    // Homepage is mandatory — fail fast with a clear error
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

    // Scrape individual case study pages (best-effort, up to 3)
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

    // Testimonials page (best-effort)
    onStatus?.("Looking for testimonials page...");
    const testimonials = await scrapeWithFallbacks(baseUrl, TESTIMONIAL_PATHS);

    // Partners / integrations page (best-effort)
    onStatus?.("Looking for partners / integrations page...");
    const partners = await scrapeWithFallbacks(baseUrl, PARTNER_PATHS);

    // Team / leadership page (best-effort — for investors + team extraction)
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

  // Global timeout: 120s. Late pages are best-effort.
  const result = await Promise.race([
    scrapePromise(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Scraping timed out after 120s")), SCRAPE_TIMEOUT_MS),
    ),
  ]);

  return result;
}

// ─── Key normalization (snake_case → camelCase) ──────────

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

// ─── Analysis ────────────────────────────────────────────

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
