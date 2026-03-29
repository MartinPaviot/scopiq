/**
 * Apollo TAM Client -- People Search API for TAM Engine.
 *
 * The free endpoint returns PARTIAL data (obfuscated last names, availability
 * booleans instead of actual values). Full data requires enrichment credits.
 *
 * Endpoint: POST /api/v1/mixed_people/api_search
 * - FREE (no credit consumption)
 * - Returns partial people data (see ApolloSearchPerson)
 * - Max 50,000 results per query (100/page x 500 pages)
 * - Rate limits: Free 50 req/min, 600 req/day
 *
 * @see https://docs.apollo.io/docs/find-people-using-filters
 */

import { z } from "zod/v4";
import { logger } from "@/lib/logger";
import { sleep } from "@/server/lib/connectors/fetch-retry";

// --- Constants ---

const APOLLO_BASE = "https://api.apollo.io";
const SEARCH_PATH = "/api/v1/mixed_people/api_search";
const ORG_SEARCH_PATH = "/api/v1/organizations/search";
const MAX_RETRIES = 3;
const RATE_LIMIT_MS = 1000; // 1 req/sec (per-minute limit is 50)
const MAX_PAGES = 500;
const MAX_PER_PAGE = 100;
const DAILY_LIMIT = parseInt(process.env.APOLLO_DAILY_LIMIT || "600", 10);

// --- Per-Second Rate Limiter ---

let lastCallTime = 0;

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  lastCallTime = Date.now();
}

// --- Daily Rate Limit Tracker ---

let dailyCallCount = 0;
let dailyResetAt = getNextMidnightUTC();

function getNextMidnightUTC(): Date {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

function checkAndResetDaily(): void {
  if (new Date() > dailyResetAt) {
    dailyCallCount = 0;
    dailyResetAt = getNextMidnightUTC();
    logger.info("[apollo-tam] Daily rate limit reset", {
      newResetAt: dailyResetAt.toISOString(),
    });
  }
}

/** Get current rate limit status for UI display. */
export function getRateLimitStatus() {
  checkAndResetDaily();
  return {
    used: dailyCallCount,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - dailyCallCount),
    resetsAt: dailyResetAt,
  };
}

// --- Types ---

export interface ApolloTAMSearchParams {
  person_titles?: string[];
  person_locations?: string[];
  person_seniorities?: string[];
  organization_num_employees_ranges?: string[];
  q_organization_keyword_tags?: string[];
  page?: number;
  per_page?: number;
}

/** What Apollo People Search ACTUALLY returns (partial data). */
export interface ApolloSearchPerson {
  apolloPersonId: string;
  firstName: string;
  lastNameObfuscated: string | null;
  title: string;
  companyName: string;
  hasEmail: boolean;
  hasCity: boolean;
  hasState: boolean;
  hasCountry: boolean;
  hasDirectPhone: boolean;
  orgHasIndustry: boolean;
  orgHasEmployeeCount: boolean;
  orgHasRevenue: boolean;
  apolloRefreshedAt: Date | null;
}

export interface ApolloTAMSearchResult {
  people: ApolloSearchPerson[];
  pagination: {
    totalEntries: number;
    totalPages: number;
    currentPage: number;
    perPage: number;
  };
}

// --- Zod Schemas (match REAL Apollo response) ---

const apolloOrgSearchSchema = z.object({
  name: z.string().nullish(),
  has_industry: z.boolean().nullish(),
  has_employee_count: z.boolean().nullish(),
  has_revenue: z.boolean().nullish(),
  primary_domain: z.string().nullish(),
  industry: z.string().nullish(),
  estimated_num_employees: z.number().nullish(),
  website_url: z.string().nullish(),
  city: z.string().nullish(),
  country: z.string().nullish(),
  id: z.string().nullish(),
});

