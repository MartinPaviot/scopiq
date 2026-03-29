/**
 * Apollo Connector -- People & Company enrichment via Apollo.io API.
 *
 * Endpoints used:
 * - POST /v1/people/match -- Enrich a person by email/domain/name
 * - POST /v1/organizations/enrich -- Enrich a company by domain
 * - GET /v1/auth/health -- Test API key validity
 *
 * API docs: https://apolloio.github.io/apollo-api-docs/
 */

import { z } from "zod/v4";
import { logger } from "@/lib/logger";

const APOLLO_BASE = "https://api.apollo.io";

// --- Types ---

export interface ApolloPersonResult {
  email?: string;
  emailStatus?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  headline?: string;
  linkedinUrl?: string;
  phone?: string;
  city?: string;
  state?: string;
  country?: string;
  organizationName?: string;
  organizationDomain?: string;
  organizationIndustry?: string;
  organizationEmployeeCount?: string;
  organizationRevenue?: string;
  seniority?: string;
  departments?: string[];
}

export interface ApolloOrganizationResult {
  name?: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  estimatedRevenue?: string;
  shortDescription?: string;
  city?: string;
  state?: string;
  country?: string;
  linkedinUrl?: string;
  technologies?: string[];
  keywords?: string[];
  fundingTotal?: number;
  latestFundingRoundDate?: string;
}

// --- Zod schemas for API response validation ---

const apolloPersonSchema = z.object({
  person: z.object({
    email: z.string().nullish(),
    email_status: z.string().nullish(),
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    title: z.string().nullish(),
    headline: z.string().nullish(),
    linkedin_url: z.string().nullish(),
    phone_numbers: z.array(z.object({ raw_number: z.string().nullish() })).nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    country: z.string().nullish(),
    seniority: z.string().nullish(),
    departments: z.array(z.string()).nullish(),
    organization: z.object({
      name: z.string().nullish(),
      primary_domain: z.string().nullish(),
      industry: z.string().nullish(),
      estimated_num_employees: z.number().nullish(),
      annual_revenue_printed: z.string().nullish(),
    }).nullish(),
  }).nullish(),
});

const apolloOrgSchema = z.object({
  organization: z.object({
    name: z.string().nullish(),
    primary_domain: z.string().nullish(),
    industry: z.string().nullish(),
    estimated_num_employees: z.number().nullish(),
    annual_revenue_printed: z.string().nullish(),
    short_description: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    country: z.string().nullish(),
    linkedin_url: z.string().nullish(),
    current_technologies: z.array(z.object({ name: z.string().nullish() })).nullish(),
    keywords: z.array(z.string()).nullish(),
    total_funding: z.number().nullish(),
    latest_funding_round_date: z.string().nullish(),
  }).nullish(),
});

// --- API Helpers ---

async function apolloFetch(
  apiKey: string,
  path: string,
  method: "GET" | "POST" = "POST",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${APOLLO_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apollo API ${path} returned ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// --- Public API ---

export async function testApolloConnection(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${APOLLO_BASE}/v1/auth/health`, {
      method: "GET",
      headers: { "X-Api-Key": apiKey },
    });
    if (res.ok) return true;

    const fallbackRes = await fetch(`${APOLLO_BASE}/v1/people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({ page: 1, per_page: 1 }),
    });
    return fallbackRes.ok;
  } catch {
    return false;
  }
}

