/**
 * Inngest Function — Account-Based TAM Build.
 *
 * V2: Uses Apollo Organization Search (FREE) instead of People Search.
 * Loads companies first, contacts on-demand later.
 *
 * Pipeline:
 *   1. Analyze site (scrape + infer ICP via Mistral)
 *   2. Count orgs (Apollo org count, 1 API call)
 *   3. Load top accounts (5 pages × 100 = 500 accounts, 5 API calls)
 *   4. Score accounts (deterministic: industry + size + keyword + signals)
 *   5. Mark complete
 *
 * Total API calls per build: ~6 (1 count + 5 pages).
 * At 600 calls/day = 100 builds/day without cache.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { inngest } from "./client";
import { scrapeSite } from "@/server/lib/tam/scrape-site";
import { inferTamICP, inferTamICPFromDna, icpToOrgFilters, type TamICP } from "@/server/lib/tam/tam-icp-inferrer";
import { apolloOrgSearchWithRateLimit, apolloOrgCount } from "@/server/lib/apollo/client";
import { searchPeople } from "@/server/lib/connectors/apollo";
import { scoreAccount as scoreAccountMulti } from "@/server/lib/tam/account-scorer";
import { validateTamQuality } from "@/server/lib/tam/tam-quality-validator";
import { icpProfileDataSchema } from "@/server/lib/icp/icp-schema";
import { profileDataToTamIcp } from "@/server/lib/icp/icp-converters";

// ─── Helpers ────────────────────────────────────────────

async function updateBuild(
  tamBuildId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await prisma.tamBuild.update({
    where: { id: tamBuildId },
    data: data as Prisma.TamBuildUpdateInput,
  });
}

async function isCancelled(tamBuildId: string): Promise<boolean> {
  const build = await prisma.tamBuild.findUnique({
    where: { id: tamBuildId },
    select: { status: true },
  });
  return build?.status === "failed";
}

// ─── Inngest Function ───────────────────────────────────

export const buildTam = inngest.createFunction(
  {
    id: "tam-build",
    name: "Build TAM (Account-Based)",
    retries: 2,
    concurrency: { limit: 2 },
    triggers: [{ event: "tam/build.requested" }],
  },
  async ({ event, step }: { event: { data: { workspaceId: string; tamBuildId: string; siteUrl: string } }; step: any }) => {
    const { workspaceId, tamBuildId, siteUrl } = event.data;

    try {

    // ── PHASE 1: ANALYZE ────────────────────────────────
    const icp = await step.run("analyze-site", async () => {
      await updateBuild(tamBuildId, { phase: "analyzing", status: "analyzing" });

      // Check for active IcpProfile first (created during onboarding ICP step)
      const activeProfile = await prisma.icpProfile.findFirst({
        where: { workspaceId, isActive: true },
        orderBy: { version: "desc" },
      });

      if (activeProfile) {
        const parsed = icpProfileDataSchema.safeParse({
          roles: activeProfile.roles,
          industries: activeProfile.industries,
          employeeRange: activeProfile.employeeRange,
          geographies: activeProfile.geographies,
          keywords: activeProfile.keywords,
          buyingSignals: activeProfile.buyingSignals,
          disqualifiers: activeProfile.disqualifiers,
          competitors: activeProfile.competitors,
          segments: activeProfile.segments,
          negativeIcp: activeProfile.negativeIcp,
          confidence: activeProfile.confidence,
          customerPatterns: activeProfile.customerPatterns,
          nlDescription: activeProfile.nlDescription,
          acv: activeProfile.acv,
          salesCycleLength: activeProfile.salesCycleLength,
          winReasons: activeProfile.winReasons,
          lossReasons: activeProfile.lossReasons,
        });

        if (parsed.success) {
          const tamIcp = profileDataToTamIcp(parsed.data);
          logger.info("[tam-build] Using active IcpProfile for TAM build", {
            tamBuildId,
            version: activeProfile.version,
          });
          await prisma.tamBuild.update({
            where: { id: tamBuildId },
            data: {
              icpRaw: tamIcp as unknown as Prisma.InputJsonValue,
              siteUrl,
            },
          });
          return tamIcp;
        }
      }

      // Fallback: existing CompanyDna-based inference
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { companyDna: true },
      });

      let inferredIcp: TamICP;

      if (workspace?.companyDna && typeof workspace.companyDna === "object") {
        // Load existing customer data to ground ICP in reality
        const customerEntries = await prisma.customerImportEntry.findMany({
          where: { import: { workspaceId } },
          take: 50,
          orderBy: { import: { createdAt: "desc" } },
        });
        const existingCustomers = customerEntries.length > 0
          ? customerEntries.map((e) => ({
              companyName: e.companyName,
              domain: e.domain ?? undefined,
              industry: e.industry ?? undefined,
              employeeCount: e.employeeCount ?? undefined,
              dealValue: e.dealValue ?? undefined,
              country: e.country ?? undefined,
            }))
          : undefined;

        logger.info("[tam-build] Using existing Company DNA for ICP inference", {
          tamBuildId,
          customerCount: existingCustomers?.length ?? 0,
        });
        inferredIcp = await inferTamICPFromDna(
          siteUrl,
          workspace.companyDna as Record<string, unknown>,
          workspaceId,
          existingCustomers,
        );

        await prisma.tamBuild.update({
          where: { id: tamBuildId },
          data: {
            icpRaw: inferredIcp as unknown as Prisma.InputJsonValue,
            siteUrl,
          },
        });
      } else {
        logger.info("[tam-build] No Company DNA found, scraping site", { tamBuildId });
        const scraped = await scrapeSite(siteUrl);
        inferredIcp = await inferTamICP(siteUrl, scraped.content, workspaceId);

        await prisma.tamBuild.update({
          where: { id: tamBuildId },
          data: {
            icpRaw: inferredIcp as unknown as Prisma.InputJsonValue,
            siteContent: scraped.content,
            siteUrl: scraped.url,
          },
        });
      }

      logger.info("[tam-build] Phase 1 complete: ICP inferred", {
        tamBuildId,
        industries: inferredIcp.industries,
        segments: inferredIcp.segments.length,
        source: workspace?.companyDna ? "company-dna" : "scrape",
      });

      return inferredIcp;
    });

    // ── PHASE 2: COUNT ORGANIZATIONS ─────────────────────
    const totalCount = await step.run("count-orgs", async () => {
      await updateBuild(tamBuildId, { phase: "counting", status: "counting" });

      let icpData = icp;
      if (!icpData?.industries?.length) {
        const build = await prisma.tamBuild.findUniqueOrThrow({
          where: { id: tamBuildId },
          select: { icpRaw: true },
        });
        icpData = build.icpRaw as unknown as TamICP;
      }

      const filters = icpToOrgFilters(icpData);
      const total = await apolloOrgCount(filters);

      await prisma.tamBuild.update({
        where: { id: tamBuildId },
        data: { totalCount: total },
      });

      logger.info("[tam-build] Phase 2 complete: Org count", {
        tamBuildId,
        total,
      });

      return total;
    });

    // ── PHASE 3: LOAD TOP ACCOUNTS ──────────────────────
    await step.run("load-top-accounts", async () => {
      await updateBuild(tamBuildId, { phase: "loading-top", status: "building" });

      let icpData = icp;
      if (!icpData?.industries?.length) {
        const build = await prisma.tamBuild.findUniqueOrThrow({
          where: { id: tamBuildId },
          select: { icpRaw: true },
        });
        icpData = build.icpRaw as unknown as TamICP;
      }

      const filters = icpToOrgFilters(icpData);
      const TARGET_PAGES = 20; // 20 × 100 = 2,000 accounts max (free Apollo org search)
      const PER_PAGE = 100;
      let loaded = 0;

      for (let page = 1; page <= TARGET_PAGES; page++) {
        if (await isCancelled(tamBuildId)) {
          logger.info("[tam-build] Build cancelled", { tamBuildId });
          return;
        }

        try {
          const result = await apolloOrgSearchWithRateLimit({
            ...filters,
            page,
            per_page: PER_PAGE,
          });

          if (result.organizations.length === 0) break;

          const accounts = result.organizations
            .filter((org) => org.name)
            .map((org) => ({
              workspaceId,
              tamBuildId,
              name: org.name,
              domain: org.domain,
              industry: org.industry,
              employeeCount: org.employeeCount,
              foundedYear: org.foundedYear,
              city: org.city,
              country: org.country,
              keywords: org.keywords,
              websiteUrl: org.websiteUrl,
              linkedinUrl: org.linkedinUrl,
              apolloOrgId: org.apolloOrgId || null,
            }));

          if (accounts.length > 0) {
            await prisma.tamAccount.createMany({
              data: accounts,
              skipDuplicates: true,
            });
          }

          loaded += accounts.length;
          await updateBuild(tamBuildId, { loadedCount: loaded });

          // Stop early if this page was incomplete
          if (result.organizations.length < PER_PAGE) break;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === "APOLLO_DAILY_LIMIT_REACHED") {
            await updateBuild(tamBuildId, {
              phase: "rate-limited",
              dailyApiCalls: loaded,
            });
            logger.warn("[tam-build] Daily limit reached during account load", {
              tamBuildId,
              loaded,
            });
            throw err;
          }
          throw err;
        }
      }

      logger.info("[tam-build] Top accounts loaded", { tamBuildId, loaded });
    });

    // ── PHASE 4: SCORE ACCOUNTS ─────────────────────────
    await step.run("score-accounts", async () => {
      await updateBuild(tamBuildId, { phase: "scoring", status: "scoring" });

      const build = await prisma.tamBuild.findUniqueOrThrow({
        where: { id: tamBuildId },
        select: { icpRaw: true },
      });
      const icpForScoring = build.icpRaw as unknown as TamICP;

      const BATCH_SIZE = 200;
      let cursor: string | undefined;
      let scored = 0;

      while (true) {
        const accounts = await prisma.tamAccount.findMany({
          where: { tamBuildId, tier: null },
          take: BATCH_SIZE,
          orderBy: { id: "asc" },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        if (accounts.length === 0) break;

        for (const account of accounts) {
          const result = scoreAccountMulti(
            {
              name: account.name,
              domain: account.domain,
              industry: account.industry,
              employeeCount: account.employeeCount,
              foundedYear: account.foundedYear,
              keywords: account.keywords,
              websiteUrl: account.websiteUrl,
              linkedinUrl: account.linkedinUrl,
              city: account.city,
              country: account.country,
            },
            icpForScoring,
            {
              hiring: account.hiringSignal,
              funded: account.fundedSignal,
            },
          );

          await prisma.tamAccount.update({
            where: { id: account.id },
            data: {
              tier: result.tier,
              heat: result.heat,
              heatScore: result.heatScore,
              industryMatch: result.industryMatch,
              sizeMatch: result.sizeMatch,
              keywordMatch: result.keywordMatch,
              scoreBreakdown: result.breakdown as unknown as Prisma.InputJsonValue,
              scoreReasoning: result.reasoning,
              scoreSignals: result.scoreSignals as unknown as Prisma.InputJsonValue,
            },
          });
        }

        scored += accounts.length;
        cursor = accounts[accounts.length - 1].id;

        await updateBuild(tamBuildId, { scoredCount: scored });
      }

      logger.info("[tam-build] Account scoring complete", { tamBuildId, scored });
    });

    // ── PHASE 5: QUALITY VALIDATION ─────────────────────
    await step.run("validate-quality", async () => {
      const build = await prisma.tamBuild.findUniqueOrThrow({
        where: { id: tamBuildId },
        select: { icpRaw: true, siteUrl: true, totalCount: true, loadedCount: true },
      });
      const icpData = build.icpRaw as unknown as TamICP;

      // Gather stats for validation
      const tierGroups = await prisma.tamAccount.groupBy({
        by: ["tier"], where: { tamBuildId }, _count: true,
      });
      const tierCounts = { A: 0, B: 0, C: 0, D: 0 };
      for (const g of tierGroups) {
        if (g.tier && g.tier in tierCounts) tierCounts[g.tier as keyof typeof tierCounts] = g._count;
      }

      const topA = await prisma.tamAccount.findMany({
        where: { tamBuildId, tier: "A" },
        orderBy: { heatScore: "desc" },
        take: 10,
        select: { name: true, industry: true, employeeCount: true },
      });

      const industryGroups = await prisma.tamAccount.groupBy({
        by: ["industry"], where: { tamBuildId, industry: { not: null } },
        _count: true, orderBy: { _count: { industry: "desc" } }, take: 8,
      });

      const sizeStats = {
        under50: await prisma.tamAccount.count({ where: { tamBuildId, employeeCount: { lte: 50 } } }),
        from50to200: await prisma.tamAccount.count({ where: { tamBuildId, employeeCount: { gt: 50, lte: 200 } } }),
        from200to1000: await prisma.tamAccount.count({ where: { tamBuildId, employeeCount: { gt: 200, lte: 1000 } } }),
        over1000: await prisma.tamAccount.count({ where: { tamBuildId, employeeCount: { gt: 1000 } } }),
      };

      const geoGroups = await prisma.tamAccount.groupBy({
        by: ["country"], where: { tamBuildId, country: { not: null } },
        _count: true, orderBy: { _count: { country: "desc" } }, take: 5,
      });

      const report = await validateTamQuality({
        siteUrl: build.siteUrl ?? "",
        productSummary: icpData.product_summary ?? "",
        icpSummary: `Industries: ${icpData.industries?.join(", ")}. Sizes: ${icpData.employee_ranges?.join(", ")}. Geos: ${icpData.geos?.join(", ")}`,
        totalAccounts: build.loadedCount ?? 0,
        tierCounts,
        topTierA: topA,
        industryBreakdown: industryGroups.map((g) => ({ name: g.industry!, count: g._count })),
        sizeBreakdown: sizeStats,
        geoBreakdown: geoGroups.map((g) => ({ name: g.country!, count: g._count })),
      }, workspaceId);

      // Store quality report (field added to schema, may need prisma generate)
      await prisma.$executeRaw`UPDATE tam_build SET "qualityReport" = ${JSON.stringify(report)}::jsonb WHERE id = ${tamBuildId}`;

      logger.info("[tam-build] Quality validation complete", {
        tamBuildId,
        overallScore: report.overall_score,
        issues: report.issues.length,
      });
    });

    // ── PHASE 5b: CONTACT SUGGESTIONS (top A/B accounts) ──
    await step.run("load-contacts", async () => {
      const apolloKey = process.env.APOLLO_API_KEY;
      if (!apolloKey) {
        logger.warn("[tam-build] No APOLLO_API_KEY, skipping contact suggestions");
        return;
      }

      // Get ICP titles for filtering
      const build = await prisma.tamBuild.findUniqueOrThrow({
        where: { id: tamBuildId },
        select: { icpRaw: true },
      });
      const icpData = build.icpRaw as unknown as TamICP;
      const icpTitles = icpData?.titles ?? [];
      if (icpTitles.length === 0) return;

      // Top 50 Tier A/B accounts without contacts loaded yet
      const topAccounts = await prisma.tamAccount.findMany({
        where: {
          tamBuildId,
          tier: { in: ["A", "B"] },
          contactsLoaded: false,
          domain: { not: null },
        },
        orderBy: { heatScore: "desc" },
        take: 50,
        select: { id: true, domain: true, name: true },
      });

      if (topAccounts.length === 0) return;

      let totalContacts = 0;
      for (const account of topAccounts) {
        if (!account.domain) continue;

        try {
          const result = await searchPeople(apolloKey, {
            q_organization_domains_list: [account.domain],
            person_titles: icpTitles,
            per_page: 3,
            page: 1,
          });

          const people = result?.people ?? [];
          if (people.length === 0) {
            await prisma.tamAccount.update({
              where: { id: account.id },
              data: { contactsLoaded: true, contactCount: 0 },
            });
            continue;
          }

          // Create TamLead records for suggested contacts
          for (const person of people) {
            const dedupKey = `${person.firstName ?? ""}-${person.lastName ?? ""}-${account.domain}`.toLowerCase();
            try {
              await prisma.tamLead.upsert({
                where: {
                  workspaceId_dedupKey: { workspaceId, dedupKey },
                },
                create: {
                  workspaceId,
                  tamBuildId,
                  tamAccountId: account.id,
                  firstName: person.firstName ?? "",
                  lastName: person.lastName ?? "",
                  title: person.title ?? "Unknown",
                  seniority: person.seniority ?? null,
                  linkedinUrl: person.linkedinUrl ?? null,
                  city: person.city ?? null,
                  country: person.country ?? null,
                  companyName: person.organizationName ?? account.name,
                  companyDomain: account.domain,
                  companyIndustry: person.organizationIndustry ?? null,
                  companySize: person.organizationEmployeeCount ?? null,
                  apolloPersonId: person.id ?? null,
                  dedupKey,
                  status: "suggested",
                  hasEmail: false,
                  email: null,
                  emailRevealed: false,
                },
                update: {
                  tamAccountId: account.id,
                  title: person.title ?? "Unknown",
                },
              });
            } catch {
              // Dedup conflict — skip
            }
          }

          await prisma.tamAccount.update({
            where: { id: account.id },
            data: { contactsLoaded: true, contactCount: people.length },
          });

          totalContacts += people.length;
        } catch (err) {
          logger.warn("[tam-build] Contact search failed for account", {
            accountId: account.id,
            domain: account.domain,
            error: err instanceof Error ? err.message : String(err),
          });
          // Mark as loaded so we don't retry endlessly
          await prisma.tamAccount.update({
            where: { id: account.id },
            data: { contactsLoaded: true },
          });
        }
      }

      logger.info("[tam-build] Contact suggestions loaded", {
        tamBuildId,
        accounts: topAccounts.length,
        totalContacts,
      });
    });

    // ── PHASE 6: COMPLETE + AUTO-EXPAND ─────────────────
    const shouldExpand = await step.run("complete", async () => {
      const scoredCount = await prisma.tamAccount.count({
        where: { tamBuildId, tier: { not: null } },
      });

      const build = await prisma.tamBuild.findUniqueOrThrow({
        where: { id: tamBuildId },
        select: { loadedCount: true, totalCount: true },
      });

      await prisma.tamBuild.update({
        where: { id: tamBuildId },
        data: {
          phase: "complete",
          status: "complete",
          scoredCount,
          completedAt: new Date(),
        },
      });

      const remaining = (build.totalCount ?? 0) - (build.loadedCount ?? 0);
      logger.info("[tam-build] TAM build complete", {
        tamBuildId,
        scoredCount,
        loaded: build.loadedCount,
        total: build.totalCount,
        remaining,
      });

      // Auto-expand if we loaded less than total and there's room in daily limit
      return remaining > 0;
    });

    // Auto-trigger background expansion for remaining accounts
    if (shouldExpand) {
      await step.run("auto-expand", async () => {
        await inngest.send({
          name: "tam/build.expand",
          data: {
            workspaceId,
            tamBuildId,
            pages: 20, // Load 20 more pages = 2,000 more accounts
          },
        });
        logger.info("[tam-build] Auto-expansion triggered", { tamBuildId });
      });
    }

    // Trigger signal enrichment for Tier A accounts (background, non-blocking)
    await step.run("trigger-signal-enrichment", async () => {
      await inngest.send({
        name: "tam/signals.enrich",
        data: { workspaceId, tamBuildId },
      });
      logger.info("[tam-build] Signal enrichment triggered", { tamBuildId });
    });

    return { tamBuildId, status: "complete" };

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (message === "APOLLO_DAILY_LIMIT_REACHED") {
        await updateBuild(tamBuildId, {
          status: "rate-limited",
          phase: "rate-limited",
          errorMessage: "Apollo daily API limit reached. Build will resume tomorrow.",
        });
        logger.warn("[tam-build] Rate limited, will resume", { tamBuildId });
        return { tamBuildId, status: "rate-limited" };
      }

      await updateBuild(tamBuildId, {
        status: "failed",
        phase: "failed",
        errorMessage: message,
      }).catch((updateErr) => {
        logger.error("[tam-build] Failed to update build status", {
          tamBuildId,
          updateError: updateErr instanceof Error ? updateErr.message : String(updateErr),
        });
      });

      logger.error("[tam-build] Build failed", { tamBuildId, error: message });
      throw err;
    }
  },
);

// ─── EXPAND: Load more accounts in background ──────────

export const expandTam = inngest.createFunction(
  {
    id: "tam-expand",
    name: "Expand TAM (Load More Accounts)",
    retries: 1,
    concurrency: { limit: 2 },
    triggers: [{ event: "tam/build.expand" }],
  },
  async ({ event, step }: { event: { data: { workspaceId: string; tamBuildId: string; pages: number } }; step: any }) => {
    const { workspaceId, tamBuildId, pages: targetPages } = event.data;

    const build = await prisma.tamBuild.findFirst({
      where: { id: tamBuildId, workspaceId },
      select: { loadedCount: true, totalCount: true, icpRaw: true, phase: true },
    });

    if (!build || !build.icpRaw) {
      logger.warn("[tam-expand] Build not found or no ICP", { tamBuildId });
      return { tamBuildId, status: "skipped" };
    }

    // Mark as expanding
    await updateBuild(tamBuildId, { phase: "expanding" });

    const loaded = await step.run("load-more-pages", async () => {
      const icpData = build.icpRaw as unknown as TamICP;
      const filters = icpToOrgFilters(icpData);
      const startPage = Math.ceil(build.loadedCount / 100) + 1;
      let newLoaded = 0;

      for (let page = startPage; page < startPage + targetPages; page++) {
        try {
          const result = await apolloOrgSearchWithRateLimit({
            ...filters,
            page,
            per_page: 100,
          });

          if (result.organizations.length === 0) break;

          const accounts = result.organizations
            .filter((org) => org.name)
            .map((org) => ({
              workspaceId,
              tamBuildId,
              name: org.name,
              domain: org.domain,
              industry: org.industry,
              employeeCount: org.employeeCount,
              foundedYear: org.foundedYear,
              city: org.city,
              country: org.country,
              keywords: org.keywords,
              websiteUrl: org.websiteUrl,
              linkedinUrl: org.linkedinUrl,
              apolloOrgId: org.apolloOrgId || null,
            }));

          if (accounts.length > 0) {
            await prisma.tamAccount.createMany({ data: accounts, skipDuplicates: true });
          }

          newLoaded += accounts.length;
          await updateBuild(tamBuildId, { loadedCount: build.loadedCount + newLoaded });

          if (result.organizations.length < 100) break;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === "APOLLO_DAILY_LIMIT_REACHED") {
            await updateBuild(tamBuildId, { phase: "rate-limited" });
            logger.warn("[tam-expand] Rate limited during expansion", { tamBuildId, newLoaded });
            return newLoaded;
          }
          throw err;
        }
      }

      return newLoaded;
    });

    // Score new accounts
    await step.run("score-new-accounts", async () => {
      const icpForScoring = build.icpRaw as unknown as TamICP;

      const unscored = await prisma.tamAccount.findMany({
        where: { tamBuildId, tier: null },
      });

      for (const account of unscored) {
        const result = scoreAccountMulti(
          {
            name: account.name,
            domain: account.domain,
            industry: account.industry,
            employeeCount: account.employeeCount,
            foundedYear: account.foundedYear,
            keywords: account.keywords,
            websiteUrl: account.websiteUrl,
            linkedinUrl: account.linkedinUrl,
            city: account.city,
            country: account.country,
          },
          icpForScoring,
          {
            hiring: account.hiringSignal,
            funded: account.fundedSignal,
          },
        );
        await prisma.tamAccount.update({
          where: { id: account.id },
          data: {
            tier: result.tier,
            heat: result.heat,
            heatScore: result.heatScore,
            industryMatch: result.industryMatch,
            sizeMatch: result.sizeMatch,
            keywordMatch: result.keywordMatch,
            scoreBreakdown: result.breakdown as unknown as Prisma.InputJsonValue,
            scoreReasoning: result.reasoning,
            scoreSignals: result.scoreSignals as unknown as Prisma.InputJsonValue,
          },
        });
      }

      logger.info("[tam-expand] Scored new accounts", { tamBuildId, scored: unscored.length });
    });

    // Mark complete again
    const finalCount = await prisma.tamAccount.count({ where: { tamBuildId } });
    await updateBuild(tamBuildId, {
      phase: "complete",
      loadedCount: finalCount,
      scoredCount: finalCount,
    });

    logger.info("[tam-expand] Expansion complete", { tamBuildId, loaded, totalNow: finalCount });
    return { tamBuildId, status: "complete", loaded, totalNow: finalCount };
  },
);

// ─── BACKGROUND: Signal Enrichment ─────────────────────
// Runs after TAM build completes. Detects hiring/funding signals
// for Tier A+B accounts via Jina scraping + heuristics.
// Non-blocking — the market page works without signals.

export const enrichSignals = inngest.createFunction(
  {
    id: "tam-signal-enrichment",
    name: "TAM Signal Enrichment",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ event: "tam/signals.enrich" }],
  },
  async ({ event, step }: { event: { data: { workspaceId: string; tamBuildId: string } }; step: any }) => {
    const { workspaceId, tamBuildId } = event.data;

    // Only enrich Tier A + B accounts (highest value)
    const accounts = await step.run("load-accounts", async () => {
      return prisma.tamAccount.findMany({
        where: {
          tamBuildId,
          tier: { in: ["A", "B"] },
          signals: { equals: Prisma.JsonNull }, // Not yet enriched
          domain: { not: null },
        },
        select: { id: true, domain: true, name: true },
        orderBy: { heatScore: "desc" },
        take: 50, // Max 50 accounts per run to stay within Jina rate limits
      });
    });

    if (accounts.length === 0) {
      logger.info("[tam-signals] No accounts to enrich", { tamBuildId });
      return { enriched: 0 };
    }

    // Import signal detectors dynamically to avoid loading Jina at module scope
    const { detectAllSignals } = await import("@/server/lib/tam/detect-signals");

    let enriched = 0;
    const BATCH_SIZE = 5; // 5 at a time to respect Jina rate limits (20/min)

    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);

      await step.run(`enrich-batch-${i}`, async () => {
        for (const account of batch) {
          if (!account.domain) continue;

          try {
            const signals = await detectAllSignals(account.domain);

            const hiringSignal = signals.some((s) => s.name === "Hiring Outbound" && s.detected);
            const fundedSignal = signals.some((s) => s.name === "Recent Funding" && s.detected);

            await prisma.tamAccount.update({
              where: { id: account.id },
              data: {
                hiringSignal,
                fundedSignal,
                signals: signals as unknown as Prisma.InputJsonValue,
              },
            });

            enriched++;
          } catch (err) {
            logger.warn("[tam-signals] Signal detection failed for account", {
              accountId: account.id,
              domain: account.domain,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      });
    }

    // Re-score enriched accounts to reflect new signals
    if (enriched > 0) {
      await step.run("rescore-enriched", async () => {
        const build = await prisma.tamBuild.findUniqueOrThrow({
          where: { id: tamBuildId },
          select: { icpRaw: true },
        });
        const icpForScoring = build.icpRaw as unknown as TamICP;

        const enrichedAccounts = await prisma.tamAccount.findMany({
          where: { tamBuildId, signals: { not: Prisma.JsonNull } },
        });

        for (const account of enrichedAccounts) {
          const result = scoreAccountMulti(
            {
              name: account.name,
              domain: account.domain,
              industry: account.industry,
              employeeCount: account.employeeCount,
              foundedYear: account.foundedYear,
              keywords: account.keywords,
              websiteUrl: account.websiteUrl,
              linkedinUrl: account.linkedinUrl,
              city: account.city,
              country: account.country,
            },
            icpForScoring,
            {
              hiring: account.hiringSignal,
              funded: account.fundedSignal,
            },
          );

          await prisma.tamAccount.update({
            where: { id: account.id },
            data: {
              tier: result.tier,
              heat: result.heat,
              heatScore: result.heatScore,
              scoreBreakdown: result.breakdown as unknown as Prisma.InputJsonValue,
              scoreReasoning: result.reasoning,
              scoreSignals: result.scoreSignals as unknown as Prisma.InputJsonValue,
            },
          });
        }

        logger.info("[tam-signals] Re-scored enriched accounts", { tamBuildId, count: enrichedAccounts.length });
      });
    }

    logger.info("[tam-signals] Signal enrichment complete", { tamBuildId, enriched, total: accounts.length });
    return { enriched, total: accounts.length };
  },
);

// ─── CRON: Weekly Signal Refresh ────────────────────────
// Re-detect signals for all active TAM builds (Tier A/B accounts).
// Runs every Monday at 06:00 UTC.

export const weeklySignalRefresh = inngest.createFunction(
  {
    id: "weekly-signal-refresh",
    name: "Weekly Signal Refresh",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ cron: "0 6 * * 1" }], // Monday 06:00 UTC
  },
  async () => {
    // Find all active TAM builds (most recent per workspace)
    const latestBuilds = await prisma.tamBuild.findMany({
      where: { status: "complete" },
      orderBy: { createdAt: "desc" },
      distinct: ["workspaceId"],
      select: { id: true, workspaceId: true },
    });

    let triggered = 0;
    for (const build of latestBuilds) {
      // Reset signals for Tier A/B to re-detect
      await prisma.tamAccount.updateMany({
        where: {
          tamBuildId: build.id,
          tier: { in: ["A", "B"] },
        },
        data: { signals: Prisma.DbNull },
      });

      await inngest.send({
        name: "tam/signals.enrich",
        data: { workspaceId: build.workspaceId, tamBuildId: build.id },
      });
      triggered++;
    }

    logger.info("[tam-cron] Weekly signal refresh triggered", { builds: triggered });
    return { triggered };
  },
);

// ─── CRON: LinkedIn Connection Sync (Weekly) ────────────

export const linkedInConnectionSync = inngest.createFunction(
  {
    id: "linkedin-connection-sync",
    name: "LinkedIn Connection Sync",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ cron: "0 5 * * 0" }], // Sunday 05:00 UTC
  },
  async () => {
    // Find workspaces with active LinkedIn integration
    const integrations = await prisma.integration.findMany({
      where: { type: "LINKEDIN", status: "ACTIVE", apiKey: { not: null } },
      select: { workspaceId: true, apiKey: true },
    });

    if (integrations.length === 0) return { synced: 0 };

    const { decrypt } = await import("@/lib/encryption");
    const { fetchLinkedInConnections, extractCompanyFromHeadline } = await import("@/server/lib/connectors/linkedin-connections");

    let totalSynced = 0;

    for (const integration of integrations) {
      try {
        const liAtCookie = decrypt(integration.apiKey!);
        const connections = await fetchLinkedInConnections(liAtCookie, 500);

        if (connections.length === 0) {
          logger.warn("[linkedin-sync] No connections returned — cookie may be expired", {
            workspaceId: integration.workspaceId,
          });
          continue;
        }

        // Upsert connections
        for (const conn of connections) {
          if (!conn.profileUrl) continue;

          const companyName = conn.companyName ?? (conn.headline ? extractCompanyFromHeadline(conn.headline) : undefined);
          // Crude domain extraction: "Acme Corp" -> undefined (we can't guess)
          // Will be matched by company name in detect-connections or by manual mapping

          try {
            await prisma.linkedInConnection.upsert({
              where: {
                workspaceId_profileUrl: {
                  workspaceId: integration.workspaceId,
                  profileUrl: conn.profileUrl,
                },
              },
              create: {
                workspaceId: integration.workspaceId,
                profileUrl: conn.profileUrl,
                name: conn.name,
                headline: conn.headline ?? null,
                companyName: companyName ?? null,
                companyDomain: null, // Will be enriched later via Apollo match
                connectionDate: conn.connectionDate ? new Date(conn.connectionDate) : null,
              },
              update: {
                name: conn.name,
                headline: conn.headline ?? null,
                companyName: companyName ?? null,
                syncedAt: new Date(),
              },
            });
          } catch {
            // Dedup conflict or invalid data — skip
          }
        }

        totalSynced += connections.length;
        logger.info("[linkedin-sync] Connections synced", {
          workspaceId: integration.workspaceId,
          count: connections.length,
        });
      } catch (err) {
        logger.warn("[linkedin-sync] Failed for workspace", {
          workspaceId: integration.workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { synced: totalSynced, workspaces: integrations.length };
  },
);

// ─── CRON: Resume Rate-Limited Builds ───────────────────

export const resumeRateLimitedBuilds = inngest.createFunction({
    id: "resume-rate-limited-tam",
    name: "Resume Rate-Limited TAM Builds",
    triggers: [{ cron: "30 0 * * *" }], // 00:30 UTC daily
  },
  async () => {
    const stalled = await prisma.tamBuild.findMany({
      where: { phase: "rate-limited" },
      select: { id: true, workspaceId: true, siteUrl: true },
    });

    for (const build of stalled) {
      if (!build.siteUrl) continue;
      await inngest.send({
        name: "tam/build.requested",
        data: {
          workspaceId: build.workspaceId,
          tamBuildId: build.id,
          siteUrl: build.siteUrl,
        },
      });
      logger.info("[tam-cron] Resumed rate-limited build", { tamBuildId: build.id });
    }

    return { resumed: stalled.length };
  },
);