const apolloPersonSearchSchema = z.object({
  id: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  last_name_obfuscated: z.string().nullish(),
  name: z.string().nullish(),
  title: z.string().nullish(),
  headline: z.string().nullish(),
  seniority: z.string().nullish(),
  linkedin_url: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  has_email: z.boolean().nullish(),
  has_city: z.boolean().nullish(),
  has_state: z.boolean().nullish(),
  has_country: z.boolean().nullish(),
  has_direct_phone: z.union([z.boolean(), z.string()]).nullish(),
  organization: apolloOrgSearchSchema.nullish(),
  organization_id: z.string().nullish(),
  last_refreshed_at: z.string().nullish(),
});

const apolloSearchResponseSchema = z.object({
  people: z.array(apolloPersonSearchSchema),
  total_entries: z.number().optional().default(0),
});

// --- API Key ---

function getApiKey(): string {
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new Error("APOLLO_API_KEY not set in environment");
  return key;
}

// --- Core Fetch with Retry ---

async function apolloFetchWithRetry(
  body: Record<string, unknown>,
  path: string = SEARCH_PATH,
): Promise<unknown> {
  const apiKey = getApiKey();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await enforceRateLimit();

    let res: Response;
    try {
      res = await fetch(`${APOLLO_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn("[apollo-tam] Network error, retrying", { attempt, delay });
        await sleep(delay);
        continue;
      }
      throw new Error(
        `Apollo TAM search failed after ${MAX_RETRIES} retries: ${err instanceof Error ? err.message : "network error"}`,
      );
    }

    if (res.status === 401) throw new Error("Invalid Apollo API key. Check your key in Settings > Integrations.");

    if (res.status === 403) {
      throw new Error(
        "Apollo People Search requires a paid plan (Basic or higher). " +
        "Upgrade at https://app.apollo.io/ to enable TAM building.",
      );
    }

    if (res.status === 422) {
      const text = await res.text().catch(() => "");
      logger.warn("[apollo-tam] Bad search params (422)", { body: text.slice(0, 200) });
      return { people: [], total_entries: 0 };
    }

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const retryAfter = res.headers.get("retry-after");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.pow(2, attempt) * 2000;
        logger.warn("[apollo-tam] Rate limited (429), backing off", { attempt, delay });
        await sleep(delay);
        continue;
      }
      throw new Error("Apollo TAM search rate limited after max retries");
    }

    if (res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn("[apollo-tam] Server error, retrying", { status: res.status, attempt });
        await sleep(delay);
        continue;
      }
      throw new Error(`Apollo TAM search failed with status ${res.status}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Apollo TAM search returned ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json();
  }

  throw new Error(`Apollo TAM search failed after ${MAX_RETRIES} retries`);
}

// --- Transform ---

function transformSearchPerson(
  raw: z.infer<typeof apolloPersonSearchSchema>,
): ApolloSearchPerson {
  let title = raw.title || raw.headline || "";
  const titleParts = title.split(", ");
  if (titleParts.length === 2 && titleParts[0].trim() === titleParts[1].trim()) {
    title = titleParts[0].trim();
  }

  const org = raw.organization;

  return {
    apolloPersonId: raw.id || "",
    firstName: raw.first_name || "",
    lastNameObfuscated: raw.last_name_obfuscated || null,
    title,
    companyName: org?.name || "",
    hasEmail: raw.has_email === true,
    hasCity: raw.has_city === true || !!raw.city,
    hasState: raw.has_state === true || !!raw.state,
    hasCountry: raw.has_country === true || !!raw.country,
    hasDirectPhone: raw.has_direct_phone === "Yes" || raw.has_direct_phone === true,
    orgHasIndustry: org?.has_industry === true || !!org?.industry,
    orgHasEmployeeCount: org?.has_employee_count === true || !!org?.estimated_num_employees,
    orgHasRevenue: org?.has_revenue === true,
    apolloRefreshedAt: raw.last_refreshed_at ? new Date(raw.last_refreshed_at) : null,
  };
}

// --- Public API ---

export async function apolloSearchWithRateLimit(
  params: ApolloTAMSearchParams,
): Promise<ApolloTAMSearchResult> {
  checkAndResetDaily();

  if (dailyCallCount >= DAILY_LIMIT - 10) {
    throw new Error("APOLLO_DAILY_LIMIT_REACHED");
  }

  dailyCallCount++;
  return apolloSearch(params);
}

export async function apolloSearch(
  params: ApolloTAMSearchParams,
): Promise<ApolloTAMSearchResult> {
  const body: Record<string, unknown> = {};

  if (params.person_titles?.length) body.person_titles = params.person_titles;
  if (params.person_locations?.length) body.person_locations = params.person_locations;
  if (params.person_seniorities?.length) body.person_seniorities = params.person_seniorities;
  if (params.organization_num_employees_ranges?.length) {
    body.organization_num_employees_ranges = params.organization_num_employees_ranges;
  }
  if (params.q_organization_keyword_tags?.length) {
    body.q_organization_keyword_tags = params.q_organization_keyword_tags;
  }

  body.page = params.page ?? 1;
  body.per_page = params.per_page ?? MAX_PER_PAGE;

  const raw = await apolloFetchWithRetry(body);

  const rawPeople = (raw as Record<string, unknown>)?.people;
  if (Array.isArray(rawPeople) && rawPeople.length > 0 && params.page === 1) {
    logger.info("[apollo-tam] RAW FIRST PERSON", {
      rawJson: JSON.stringify(rawPeople[0]).slice(0, 2000),
    });
  }

  const parsed = apolloSearchResponseSchema.safeParse(raw);

  if (!parsed.success) {
    logger.warn("[apollo-tam] Response validation failed", {
      error: parsed.error.message.slice(0, 200),
    });
    return {
      people: [],
      pagination: { totalEntries: 0, totalPages: 0, currentPage: 1, perPage: 1 },
    };
  }

  const data = parsed.data;
  const perPage = params.per_page ?? MAX_PER_PAGE;
  const totalEntries = data.total_entries;

  return {
    people: data.people.map(transformSearchPerson),
    pagination: {
      totalEntries,
      totalPages: perPage > 0 ? Math.ceil(totalEntries / perPage) : 0,
      currentPage: params.page ?? 1,
      perPage,
    },
  };
}

export async function apolloCount(
  params: Omit<ApolloTAMSearchParams, "page" | "per_page">,
): Promise<number> {
  const result = await apolloSearch({ ...params, page: 1, per_page: 1 });
  return result.pagination.totalEntries;
}

export async function apolloPaginateAll(
  params: Omit<ApolloTAMSearchParams, "page" | "per_page">,
  onBatch: (people: ApolloSearchPerson[], page: number, totalPages: number) => void | Promise<void>,
): Promise<number> {
  const firstResult = await apolloSearch({ ...params, page: 1, per_page: MAX_PER_PAGE });
  const totalPages = Math.min(firstResult.pagination.totalPages, MAX_PAGES);
  let totalFetched = firstResult.people.length;

  await onBatch(firstResult.people, 1, totalPages);

  if (totalPages <= 1) return totalFetched;

  for (let page = 2; page <= totalPages; page++) {
    const result = await apolloSearch({ ...params, page, per_page: MAX_PER_PAGE });
    if (result.people.length === 0) break;
    totalFetched += result.people.length;
    await onBatch(result.people, page, totalPages);
  }

  logger.info("[apollo-tam] Pagination complete", { totalFetched, totalPages });
  return totalFetched;
}

// ===================================================================
// --- Organization Search (FREE endpoint) ---
// ===================================================================

export interface ApolloOrgSearchParams {
  organization_num_employees_ranges?: string[];
  q_organization_keyword_tags?: string[];
  organization_locations?: string[];
  q_organization_name?: string;
  page?: number;
  per_page?: number;
}

export interface ApolloOrganization {
  apolloOrgId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  foundedYear: number | null;
  city: string | null;
  country: string | null;
  keywords: string[];
  websiteUrl: string | null;
  linkedinUrl: string | null;
}

export interface ApolloOrgSearchResult {
  organizations: ApolloOrganization[];
  pagination: {
    totalEntries: number;
    totalPages: number;
    currentPage: number;
    perPage: number;
  };
}

const apolloOrgResponseItemSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  primary_domain: z.string().nullish(),
  website_url: z.string().nullish(),
  linkedin_url: z.string().nullish(),
  industry: z.string().nullish(),
  estimated_num_employees: z.number().nullish(),
  founded_year: z.number().nullish(),
  city: z.string().nullish(),
  country: z.string().nullish(),
  keywords: z.array(z.string()).nullish(),
});