export async function enrichPerson(
  apiKey: string,
  params: {
    email?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
    linkedinUrl?: string;
  },
): Promise<ApolloPersonResult | null> {
  try {
    const body: Record<string, unknown> = {};
    if (params.email) body.email = params.email;
    if (params.firstName) body.first_name = params.firstName;
    if (params.lastName) body.last_name = params.lastName;
    if (params.domain) body.domain = params.domain;
    if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl;

    const raw = await apolloFetch(apiKey, "/v1/people/match", "POST", body);
    const parsed = apolloPersonSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.person) return null;

    const p = parsed.data.person;
    const org = p.organization;

    return {
      email: p.email ?? undefined,
      emailStatus: p.email_status ?? undefined,
      firstName: p.first_name ?? undefined,
      lastName: p.last_name ?? undefined,
      title: p.title ?? undefined,
      headline: p.headline ?? undefined,
      linkedinUrl: p.linkedin_url ?? undefined,
      phone: p.phone_numbers?.[0]?.raw_number ?? undefined,
      city: p.city ?? undefined,
      state: p.state ?? undefined,
      country: p.country ?? undefined,
      seniority: p.seniority ?? undefined,
      departments: p.departments ?? undefined,
      organizationName: org?.name ?? undefined,
      organizationDomain: org?.primary_domain ?? undefined,
      organizationIndustry: org?.industry ?? undefined,
      organizationEmployeeCount: org?.estimated_num_employees?.toString() ?? undefined,
      organizationRevenue: org?.annual_revenue_printed ?? undefined,
    };
  } catch (err) {
    logger.warn(`[apollo] Person enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function enrichOrganization(
  apiKey: string,
  domain: string,
): Promise<ApolloOrganizationResult | null> {
  try {
    const res = await fetch(
      `${APOLLO_BASE}/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`,
      {
        method: "GET",
        headers: { "X-Api-Key": apiKey },
      },
    );
    if (!res.ok) return null;

    const json = await res.json();
    const parsed = apolloOrgSchema.safeParse(json);
    if (!parsed.success || !parsed.data.organization) return null;

    const o = parsed.data.organization;

    return {
      name: o.name ?? undefined,
      domain: o.primary_domain ?? undefined,
      industry: o.industry ?? undefined,
      employeeCount: o.estimated_num_employees ?? undefined,
      estimatedRevenue: o.annual_revenue_printed ?? undefined,
      shortDescription: o.short_description ?? undefined,
      city: o.city ?? undefined,
      state: o.state ?? undefined,
      country: o.country ?? undefined,
      linkedinUrl: o.linkedin_url ?? undefined,
      technologies: o.current_technologies?.map((t) => t.name).filter(Boolean) as string[] ?? undefined,
      keywords: o.keywords ?? undefined,
      fundingTotal: o.total_funding ?? undefined,
      latestFundingRoundDate: o.latest_funding_round_date ?? undefined,
    };
  } catch (err) {
    logger.warn(`[apollo] Organization enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// --- API Usage Stats ---

export interface ApolloRateLimitTier {
  limit: number;
  consumed: number;
  leftOver: number;
}

export interface ApolloRateLimitInfo {
  endpoint: string;
  day: ApolloRateLimitTier;
  hour: ApolloRateLimitTier;
  minute: ApolloRateLimitTier;
}

const apolloRateLimitTierSchema = z.object({
  limit: z.number(),
  consumed: z.number(),
  left_over: z.number(),
});

const apolloUsageStatsEntrySchema = z.object({
  day: apolloRateLimitTierSchema,
  hour: apolloRateLimitTierSchema,
  minute: apolloRateLimitTierSchema,
});

export async function getApiUsageStats(
  apiKey: string,
): Promise<Record<string, ApolloRateLimitInfo> | null> {
  try {
    const raw = await apolloFetch(apiKey, "/api/v1/usage_stats/api_usage_stats", "POST");
    const result: Record<string, ApolloRateLimitInfo> = {};

    if (typeof raw !== "object" || raw === null) return null;

    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const parsed = apolloUsageStatsEntrySchema.safeParse(value);
      if (!parsed.success) continue;
      const d = parsed.data;
      result[key] = {
        endpoint: key,
        day: { limit: d.day.limit, consumed: d.day.consumed, leftOver: d.day.left_over },
        hour: { limit: d.hour.limit, consumed: d.hour.consumed, leftOver: d.hour.left_over },
        minute: { limit: d.minute.limit, consumed: d.minute.consumed, leftOver: d.minute.left_over },
      };
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

export function getEnrichmentLimits(
  stats: Record<string, ApolloRateLimitInfo>,
): ApolloRateLimitInfo | null {
  for (const [key, value] of Object.entries(stats)) {
    if (key.includes("people") && key.includes("match")) return value;
  }
  return null;
}

// --- People Search (FREE -- no credits) ---

export interface ApolloSearchPeopleParams {
  person_titles?: string[];
  person_seniorities?: string[];
  person_locations?: string[];
  include_similar_titles?: boolean;
  q_organization_domains_list?: string[];
  organization_locations?: string[];
  organization_num_employees_ranges?: string[];
  q_organization_keyword_tags?: string[];
  contact_email_status?: string[];
  organization_ids?: string[];
  revenue_range?: { min?: number; max?: number };
  currently_using_any_of_technology_uids?: string[];
  currently_using_all_of_technology_uids?: string[];
  currently_not_using_any_of_technology_uids?: string[];
  q_organization_job_titles?: string[];
  organization_job_locations?: string[];
  per_page?: number;
  page?: number;
}

export interface ApolloSearchPerson {
  id?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  title?: string;
  headline?: string;
  linkedinUrl?: string;
  city?: string;
  state?: string;
  country?: string;
  seniority?: string;
  departments?: string[];
  organizationName?: string;
  organizationDomain?: string;
  organizationIndustry?: string;
  organizationEmployeeCount?: number;
}

export interface ApolloSearchResult {
  people: ApolloSearchPerson[];
  totalEntries: number;
  totalPages: number;
  currentPage: number;
  perPage: number;
}

const apolloSearchPersonSchema = z.object({
  id: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  name: z.string().nullish(),
  title: z.string().nullish(),
  headline: z.string().nullish(),
  linkedin_url: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  seniority: z.string().nullish(),
  departments: z.array(z.string()).nullish(),
  organization: z.object({
    name: z.string().nullish(),
    primary_domain: z.string().nullish(),
    industry: z.string().nullish(),
    estimated_num_employees: z.number().nullish(),
  }).nullish(),
});

const apolloSearchResultSchema = z.object({
  people: z.array(apolloSearchPersonSchema),
  total_entries: z.number().optional().default(0),
});

export async function searchPeople(
  apiKey: string,
  params: ApolloSearchPeopleParams,
): Promise<ApolloSearchResult | null> {
  try {
    const body: Record<string, unknown> = {};
    if (params.person_titles?.length) body.person_titles = params.person_titles;
    if (params.person_seniorities?.length) body.person_seniorities = params.person_seniorities;
    if (params.person_locations?.length) body.person_locations = params.person_locations;
    if (params.include_similar_titles !== undefined) body.include_similar_titles = params.include_similar_titles;
    if (params.q_organization_domains_list?.length) body.q_organization_domains_list = params.q_organization_domains_list;
    if (params.organization_locations?.length) body.organization_locations = params.organization_locations;
    if (params.organization_num_employees_ranges?.length) body.organization_num_employees_ranges = params.organization_num_employees_ranges;
    if (params.q_organization_keyword_tags?.length) body.q_organization_keyword_tags = params.q_organization_keyword_tags;
    if (params.contact_email_status?.length) body.contact_email_status = params.contact_email_status;
    if (params.organization_ids?.length) body.organization_ids = params.organization_ids;
    if (params.revenue_range) body.revenue_range = params.revenue_range;
    if (params.currently_using_any_of_technology_uids?.length) body.currently_using_any_of_technology_uids = params.currently_using_any_of_technology_uids;
    if (params.currently_using_all_of_technology_uids?.length) body.currently_using_all_of_technology_uids = params.currently_using_all_of_technology_uids;
    if (params.currently_not_using_any_of_technology_uids?.length) body.currently_not_using_any_of_technology_uids = params.currently_not_using_any_of_technology_uids;
    if (params.q_organization_job_titles?.length) body.q_organization_job_titles = params.q_organization_job_titles;
    if (params.organization_job_locations?.length) body.organization_job_locations = params.organization_job_locations;
    body.per_page = params.per_page ?? 25;
    body.page = params.page ?? 1;

    const raw = await apolloFetch(apiKey, "/api/v1/mixed_people/api_search", "POST", body);
    const parsed = apolloSearchResultSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(`[apollo] People search response validation failed: ${parsed.error.message}`);
      return null;
    }

    const data = parsed.data;
    const perPage = params.per_page ?? 25;
    const totalEntries = data.total_entries;
    return {
      people: data.people.map((p) => ({
        id: p.id ?? undefined,
        firstName: p.first_name ?? undefined,
        lastName: p.last_name ?? undefined,
        name: p.name ?? undefined,
        title: p.title ?? undefined,
        headline: p.headline ?? undefined,
        linkedinUrl: p.linkedin_url ?? undefined,
        city: p.city ?? undefined,
        state: p.state ?? undefined,
        country: p.country ?? undefined,
        seniority: p.seniority ?? undefined,
        departments: p.departments ?? undefined,
        organizationName: p.organization?.name ?? undefined,
        organizationDomain: p.organization?.primary_domain ?? undefined,
        organizationIndustry: p.organization?.industry ?? undefined,
        organizationEmployeeCount: p.organization?.estimated_num_employees ?? undefined,
      })),
      totalEntries,
      totalPages: perPage > 0 ? Math.ceil(totalEntries / perPage) : 0,
      currentPage: params.page ?? 1,
      perPage,
    };
  } catch (err) {
    logger.warn(`[apollo] People search failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
