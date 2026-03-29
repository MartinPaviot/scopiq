/**
 * TAM Engine — Website Scraper.
 *
 * Scrapes key pages of a website to extract structured text content
 * for ICP inference. Uses Jina Reader (project standard) with
 * parallel fetching and content truncation to fit Mistral context.
 *
 * Pages scraped: homepage, /pricing, /about, /customers, /product
 */

import { scrapeViaJina } from "@/server/lib/connectors/jina";
import { logger } from "@/lib/logger";
import { sleep } from "@/server/lib/connectors/fetch-retry";

// ─── Constants ──────────────────────────────────────────

const PAGES_TO_SCRAPE = ["", "/pricing", "/about", "/customers", "/product"];
const MAX_CONTENT_LENGTH = 8_000; // Mistral context budget
const JINA_DELAY_BETWEEN_MS = 3_500; // Respect Jina rate limit (~18 req/min)

// ─── Types ──────────────────────────────────────────────

export interface ScrapedSite {
  url: string;
  content: string;
  pageResults: PageResult[];
  customerLogos: string[];
}

interface PageResult {
  path: string;
  ok: boolean;
  charCount: number;
}

// ─── Main Function ──────────────────────────────────────

/**
 * Scrape key pages of a website and return concatenated text content.
 *
 * - Fetches up to 5 pages via Jina Reader (markdown output)
 * - Extracts customer logos from alt text patterns
 * - Truncates total content to 8,000 chars for LLM context
 * - Gracefully skips pages that 404 or timeout
 */
export async function scrapeSite(siteUrl: string): Promise<ScrapedSite> {
  const baseUrl = normalizeUrl(siteUrl);
  const allContent: string[] = [];
  const pageResults: PageResult[] = [];
  const customerLogos: string[] = [];

  for (const path of PAGES_TO_SCRAPE) {
    const fullUrl = `${baseUrl}${path}`;

    try {
      const result = await scrapeViaJina(fullUrl);

      if (!result.ok) {
        pageResults.push({ path: path || "/", ok: false, charCount: 0 });
        logger.debug("[tam/scrape] Page failed", {
          url: fullUrl,
          reason: result.reason,
        });
      } else {
        const cleaned = cleanMarkdown(result.markdown);
        allContent.push(`--- ${path || "/"} ---\n${cleaned}`);
        pageResults.push({ path: path || "/", ok: true, charCount: cleaned.length });

        // Extract customer logos from markdown image alt text
        const logos = extractLogoNames(result.markdown);
        for (const logo of logos) {
          if (!customerLogos.includes(logo)) {
            customerLogos.push(logo);
          }
        }
      }
    } catch (err) {
      pageResults.push({ path: path || "/", ok: false, charCount: 0 });
      logger.debug("[tam/scrape] Page error", {
        url: fullUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Rate limit between requests
    if (path !== PAGES_TO_SCRAPE[PAGES_TO_SCRAPE.length - 1]) {
      await sleep(JINA_DELAY_BETWEEN_MS);
    }
  }

  const fullContent = allContent.join("\n\n");
  const truncated = fullContent.slice(0, MAX_CONTENT_LENGTH);

  const successCount = pageResults.filter((p) => p.ok).length;
  logger.info("[tam/scrape] Site scraped", {
    url: baseUrl,
    pagesScraped: successCount,
    totalChars: fullContent.length,
    truncatedTo: truncated.length,
    logos: customerLogos.length,
  });

  if (successCount === 0) {
    throw new Error(`Could not scrape any pages from ${baseUrl}`);
  }

  return {
    url: baseUrl,
    content: truncated,
    pageResults,
    customerLogos,
  };
}

// ─── Helpers ────────────────────────────────────────────

function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized.startsWith("http")) {
    normalized = `https://${normalized}`;
  }
  // Remove trailing slash
  return normalized.replace(/\/+$/, "");
}

/**
 * Clean markdown: remove excessive whitespace, navigation boilerplate,
 * and format for LLM consumption.
 */
function cleanMarkdown(md: string): string {
  return (
    md
      // Remove markdown links but keep text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Remove image syntax but keep alt text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "Image: $1")
      // Remove HTML tags that Jina might leave
      .replace(/<[^>]+>/g, "")
      // Collapse multiple newlines
      .replace(/\n{3,}/g, "\n\n")
      // Collapse multiple spaces
      .replace(/ {2,}/g, " ")
      .trim()
  );
}

/**
 * Extract customer/partner logo names from markdown image alt text.
 * Looks for patterns like: ![Stripe logo], ![Customer: Notion], etc.
 */
function extractLogoNames(md: string): string[] {
  const logos: string[] = [];
  // Match image alt text that looks like company names/logos
  const imgPattern = /!\[([^\]]+)\]\([^)]*\)/g;
  let match: RegExpExecArray | null;

  while ((match = imgPattern.exec(md)) !== null) {
    const alt = match[1].trim();
    // Filter: skip generic alts, icons, decorative images
    if (
      alt.length > 1 &&
      alt.length < 50 &&
      !/^(icon|image|photo|banner|hero|bg|background|arrow|check|star|logo$)/i.test(alt)
    ) {
      // Clean common suffixes
      const cleaned = alt
        .replace(/\s*(logo|icon|image)\s*$/i, "")
        .trim();
      if (cleaned.length > 1) {
        logos.push(cleaned);
      }
    }
  }

  return logos;
}
