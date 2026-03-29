import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "../trpc";
import { inferIcpProfile } from "@/server/lib/icp/icp-inferrer";
import { icpProfileDataSchema } from "@/server/lib/icp/icp-schema";
import { icpProfileToOrgFilters, icpProfileToPeopleFilters } from "@/server/lib/icp/icp-converters";
import { analyzeCustomerPatterns } from "@/server/lib/icp/icp-customer-analyzer";
import { logger } from "@/lib/logger";

export const icpRouter = router({
  /** Trigger ICP inference from all available ingestion sources. */
  infer: protectedProcedure.mutation(async ({ ctx }) => {
    const workspaceId = ctx.workspaceId;

    // Gather all completed ingestion sources
    const sources = await prisma.ingestionSource.findMany({
      where: { workspaceId, status: "complete" },
    });

    // Get CompanyDna from workspace + cached markdown from scrape
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { companyDna: true, companyUrl: true },
    });
    let companyDna = workspace?.companyDna as Record<string, unknown> | null;

    // If we have a cached website markdown but no rich CompanyDna yet,
    // run the LLM analysis NOW (deferred from scrape step for reliability)
    if (workspace?.companyUrl) {
      try {
        const domain = new URL(workspace.companyUrl).hostname;
        const cache = await prisma.companyCache.findUnique({ where: { domain } });
        if (cache?.markdown && cache.markdown.length > 100) {
          const { analyzeMarkdown } = await import("@/server/lib/enrichment/company-analyzer");
          const richDna = await analyzeMarkdown(cache.markdown, workspaceId);
          companyDna = richDna as unknown as Record<string, unknown>;

          // Update workspace with rich DNA
          await prisma.workspace.update({
            where: { id: workspaceId },
            data: { companyDna: companyDna as unknown as Prisma.InputJsonValue },
          });
          logger.info("[icp.infer] CompanyDna enriched from cached markdown");
        }
      } catch (err) {
        logger.warn("[icp.infer] LLM analysis failed, using basic DNA", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Get customer patterns from CSV imports
    const customerEntries = await prisma.customerImportEntry.findMany({
      where: { import: { workspaceId } },
      take: 200,
      orderBy: { import: { createdAt: "desc" } },
    });

    const customerPatterns = customerEntries.length > 0
      ? analyzeCustomerPatterns(customerEntries.map((e) => ({
          companyName: e.companyName,
          domain: e.domain ?? undefined,
          industry: e.industry ?? undefined,
          employeeCount: e.employeeCount ?? undefined,
          dealValue: e.dealValue ?? undefined,
          country: e.country ?? undefined,
        })))
      : null;

    logger.info("[icp.infer] Starting inference", {
      workspaceId,
      sourceCount: sources.length,
      hasCompanyDna: !!companyDna,
      customerCount: customerEntries.length,
    });

    // Run inference
    const siteUrl = (await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { companyUrl: true },
    }))?.companyUrl ?? "";

    const icpData = await inferIcpProfile({
      companyDna: (companyDna ?? {}) as Record<string, unknown>,
      customerPatterns,
      nlDescription: null,
      acv: null,
      salesCycleLength: null,
      winReasons: null,
      lossReasons: null,
      negativeIcpText: null,
      workspaceId,
      siteUrl,
    });

    // Deactivate previous profiles
    await prisma.icpProfile.updateMany({
      where: { workspaceId, isActive: true },
      data: { isActive: false },
    });

    // Get next version number
    const lastProfile = await prisma.icpProfile.findFirst({
      where: { workspaceId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (lastProfile?.version ?? 0) + 1;

    // Create new IcpProfile
    const profile = await prisma.icpProfile.create({
      data: {
        workspaceId,
        version,
        source: "onboarding",
        isActive: true,
        roles: icpData.roles as unknown as Prisma.InputJsonValue,
        industries: icpData.industries as unknown as Prisma.InputJsonValue,
        employeeRange: icpData.employeeRange as unknown as Prisma.InputJsonValue,
        geographies: icpData.geographies as unknown as Prisma.InputJsonValue,
        keywords: icpData.keywords as unknown as Prisma.InputJsonValue,
        buyingSignals: icpData.buyingSignals as unknown as Prisma.InputJsonValue,
        disqualifiers: icpData.disqualifiers as unknown as Prisma.InputJsonValue,
        competitors: icpData.competitors as unknown as Prisma.InputJsonValue,
        segments: icpData.segments as unknown as Prisma.InputJsonValue,
        negativeIcp: icpData.negativeIcp as unknown as Prisma.InputJsonValue ?? Prisma.JsonNull,
        confidence: icpData.confidence as unknown as Prisma.InputJsonValue,
        customerPatterns: customerPatterns as unknown as Prisma.InputJsonValue ?? Prisma.JsonNull,
      },
    });

    // Update workspace activeIcpId
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { activeIcpId: profile.id },
    });

    logger.info("[icp.infer] ICP created", {
      profileId: profile.id,
      version,
      confidence: icpData.confidence,
    });

    return { icpProfileId: profile.id, version };
  }),

  /** Get active ICP profile. */
  getActive: protectedProcedure.query(async ({ ctx }) => {
    const profile = await prisma.icpProfile.findFirst({
      where: { workspaceId: ctx.workspaceId, isActive: true },
      orderBy: { version: "desc" },
    });

    if (!profile) return null;

    // Parse JSON fields
    const data = icpProfileDataSchema.safeParse({
      roles: profile.roles,
      industries: profile.industries,
      employeeRange: profile.employeeRange,
      geographies: profile.geographies,
      keywords: profile.keywords,
      buyingSignals: profile.buyingSignals,
      disqualifiers: profile.disqualifiers,
      competitors: profile.competitors,
      segments: profile.segments,
      negativeIcp: profile.negativeIcp,
      confidence: profile.confidence,
      customerPatterns: profile.customerPatterns,
    });

    return {
      id: profile.id,
      version: profile.version,
      source: profile.source,
      createdAt: profile.createdAt,
      data: data.success ? data.data : null,
      raw: profile,
    };
  }),

  /** Update ICP (manual edits). */
  update: protectedProcedure
    .input(
      z.object({
        profileId: z.string(),
        roles: z.unknown().optional(),
        industries: z.unknown().optional(),
        employeeRange: z.unknown().optional(),
        geographies: z.unknown().optional(),
        keywords: z.unknown().optional(),
        buyingSignals: z.unknown().optional(),
        disqualifiers: z.unknown().optional(),
        competitors: z.unknown().optional(),
        segments: z.unknown().optional(),
        negativeIcp: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { profileId, ...changes } = input;

      // Only update non-undefined fields
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) {
          data[key] = value as Prisma.InputJsonValue;
        }
      }

      if (Object.keys(data).length === 0) return { updated: false };

      await prisma.icpProfile.update({
        where: { id: profileId, workspaceId: ctx.workspaceId },
        data: data as Prisma.IcpProfileUpdateInput,
      });

      return { updated: true };
    }),

  /** Preview Apollo filters for current ICP. */
  getApolloPreview: protectedProcedure.query(async ({ ctx }) => {
    const profile = await prisma.icpProfile.findFirst({
      where: { workspaceId: ctx.workspaceId, isActive: true },
    });

    if (!profile) return null;

    const parsed = icpProfileDataSchema.safeParse({
      roles: profile.roles,
      industries: profile.industries,
      employeeRange: profile.employeeRange,
      geographies: profile.geographies,
      keywords: profile.keywords,
      buyingSignals: profile.buyingSignals,
      disqualifiers: profile.disqualifiers,
      competitors: profile.competitors,
      segments: profile.segments,
      confidence: profile.confidence,
    });

    if (!parsed.success) return null;

    return {
      orgFilters: icpProfileToOrgFilters(parsed.data),
      peopleFilters: icpProfileToPeopleFilters(parsed.data),
    };
  }),

  /** List evolution proposals. */
  getProposals: protectedProcedure.query(async ({ ctx }) => {
    return prisma.icpEvolutionProposal.findMany({
      where: { workspaceId: ctx.workspaceId, status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  }),

  /** Accept or reject a proposal. */
  respondToProposal: protectedProcedure
    .input(
      z.object({
        proposalId: z.string(),
        action: z.enum(["accept", "reject"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await prisma.icpEvolutionProposal.findFirst({
        where: { id: input.proposalId, workspaceId: ctx.workspaceId },
      });
      if (!proposal) throw new Error("Proposal not found");

      await prisma.icpEvolutionProposal.update({
        where: { id: input.proposalId },
        data: {
          status: input.action === "accept" ? "accepted" : "rejected",
          appliedAt: input.action === "accept" ? new Date() : null,
        },
      });

      // TODO (P1): if accepted, apply changes to active IcpProfile

      return { status: input.action === "accept" ? "accepted" : "rejected" };
    }),
});