const apolloOrgSearchResponseSchema = z.object({
  organizations: z.array(apolloOrgResponseItemSchema),
  pagination: z.object({
    total_entries: z.number().default(0),
    total_pages: z.number().default(0),
    page: z.number().default(1),
    per_page: z.number().default(100),
  }).optional(),
});

function transformOrganization(
  raw: z.infer<typeof apolloOrgResponseItemSchema>,
): ApolloOrganization {
  return {
    apolloOrgId: raw.id || "",
    name: raw.name || "",
    domain: raw.primary_domain || null,
    industry: raw.industry || null,
    employeeCount: raw.estimated_num_employees ?? null,
    foundedYear: raw.founded_year ?? null,
    city: raw.city || null,
    country: raw.country || null,
    keywords: raw.keywords ?? [],
    websiteUrl: raw.website_url || null,
    linkedinUrl: raw.linkedin_url || null,
  };
}

export async function apolloOrgSearch(
  params: ApolloOrgSearchParams,
): Promise<ApolloOrgSearchResult> {
  const body: Record<string, unknown> = {};

  if (params.organization_num_employees_ranges?.length) {
    body.organization_num_employees_ranges = params.organization_num_employees_ranges;
  }
  if (params.q_organization_keyword_tags?.length) {
    body.q_organization_keyword_tags = params.q_organization_keyword_tags;
  }
  if (params.organization_locations?.length) {
    body.organization_locations = params.organization_locations;
  }
  if (params.q_organization_name) {
    body.q_organization_name = params.q_organization_name;
  }

  body.page = params.page ?? 1;
  body.per_page = params.per_page ?? MAX_PER_PAGE;

  const raw = await apolloFetchWithRetry(body, ORG_SEARCH_PATH);

  const parsed = apolloOrgSearchResponseSchema.safeParse(raw);

  if (!parsed.success) {
    logger.warn("[apollo-org] Response validation failed", {
      error: parsed.error.message.slice(0, 200),
    });
    return {
      organizations: [],
      pagination: { totalEntries: 0, totalPages: 0, currentPage: 1, perPage: 1 },
    };
  }

  const data = parsed.data;
  const perPage = params.per_page ?? MAX_PER_PAGE;
  const pagination = data.pagination;
  const totalEntries = pagination?.total_entries ?? 0;

  return {
    organizations: data.organizations.map(transformOrganization),
    pagination: {
      totalEntries,
      totalPages: pagination?.total_pages ?? (perPage > 0 ? Math.ceil(totalEntries / perPage) : 0),
      currentPage: params.page ?? 1,
      perPage,
    },
  };
}

export async function apolloOrgSearchWithRateLimit(
  params: ApolloOrgSearchParams,
): Promise<ApolloOrgSearchResult> {
  checkAndResetDaily();

  if (dailyCallCount >= DAILY_LIMIT - 10) {
    throw new Error("APOLLO_DAILY_LIMIT_REACHED");
  }

  dailyCallCount++;
  return apolloOrgSearch(params);
}

export async function apolloOrgCount(
  params: Omit<ApolloOrgSearchParams, "page" | "per_page">,
): Promise<number> {
  const result = await apolloOrgSearch({ ...params, page: 1, per_page: 1 });
  return result.pagination.totalEntries;
}
