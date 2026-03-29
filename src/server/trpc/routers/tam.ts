import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "../trpc";
import { inngest } from "@/inngest/client";
import { enrichPerson, searchPeople } from "@/server/lib/connectors/apollo";
import { logger } from "@/lib/logger";

// ─── In-memory cache for filter counts (30s TTL) ────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const filterCountsCache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 30_000;

function getCached<T>(key: string): T | null {
  const entry = filterCountsCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    filterCountsCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  filterCountsCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Helper: format count ───────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ─── Router ─────────────────────────────────────────────

export const tamRouter = router({
  /**
   * Start a new TAM build. Creates TamBuild record + sends Inngest event.
   */
  startBuild: protectedProcedure
    .input(z.object({ siteUrl: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = ctx.workspaceId;

      const tamBuild = await prisma.tamBuild.create({
        data: {
          workspaceId,
          siteUrl: input.siteUrl,
          status: "building",
          phase: "counting",
        },
      });

      // Run TAM build inline (no Inngest dependency for demo reliability)
      // Background: don't await — return immediately, build runs async
      (async () => {
        try {
          // Get ICP
          const icpProfile = await prisma.icpProfile.findFirst({
            where: { workspaceId, isActive: true },
            orderBy: { version: "desc" },
          });

          if (!icpProfile) {
            await prisma.tamBuild.update({ where: { id: tamBuild.id }, data: { status: "failed", phase: "failed", errorMessage: "No ICP found" } });
            return;
          }

          const industries = (icpProfile.industries ?? []) as string[];
          const empRange = (icpProfile.employeeRange ?? { min: 10, max: 10000 }) as { min: number; max: number };
          const geos = (icpProfile.geographies ?? []) as string[];

          const orgFilters = {
            organization_num_employees_ranges: [`${empRange.min},${empRange.max}`],
            q_organization_keyword_tags: industries.slice(0, 5),
            organization_locations: geos.length > 0 ? geos : ["United States"],
          };

          const apiKey = process.env.APOLLO_API_KEY;
          if (!apiKey) {
            await prisma.tamBuild.update({ where: { id: tamBuild.id }, data: { status: "failed", phase: "failed", errorMessage: "APOLLO_API_KEY not set" } });
            return;
          }

          // Count
          const countRes = await fetch("https://api.apollo.io/api/v1/organizations/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey },
            body: JSON.stringify({ ...orgFilters, per_page: 1, page: 1 }),
          });
          const countData = await countRes.json() as { pagination?: { total_entries: number } };
          const totalCount = countData.pagination?.total_entries ?? 0;

          await prisma.tamBuild.update({ where: { id: tamBuild.id }, data: { totalCount, phase: "loading-top" } });

          // Load pages
          const TARGET_PAGES = 5;
          let loaded = 0;
          for (let page = 1; page <= TARGET_PAGES; page++) {
            const res = await fetch("https://api.apollo.io/api/v1/organizations/search", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": apiKey },
              body: JSON.stringify({ ...orgFilters, per_page: 100, page }),
            });
            const data = await res.json() as { organizations?: Array<Record<string, unknown>> };
            const orgs = data.organizations ?? [];
            if (orgs.length === 0) break;

            const accounts = orgs.filter((o) => o.name).map((o) => ({
              workspaceId,
              tamBuildId: tamBuild.id,
              name: String(o.name),
              domain: o.primary_domain ? String(o.primary_domain) : null,
              industry: o.industry ? String(o.industry) : null,
              employeeCount: typeof o.estimated_num_employees === "number" ? o.estimated_num_employees : null,
              foundedYear: typeof o.founded_year === "number" ? o.founded_year : null,
              city: o.city ? String(o.city) : null,
              country: o.country ? String(o.country) : null,
              keywords: Array.isArray(o.keywords) ? o.keywords.map(String) : [],
              websiteUrl: o.website_url ? String(o.website_url) : null,
              linkedinUrl: o.linkedin_url ? String(o.linkedin_url) : null,
              apolloOrgId: o.id ? String(o.id) : null,
            }));

            if (accounts.length > 0) {
              await prisma.tamAccount.createMany({ data: accounts, skipDuplicates: true });
            }
            loaded += accounts.length;
            await prisma.tamBuild.update({ where: { id: tamBuild.id }, data: { loadedCount: loaded } });

            if (orgs.length < 100) break;
            await new Promise((r) => setTimeout(r, 1200)); // Rate limit
          }

          // Score
          await prisma.tamBuild.update({ where: { id: tamBuild.id }, data: { phase: "scoring" } });
          const { scoreAccount } = await import("@/server/lib/tam/account-scorer");
          const icpForScoring = {
            industries,
            employee_ranges: [`${empRange.min},${empRange.max}`],
            geos,
            titles: ((icpProfile.roles ?? []) as Array<{ title: string }>).map((r) => r.title),
            keywords: (icpProfile.keywords ?? []) as string[],
          };

          const unscored = await prisma.tamAccount.findMany({ where: { tamBuildId: tamBuild.id, tier: null }, take: 500 });
          let scored = 0;
          for (const account of unscored) {
            const result = scoreAccount(
              { name: account.name, domain: account.domain, industry: account.industry, employeeCount: account.employeeCount, foundedYear: account.foundedYear, keywords: account.keywords, websiteUrl: account.websiteUrl, linkedinUrl: account.linkedinUrl, city: account.city, country: account.country },
              icpForScoring as Parameters<typeof scoreAccount>[1],
              { hiring: false, funded: false },
            );
            await prisma.tamAccount.update({
              where: { id: account.id },
              data: {
                tier: result.tier, heat: result.heat, heatScore: result.heatScore,
                industryMatch: result.industryMatch, sizeMatch: result.sizeMatch, keywordMatch: result.keywordMatch,
                scoreBreakdown: result.breakdown as unknown as Prisma.InputJsonValue,
                scoreReasoning: result.reasoning,
              },
            });
            scored++;
          }

          await prisma.tamBuild.update({
            where: { id: tamBuild.id },
            data: { status: "complete", phase: "complete", scoredCount: scored, completedAt: new Date() },
          });

          logger.info("[tam/startBuild] Complete", { tamBuildId: tamBuild.id, loaded, scored, totalCount });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("[tam/startBuild] Failed", { tamBuildId: tamBuild.id, error: msg });
          await prisma.tamBuild.update({ where: { id: tamBuild.id }, data: { status: "failed", phase: "failed", errorMessage: msg } }).catch(() => {});
        }
      })();

      return { tamBuildId: tamBuild.id };
    }),

  /**
   * Get the most recent TamBuild for this workspace.
   */
  getLatestBuild: protectedProcedure.query(async ({ ctx }) => {
    const build = await prisma.tamBuild.findFirst({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        phase: true,
        totalCount: true,
        loadedCount: true,
        scoredCount: true,
        topLeadsLoaded: true,
        dailyApiCalls: true,
        segments: true,
        icpRaw: true,
        siteUrl: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    return build;
  }),

  /**
   * Get build status (for polling during build).
   */
  getBuildStatus: protectedProcedure
    .input(z.object({ tamBuildId: z.string() }))
    .query(async ({ ctx, input }) => {
      const build = await prisma.tamBuild.findFirst({
        where: { id: input.tamBuildId, workspaceId: ctx.workspaceId },
        select: {
          status: true,
          phase: true,
          totalCount: true,
          loadedCount: true,
          scoredCount: true,
          segments: true,
          errorMessage: true,
          completedAt: true,
        },
      });

      if (!build) return null;
      return build;
    }),

  /**
   * Get accounts with filtering, search, pagination, and sorting.
   */
  getAccounts: protectedProcedure
    .input(
      z.object({
        tamBuildId: z.string(),
        offset: z.number().default(0),
        limit: z.number().min(1).max(200).default(50),
        tier: z.array(z.string()).optional(),
        heat: z.array(z.string()).optional(),
        industry: z.array(z.string()).optional(),
        country: z.array(z.string()).optional(),
        sizeMin: z.number().optional(),
        sizeMax: z.number().optional(),
        hiringOnly: z.boolean().optional(),
        fundedOnly: z.boolean().optional(),
        search: z.string().optional(),
        sortBy: z.string().default("heatScore"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.TamAccountWhereInput = {
        workspaceId: ctx.workspaceId,
        tamBuildId: input.tamBuildId,
      };

      if (input.tier?.length) {
        where.tier = { in: input.tier };
      }

      if (input.heat?.length) {
        where.heat = { in: input.heat };
      }

      if (input.hiringOnly) {
        where.hiringSignal = true;
      }

      if (input.fundedOnly) {
        where.fundedSignal = true;
      }

      if (input.industry?.length) {
        where.industry = { in: input.industry };
      }

      if (input.country?.length) {
        where.country = { in: input.country };
      }

      if (input.sizeMin != null || input.sizeMax != null) {
        where.employeeCount = {};
        if (input.sizeMin != null) where.employeeCount.gte = input.sizeMin;
        if (input.sizeMax != null) where.employeeCount.lte = input.sizeMax;
      }

      if (input.search) {
        const q = input.search.trim();

        // Smart search: parse natural language patterns into filters
        const hiringMatch = /hiring|recruiting|open roles/i.test(q);
        const fundedMatch = /funded|raised|funding|fundraise|series/i.test(q);
        const sizeSmall = /small|startup|early.?stage|seed/i.test(q);
        const sizeLarge = /enterprise|large|1000\+/i.test(q);
        const tierA = /tier.?a|best|top|perfect fit/i.test(q);
        const burning = /burning|hot|urgent|high.?intent/i.test(q);

        if (hiringMatch || fundedMatch || sizeSmall || sizeLarge || tierA || burning) {
          const smartFilters: Prisma.TamAccountWhereInput[] = [];
          if (hiringMatch) smartFilters.push({ hiringSignal: true });
          if (fundedMatch) smartFilters.push({ fundedSignal: true });
          if (sizeSmall) smartFilters.push({ employeeCount: { lte: 100 } });
          if (sizeLarge) smartFilters.push({ employeeCount: { gte: 1000 } });
          if (tierA) smartFilters.push({ tier: "A" });
          if (burning) smartFilters.push({ heat: { in: ["Burning", "Hot"] } });

          const textTerms = q.replace(/hiring|recruiting|open roles|funded|raised|funding|fundraise|series|small|startup|early.?stage|seed|enterprise|large|1000\+|tier.?a|best|top|perfect fit|burning|hot|urgent|high.?intent/gi, "").trim();
          if (textTerms.length > 1) {
            smartFilters.push({
              OR: [
                { name: { contains: textTerms, mode: "insensitive" } },
                { industry: { contains: textTerms, mode: "insensitive" } },
                { keywords: { has: textTerms.toLowerCase() } },
                { scoreReasoning: { contains: textTerms, mode: "insensitive" } },
              ],
            });
          }

          where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...smartFilters];
        } else {
          where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { domain: { contains: q, mode: "insensitive" } },
            { industry: { contains: q, mode: "insensitive" } },
            { country: { contains: q, mode: "insensitive" } },
            { keywords: { has: q.toLowerCase() } },
            { scoreReasoning: { contains: q, mode: "insensitive" } },
          ];
        }
      }

      // Build orderBy
      const validSortFields = [
        "heatScore", "tier", "name", "employeeCount", "industry", "country", "createdAt",
      ];
      const sortField = validSortFields.includes(input.sortBy) ? input.sortBy : "heatScore";
      const orderBy = { [sortField]: input.sortOrder };

      const [accounts, totalFiltered] = await Promise.all([
        prisma.tamAccount.findMany({
          where,
          orderBy,
          skip: input.offset,
          take: input.limit,
          include: {
            _count: { select: { contacts: true } },
          },
        }),
        prisma.tamAccount.count({ where }),
      ]);

      return {
        accounts: accounts.map((a) => ({
          ...a,
          contactCount: a._count.contacts,
          scoreBreakdown: a.scoreBreakdown as { industryFit: number; sizeFit: number; keywordFit: number; signalScore: number; freshness: number } | null,
          scoreReasoning: a.scoreReasoning,
          scoreSignals: (a.scoreSignals ?? null) as Array<{ signal: string; value: string; source: string; weight: number; category: string }> | null,
          commonInvestors: a.commonInvestors ?? [],
          connectionNames: a.connectionNames ?? [],
        })),
        totalFiltered,
      };
    }),

  /**
   * Get leads for a specific account (contacts loaded on-demand).
   */
  getLeads: protectedProcedure
    .input(
      z.object({
        tamBuildId: z.string(),
        tamAccountId: z.string().optional(),
        offset: z.number().default(0),
        limit: z.number().min(1).max(200).default(50),
        tier: z.array(z.string()).optional(),
        heat: z.array(z.string()).optional(),
        segmentId: z.string().optional(),
        search: z.string().optional(),
        sortBy: z.string().default("heatScore"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.TamLeadWhereInput = {
        workspaceId: ctx.workspaceId,
        tamBuildId: input.tamBuildId,
      };

      if (input.tamAccountId) {
        where.tamAccountId = input.tamAccountId;
      }

      if (input.tier?.length) {
        where.tier = { in: input.tier };
      }

      if (input.heat?.length) {
        where.heat = { in: input.heat };
      }

      if (input.segmentId) {
        where.segmentId = input.segmentId;
      }

      if (input.search) {
        where.OR = [
          { companyName: { contains: input.search, mode: "insensitive" } },
          { firstName: { contains: input.search, mode: "insensitive" } },
          { lastName: { contains: input.search, mode: "insensitive" } },
          { title: { contains: input.search, mode: "insensitive" } },
        ];
      }

      const validSortFields = [
        "heatScore", "tier", "companyName", "title", "country", "createdAt",
      ];
      const sortField = validSortFields.includes(input.sortBy) ? input.sortBy : "heatScore";
      const orderBy = { [sortField]: input.sortOrder };

      const [leads, totalFiltered] = await Promise.all([
        prisma.tamLead.findMany({
          where,
          orderBy,
          skip: input.offset,
          take: input.limit,
        }),
        prisma.tamLead.count({ where }),
      ]);

      return { leads, totalFiltered };
    }),

  /**
   * Get filter counts for the sidebar/pills — account-based.
   * Cached for 30 seconds.
   */
  getFilterCounts: protectedProcedure
    .input(z.object({ tamBuildId: z.string() }))
    .query(async ({ ctx, input }) => {
      const cacheKey = `fc:${input.tamBuildId}`;
      const cached = getCached<ReturnType<typeof buildFilterCounts>>(cacheKey);
      if (cached) return cached;

      const result = await buildFilterCounts(ctx.workspaceId, input.tamBuildId);
      setCache(cacheKey, result);
      return result;
    }),

  /**
   * Get summary stats for dashboard.
   */
  getSummary: protectedProcedure
    .input(z.object({ tamBuildId: z.string() }))
    .query(async ({ ctx, input }) => {
      const build = await prisma.tamBuild.findFirst({
        where: { id: input.tamBuildId, workspaceId: ctx.workspaceId },
        select: {
          totalCount: true,
          loadedCount: true,
          scoredCount: true,
          siteUrl: true,
          completedAt: true,
          status: true,
        },
      });

      if (!build) return null;

      const [tierA, burning] = await Promise.all([
        prisma.tamAccount.count({
          where: { tamBuildId: input.tamBuildId, tier: "A" },
        }),
        prisma.tamAccount.count({
          where: { tamBuildId: input.tamBuildId, heat: "Burning" },
        }),
      ]);

      return {
        ...build,
        tierACount: tierA,
        burningCount: burning,
        totalFormatted: formatCount(build.totalCount ?? 0),
        tierAFormatted: formatCount(tierA),
        burningFormatted: formatCount(burning),
      };
    }),

  /**
   * Trigger background expansion of a TAM build via Inngest.
   * Non-blocking — returns immediately while accounts load in background.
   */
  loadMore: protectedProcedure
    .input(z.object({
      tamBuildId: z.string(),
      pages: z.number().min(1).max(20).default(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const build = await prisma.tamBuild.findFirst({
        where: { id: input.tamBuildId, workspaceId: ctx.workspaceId },
        select: { loadedCount: true, totalCount: true, icpRaw: true, phase: true },
      });

      if (!build) throw new Error("Build not found");
      if (!build.icpRaw) throw new Error("No ICP data — rebuild your TAM first");
      if (build.phase === "expanding") {
        return { status: "already-expanding", loadedCount: build.loadedCount };
      }

      await inngest.send({
        name: "tam/build.expand",
        data: {
          workspaceId: ctx.workspaceId,
          tamBuildId: input.tamBuildId,
          pages: input.pages,
        },
      });

      logger.info("[tam/loadMore] Expansion triggered via Inngest", {
        tamBuildId: input.tamBuildId,
        pages: input.pages,
      });

      return { status: "expanding", loadedCount: build.loadedCount };
    }),

  /**
   * Enrich a single lead via Apollo People Match.
   * Costs 1 Apollo enrichment credit.
   */
  enrichLead: protectedProcedure
    .input(z.object({ leadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const lead = await prisma.tamLead.findFirst({
        where: { id: input.leadId, workspaceId: ctx.workspaceId },
      });

      if (!lead) throw new Error("Lead not found");
      if (lead.enriched) return { status: "already_enriched", lead };
      if (!lead.apolloPersonId) throw new Error("No Apollo person ID — cannot enrich");

      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) {
        throw new Error("Connect your Apollo account or add an API key to enrich leads");
      }

      const result = await enrichPerson(apiKey, {
        firstName: lead.firstName || undefined,
        domain: lead.companyDomain || undefined,
      });

      if (!result) {
        logger.warn("[tam-enrich] Enrichment returned null", { leadId: lead.id });
        return { status: "not_found" };
      }

      const updated = await prisma.tamLead.update({
        where: { id: lead.id },
        data: {
          lastName: result.lastName || lead.lastName,
          email: result.email || null,
          emailRevealed: !!result.email,
          linkedinUrl: result.linkedinUrl || null,
          city: result.city || null,
          state: result.state || null,
          country: result.country || null,
          seniority: result.seniority || null,
          companyDomain: result.organizationDomain || lead.companyDomain,
          companyIndustry: result.organizationIndustry || null,
          companySize: result.organizationEmployeeCount
            ? parseInt(result.organizationEmployeeCount, 10) || null
            : null,
          enriched: true,
          enrichedAt: new Date(),
        },
      });

      return { status: "enriched", lead: updated };
    }),

  /**
   * Get enrichment status for the workspace.
   */
  getEnrichmentStatus: protectedProcedure.query(async ({ ctx }) => {
    const enriched = await prisma.tamLead.count({
      where: { workspaceId: ctx.workspaceId, enriched: true },
    });

    return {
      enrichedCount: enriched,
    };
  }),

  /**
   * Export all filtered accounts as CSV data.
   * Returns all matching accounts (up to 5,000) — not just the visible page.
   */
  exportAccounts: protectedProcedure
    .input(
      z.object({
        tamBuildId: z.string(),
        tier: z.array(z.string()).optional(),
        industry: z.array(z.string()).optional(),
        country: z.array(z.string()).optional(),
        sizeMin: z.number().optional(),
        sizeMax: z.number().optional(),
        hiringOnly: z.boolean().optional(),
        fundedOnly: z.boolean().optional(),
        search: z.string().optional(),
        sortBy: z.string().default("heatScore"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.TamAccountWhereInput = {
        workspaceId: ctx.workspaceId,
        tamBuildId: input.tamBuildId,
      };

      if (input.tier?.length) where.tier = { in: input.tier };
      if (input.industry?.length) where.industry = { in: input.industry };
      if (input.country?.length) where.country = { in: input.country };
      if (input.hiringOnly) where.hiringSignal = true;
      if (input.fundedOnly) where.fundedSignal = true;

      if (input.sizeMin != null || input.sizeMax != null) {
        where.employeeCount = {};
        if (input.sizeMin != null) where.employeeCount.gte = input.sizeMin;
        if (input.sizeMax != null) where.employeeCount.lte = input.sizeMax;
      }

      if (input.search) {
        where.OR = [
          { name: { contains: input.search, mode: "insensitive" } },
          { domain: { contains: input.search, mode: "insensitive" } },
          { industry: { contains: input.search, mode: "insensitive" } },
          { country: { contains: input.search, mode: "insensitive" } },
        ];
      }

      const validSortFields = ["heatScore", "tier", "name", "employeeCount", "industry", "country"];
      const sortField = validSortFields.includes(input.sortBy) ? input.sortBy : "heatScore";

      const accounts = await prisma.tamAccount.findMany({
        where,
        orderBy: { [sortField]: input.sortOrder },
        take: 5_000,
        select: {
          name: true,
          domain: true,
          industry: true,
          employeeCount: true,
          tier: true,
          heat: true,
          heatScore: true,
          country: true,
          city: true,
          websiteUrl: true,
          linkedinUrl: true,
          hiringSignal: true,
          fundedSignal: true,
          keywords: true,
        },
      });

      return { accounts, total: accounts.length };
    }),

  /**
   * Find contacts for a TamAccount via Apollo People Search (FREE — no credits).
   * Creates TamLead records linked to the account.
   * Prioritizes senior decision-makers (VP+, C-suite, Directors).
   */
  findContacts: protectedProcedure
    .input(z.object({
      tamAccountId: z.string(),
      tamBuildId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const account = await prisma.tamAccount.findFirst({
        where: { id: input.tamAccountId, workspaceId: ctx.workspaceId },
        select: { id: true, name: true, domain: true, _count: { select: { contacts: true } } },
      });

      if (!account) throw new Error("Account not found");
      if (!account.domain) throw new Error("No domain — cannot search for contacts");

      // If we already have 3+ contacts, skip
      if (account._count.contacts >= 3) {
        return { status: "already_loaded", count: account._count.contacts };
      }

      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) {
        throw new Error("Connect Apollo in Settings to find contacts");
      }

      // Search for senior decision-makers at this domain
      const result = await searchPeople(apiKey, {
        q_organization_domains_list: [account.domain],
        person_seniorities: ["vp", "c_suite", "director", "founder", "owner"],
        per_page: 5,
        page: 1,
      });

      if (!result) {
        logger.info("[tam/findContacts] No contacts found (API may be limited)", { domain: account.domain });
        return { status: "no_results", count: 0 };
      }

      if (result.people.length === 0) {
        logger.info("[tam/findContacts] No contacts found", { domain: account.domain });
        return { status: "no_results", count: 0 };
      }

      // Create TamLead records, skip duplicates by apolloPersonId
      const existingIds = await prisma.tamLead.findMany({
        where: { tamAccountId: account.id },
        select: { apolloPersonId: true },
      });
      const existingSet = new Set(existingIds.map((l) => l.apolloPersonId).filter(Boolean));

      let created = 0;
      for (const person of result.people) {
        if (person.id && existingSet.has(person.id)) continue;

        await prisma.tamLead.create({
          data: {
            workspaceId: ctx.workspaceId,
            tamBuildId: input.tamBuildId,
            tamAccountId: account.id,
            apolloPersonId: person.id ?? null,
            firstName: person.firstName ?? "Unknown",
            lastName: person.lastName ?? "",
            title: person.title ?? "Unknown",
            linkedinUrl: person.linkedinUrl ?? null,
            city: person.city ?? null,
            state: person.state ?? null,
            country: person.country ?? null,
            seniority: person.seniority ?? null,
            companyName: person.organizationName ?? account.name,
            companyDomain: person.organizationDomain ?? account.domain,
            companyIndustry: person.organizationIndustry ?? null,
            companySize: person.organizationEmployeeCount ?? null,
          },
        });
        created++;
      }

      logger.info("[tam/findContacts] Created contacts", {
        accountId: account.id,
        domain: account.domain,
        found: result.people.length,
        created,
      });

      return { status: "found", count: created, total: account._count.contacts + created };
    }),

  /**
   * Get activity timeline for a TamAccount.
   * Cross-references Leads, EmailPerformance, ReplyThreads by domain.
   */
  getAccountActivity: protectedProcedure
    .input(z.object({ tamAccountId: z.string() }))
    .query(async ({ ctx, input }) => {
      const account = await prisma.tamAccount.findFirst({
        where: { id: input.tamAccountId, workspaceId: ctx.workspaceId },
        select: { domain: true, name: true, createdAt: true },
      });

      if (!account) return { events: [] };

      interface ActivityEvent {
        id: string;
        type: string;
        description: string;
        timestamp: string;
        metadata?: Record<string, string>;
      }

      const events: ActivityEvent[] = [];

      // Account created event
      events.push({
        id: `created-${input.tamAccountId}`,
        type: "signal_detected",
        description: `${account.name} added to your market`,
        timestamp: account.createdAt.toISOString(),
      });

      if (!account.domain) return { events };

      // Find contacts added for this account
      const contacts = await prisma.tamLead.findMany({
        where: { tamAccountId: input.tamAccountId },
        select: { id: true, firstName: true, lastName: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      });

      for (const contact of contacts) {
        const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contact";
        events.push({
          id: `contact-${contact.id}`,
          type: "contact_added",
          description: `${name} discovered`,
          timestamp: contact.createdAt.toISOString(),
        });
      }

      // Sort by timestamp descending
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return { events: events.slice(0, 15) };
    }),

  /**
   * Bulk find contacts for multiple accounts.
   * Triggers findContacts for each account sequentially.
   */
  bulkFindContacts: protectedProcedure
    .input(z.object({
      tamAccountIds: z.array(z.string()).min(1).max(20),
      tamBuildId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) {
        throw new Error("Connect Apollo in Settings to find contacts");
      }

      const accounts = await prisma.tamAccount.findMany({
        where: {
          id: { in: input.tamAccountIds },
          workspaceId: ctx.workspaceId,
          domain: { not: null },
        },
        select: { id: true, domain: true, name: true, _count: { select: { contacts: true } } },
      });

      const toEnrich = accounts.filter((a) => a._count.contacts < 3);
      let found = 0;
      let failed = 0;

      for (const account of toEnrich) {
        if (!account.domain) continue;

        try {
          const result = await searchPeople(apiKey, {
            q_organization_domains_list: [account.domain],
            person_seniorities: ["vp", "c_suite", "director", "founder", "owner", "manager"],
            per_page: 3,
            page: 1,
          });

          if (!result || result.people.length === 0) {
            failed++;
            continue;
          }

          for (const person of result.people) {
            try {
              await prisma.tamLead.create({
                data: {
                  workspaceId: ctx.workspaceId!,
                  tamBuildId: input.tamBuildId,
                  tamAccountId: account.id,
                  apolloPersonId: person.id ?? null,
                  firstName: person.firstName ?? "Unknown",
                  lastName: person.lastName ?? "",
                  title: person.title ?? "Unknown",
                  linkedinUrl: person.linkedinUrl ?? null,
                  city: person.city ?? null,
                  country: person.country ?? null,
                  seniority: person.seniority ?? null,
                  companyName: person.organizationName ?? account.name,
                  companyDomain: person.organizationDomain ?? account.domain,
                },
              });
              found++;
            } catch { /* duplicate */ }
          }
        } catch {
          failed++;
        }
      }

      logger.info("[tam/bulkFindContacts] Complete", {
        requested: input.tamAccountIds.length,
        enriched: toEnrich.length,
        found,
        failed,
      });

      return { found, failed, skipped: accounts.length - toEnrich.length };
    }),

  /**
   * Trigger background signal enrichment for a TAM build.
   * Non-blocking — returns immediately, signals populate in background.
   */
  enrichSignals: protectedProcedure
    .input(z.object({ tamBuildId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const build = await prisma.tamBuild.findFirst({
        where: { id: input.tamBuildId, workspaceId: ctx.workspaceId },
      });
      if (!build) throw new Error("Build not found");

      // Check how many accounts still need enrichment
      const unenriched = await prisma.tamAccount.count({
        where: {
          tamBuildId: input.tamBuildId,
          tier: { in: ["A", "B"] },
          signals: { equals: Prisma.JsonNull },
          domain: { not: null },
        },
      });

      if (unenriched === 0) {
        return { status: "already_enriched", message: "All Tier A/B accounts already have signals" };
      }

      const { inngest: inngestClient } = await import("@/inngest/client");
      await inngestClient.send({
        name: "tam/signals.enrich",
        data: { workspaceId: ctx.workspaceId!, tamBuildId: input.tamBuildId },
      });

      return { status: "started", unenriched };
    }),

  /**
   * Import existing customers (from onboarding CSV step).
   */
  importCustomers: protectedProcedure
    .input(
      z.object({
        customers: z.array(
          z.object({
            companyName: z.string(),
            domain: z.string().nullable(),
            industry: z.string().nullable(),
            employeeCount: z.number().nullable(),
            dealValue: z.number().nullable(),
            country: z.string().nullable(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const importRecord = await prisma.customerImport.create({
        data: {
          workspaceId: ctx.workspaceId!,
          source: "csv",
          fileName: "onboarding-upload.csv",
          rowCount: input.customers.length,
          processedAt: new Date(),
          entries: {
            create: input.customers.map((c) => ({
              companyName: c.companyName,
              domain: c.domain,
              industry: c.industry,
              employeeCount: c.employeeCount,
              dealValue: c.dealValue,
              country: c.country,
            })),
          },
        },
      });

      logger.info("[tam] Customer import from onboarding", {
        workspaceId: ctx.workspaceId,
        importId: importRecord.id,
        count: input.customers.length,
      });

      return { importId: importRecord.id, count: input.customers.length };
    }),

  /**
   * Sync TAM accounts + contacts to HubSpot.
   * Creates/updates Companies by domain, Contacts by email.
   */
  syncToHubspot: protectedProcedure
    .input(z.object({ tamBuildId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { decrypt: decryptKey } = await import("@/lib/encryption");

      const integration = await prisma.integration.findFirst({
        where: { workspaceId: ctx.workspaceId, type: "hubspot", status: "ACTIVE" },
      });

      if (!integration?.accessToken) {
        throw new Error("Connect HubSpot in Settings first");
      }

      const token = decryptKey(integration.accessToken);

      // Load Tier A+B accounts with contacts
      const accounts = await prisma.tamAccount.findMany({
        where: { tamBuildId: input.tamBuildId, tier: { in: ["A", "B"] } },
        include: { contacts: { where: { email: { not: null } } } },
        orderBy: { heatScore: "desc" },
        take: 200,
      });

      let companiesCreated = 0;
      let contactsCreated = 0;
      let skipped = 0;

      for (const account of accounts) {
        if (!account.domain) { skipped++; continue; }

        // Create/update Company
        try {
          const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: account.domain }] }],
            }),
          });
          const searchData = await searchRes.json() as { total: number; results: Array<{ id: string }> };

          if (searchData.total === 0) {
            await fetch("https://api.hubapi.com/crm/v3/objects/companies", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                properties: {
                  name: account.name,
                  domain: account.domain,
                  industry: account.industry ?? "",
                  numberofemployees: String(account.employeeCount ?? ""),
                  city: account.city ?? "",
                  country: account.country ?? "",
                  website: account.websiteUrl ?? "",
                  tam_source: "Scopiq",
                  tam_tier: account.tier ?? "",
                  tam_heat_score: String(account.heatScore),
                },
              }),
            });
            companiesCreated++;
          } else {
            skipped++;
          }
        } catch {
          skipped++;
        }

        // Create contacts
        for (const contact of account.contacts) {
          if (!contact.email) continue;
          try {
            await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                properties: {
                  email: contact.email,
                  firstname: contact.firstName,
                  lastname: contact.lastName,
                  jobtitle: contact.title,
                  company: contact.companyName,
                  tam_source: "Scopiq",
                },
              }),
            });
            contactsCreated++;
          } catch {
            // Duplicate or API error — skip
          }
        }
      }

      logger.info("[tam/syncToHubspot] Complete", {
        companiesCreated,
        contactsCreated,
        skipped,
      });

      return { companiesCreated, contactsCreated, skipped };
    }),

  /**
   * Export TAM to Google Sheets.
   * Creates a new spreadsheet with accounts + contacts data.
   */
  exportToSheets: protectedProcedure
    .input(z.object({ tamBuildId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { decrypt: decryptKey } = await import("@/lib/encryption");

      const integration = await prisma.integration.findFirst({
        where: { workspaceId: ctx.workspaceId, type: "google_sheets", status: "ACTIVE" },
      });

      if (!integration?.accessToken) {
        throw new Error("Connect Google Sheets in Settings first");
      }

      const token = decryptKey(integration.accessToken);

      // Load accounts
      const accounts = await prisma.tamAccount.findMany({
        where: { tamBuildId: input.tamBuildId },
        orderBy: { heatScore: "desc" },
        take: 2000,
        select: {
          name: true, domain: true, industry: true, employeeCount: true,
          tier: true, heat: true, heatScore: true, country: true, city: true,
          websiteUrl: true, linkedinUrl: true, hiringSignal: true, fundedSignal: true,
        },
      });

      // Create spreadsheet
      const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: { title: `Scopiq TAM - ${new Date().toISOString().slice(0, 10)}` },
          sheets: [{ properties: { title: "Accounts" } }],
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`Failed to create sheet: ${err.slice(0, 200)}`);
      }

      const sheet = await createRes.json();
      const spreadsheetId = sheet.spreadsheetId;

      // Write data
      const headers = ["Name", "Domain", "Industry", "Employees", "Tier", "Heat", "Score", "Country", "City", "Website", "LinkedIn", "Hiring", "Funded"];
      const rows = accounts.map((a) => [
        a.name, a.domain ?? "", a.industry ?? "", String(a.employeeCount ?? ""),
        a.tier ?? "", a.heat ?? "", String(a.heatScore),
        a.country ?? "", a.city ?? "", a.websiteUrl ?? "", a.linkedinUrl ?? "",
        a.hiringSignal ? "Yes" : "", a.fundedSignal ? "Yes" : "",
      ]);

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Accounts!A1:append?valueInputOption=RAW`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [headers, ...rows],
        }),
      });

      const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      logger.info("[tam/exportToSheets] Exported", { spreadsheetId, rows: rows.length });

      return { spreadsheetId, url: sheetUrl, rows: rows.length };
    }),
});

// ─── Filter Counts Builder (Account-Based) ──────────────

async function buildFilterCounts(workspaceId: string, tamBuildId: string) {
  const baseWhere = { workspaceId, tamBuildId };

  // Tier counts
  const tierGroups = await prisma.tamAccount.groupBy({
    by: ["tier"],
    where: baseWhere,
    _count: true,
  });

  const tiers: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const g of tierGroups) {
    if (!g.tier) continue;
    const baseTier = g.tier.replace("?", "");
    if (baseTier in tiers) {
      tiers[baseTier] += g._count;
    }
  }

  // Heat counts
  const heatGroups = await prisma.tamAccount.groupBy({
    by: ["heat"],
    where: baseWhere,
    _count: true,
  });

  const heats: Record<string, number> = { Burning: 0, Hot: 0, Warm: 0, Cold: 0 };
  for (const g of heatGroups) {
    if (g.heat && g.heat in heats) {
      heats[g.heat] = g._count;
    }
  }

  // Industry counts
  const industryGroups = await prisma.tamAccount.groupBy({
    by: ["industry"],
    where: { ...baseWhere, industry: { not: null } },
    _count: true,
    orderBy: { _count: { industry: "desc" } },
    take: 20,
  });

  const industries = industryGroups
    .filter((g) => g.industry)
    .map((g) => ({
      name: g.industry!,
      count: g._count,
      countFormatted: formatCount(g._count),
    }));

  // Country counts
  const countryGroups = await prisma.tamAccount.groupBy({
    by: ["country"],
    where: { ...baseWhere, country: { not: null } },
    _count: true,
    orderBy: { _count: { country: "desc" } },
    take: 20,
  });

  const countries = countryGroups
    .filter((g) => g.country)
    .map((g) => ({
      name: g.country!,
      count: g._count,
      countFormatted: formatCount(g._count),
    }));

  // Signal counts
  const [industryMatch, sizeMatch, keywordMatch, hiring, funded] = await Promise.all([
    prisma.tamAccount.count({ where: { ...baseWhere, industryMatch: true } }),
    prisma.tamAccount.count({ where: { ...baseWhere, sizeMatch: true } }),
    prisma.tamAccount.count({ where: { ...baseWhere, keywordMatch: true } }),
    prisma.tamAccount.count({ where: { ...baseWhere, hiringSignal: true } }),
    prisma.tamAccount.count({ where: { ...baseWhere, fundedSignal: true } }),
  ]);

  const [total, withDomain, withLinkedin] = await Promise.all([
    prisma.tamAccount.count({ where: baseWhere }),
    prisma.tamAccount.count({ where: { ...baseWhere, domain: { not: null } } }),
    prisma.tamAccount.count({ where: { ...baseWhere, linkedinUrl: { not: null } } }),
  ]);

  return {
    tiers,
    heats,
    industries,
    countries,
    signals: { industryMatch, sizeMatch, keywordMatch, hiring, funded },
    total,
    totalFormatted: formatCount(total),
    withDomain,
    withLinkedin,
  };
}
