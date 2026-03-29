import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "../trpc";
import { icpProfileDataSchema } from "@/server/lib/icp/icp-schema";
import { icpProfileToOrgFilters, icpProfileToPeopleFilters } from "@/server/lib/icp/icp-converters";
import { analyzeCustomerPatterns } from "@/server/lib/icp/icp-customer-analyzer";
import { mistralClient } from "@/server/lib/llm/mistral-client";
import { logger } from "@/lib/logger";

export const icpRouter = router({
  /** Trigger ICP inference from all available ingestion sources. */
  infer: protectedProcedure.mutation(async ({ ctx }) => {
    const workspaceId = ctx.workspaceId;

    // Gather all completed ingestion sources
    const sources = await prisma.ingestionSource.findMany({
      where: { workspaceId, status: "complete" },
    });

    // Get workspace data + cached website markdown
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { companyDna: true, companyUrl: true },
    });
    const companyDna = workspace?.companyDna as Record<string, unknown> | null;

    // Load cached website markdown to inject directly into ICP inference
    // (single LLM call — no separate CompanyDna extraction step)
    let websiteMarkdown = "";
    if (workspace?.companyUrl) {
      try {
        const domain = new URL(workspace.companyUrl).hostname;
        const cache = await prisma.companyCache.findUnique({ where: { domain } });
        if (cache?.markdown) websiteMarkdown = cache.markdown.slice(0, 8000);
      } catch { /* non-critical */ }
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

    // Run inference — direct Mistral call (bypass complex inferrer for reliability)
    const siteUrl = workspace?.companyUrl ?? "";

    const contextParts: string[] = [];
    if (websiteMarkdown) contextParts.push(`WEBSITE CONTENT:\n${websiteMarkdown.slice(0, 4000)}`);
    if (companyDna?.oneLiner) contextParts.push(`PRODUCT: ${companyDna.oneLiner}`);
    if (customerPatterns && customerPatterns.totalCustomers > 0) {
      contextParts.push(`EXISTING CUSTOMERS (${customerPatterns.totalCustomers} companies):\n` +
        `Industries: ${customerPatterns.industryDist.slice(0, 5).map((d: { value: string; percentage: number }) => `${d.value} (${d.percentage}%)`).join(", ")}\n` +
        `Sizes: ${customerPatterns.sizeDist.slice(0, 5).map((d: { value: string; percentage: number }) => `${d.value} (${d.percentage}%)`).join(", ")}`);
    }

    const SYSTEM = `You are a senior GTM consultant. Analyze this company and infer their IDEAL CUSTOMER PROFILE for B2B outbound prospecting.

Return a FLAT JSON object (no wrapper) with EXACTLY these fields:
{
  "roles": [{"title": "exact LinkedIn title", "variations": ["alt titles"], "seniority": "vp|director|c_suite|manager", "why": "reason"}],
  "industries": ["specific industries"],
  "employee_range": {"min": 10, "max": 500, "sweet_spot": 100},
  "geographies": ["United States"],
  "keywords": ["relevant keywords"],
  "buying_signals": [{"name": "signal", "detection_method": "how to detect", "why": "why it matters", "strength": "strong|moderate|weak"}],
  "disqualifiers": ["who NOT to target"],
  "competitors": ["competitor names"],
  "segments": [{"name": "segment", "titles": [], "industries": [], "sizes": [], "geos": []}]
}`;

    logger.info("[icp.infer] Calling Mistral directly", { contextLength: contextParts.join("\n").length });

    const rawResult = await mistralClient.jsonRaw({
      model: "mistral-large-latest",
      system: SYSTEM,
      prompt: `Website: ${siteUrl}\n\n${contextParts.join("\n\n")}`,
      workspaceId,
      action: "icp-direct-inference",
      temperature: 0.3,
    });

    logger.info("[icp.infer] Mistral response", {
      type: typeof rawResult,
      preview: JSON.stringify(rawResult).slice(0, 300),
    });

    // Parse — handle both flat and wrapped formats
    let parsed = rawResult as Record<string, unknown>;
    const keys = Object.keys(parsed);
    if (keys.length === 1 && typeof parsed[keys[0]] === "object") {
      parsed = parsed[keys[0]] as Record<string, unknown>;
    }

    const roles = (Array.isArray(parsed.roles) ? parsed.roles : []) as Array<{ title: string; variations?: string[]; seniority?: string; why?: string }>;
    const empRange = (parsed.employee_range ?? parsed.employeeRange ?? { min: 10, max: 10000, sweet_spot: 200 }) as { min: number; max: number; sweet_spot?: number; sweetSpot?: number };

    const icpData = {
      roles: roles.map((r) => ({ title: r.title ?? "", variations: r.variations ?? [], seniority: r.seniority ?? "", why: r.why ?? "" })),
      industries: Array.isArray(parsed.industries) ? parsed.industries as string[] : [],
      employeeRange: { min: empRange.min ?? 10, max: empRange.max ?? 10000, sweetSpot: empRange.sweet_spot ?? empRange.sweetSpot ?? 200 },
      geographies: Array.isArray(parsed.geographies) ? parsed.geographies as string[] : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords as string[] : [],
      buyingSignals: Array.isArray(parsed.buying_signals ?? parsed.buyingSignals)
        ? ((parsed.buying_signals ?? parsed.buyingSignals) as Array<Record<string, string>>).map((s) => ({
            name: s.name ?? "", detectionMethod: s.detection_method ?? s.detectionMethod ?? "", why: s.why ?? "", strength: (s.strength ?? "moderate") as "strong" | "moderate" | "weak",
          }))
        : [],
      disqualifiers: Array.isArray(parsed.disqualifiers) ? parsed.disqualifiers as string[] : [],
      competitors: Array.isArray(parsed.competitors) ? parsed.competitors as string[] : [],
      segments: Array.isArray(parsed.segments)
        ? (parsed.segments as Array<Record<string, unknown>>).map((s) => ({
            name: String(s.name ?? ""), titles: (s.titles ?? []) as string[], industries: (s.industries ?? []) as string[], sizes: (s.sizes ?? []) as string[], geos: (s.geos ?? []) as string[],
          }))
        : [],
      negativeIcp: null,
      confidence: { industry: 0.5, size: 0.5, title: 0.5, geo: 0.5, overall: 0.5 },
    };

    // Boost confidence based on data quality
    if (roles.length > 0) icpData.confidence.title = 0.8;
    if (icpData.industries.length > 0) icpData.confidence.industry = 0.8;
    if (icpData.geographies.length > 0) icpData.confidence.geo = 0.8;
    if (customerPatterns) { icpData.confidence.industry = 0.9; icpData.confidence.size = 0.9; }
    icpData.confidence.overall = (icpData.confidence.industry + icpData.confidence.size + icpData.confidence.title + icpData.confidence.geo) / 4;

    logger.info("[icp.infer] Parsed ICP", {
      roles: icpData.roles.length,
      industries: icpData.industries.length,
      geos: icpData.geographies.length,
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

    // Direct field access — no schema parsing (avoid silent failures)
    return {
      id: profile.id,
      version: profile.version,
      source: profile.source,
      createdAt: profile.createdAt,
      data: {
        roles: (profile.roles ?? []) as Array<{ title: string; variations?: string[]; seniority?: string; why?: string }>,
        industries: (profile.industries ?? []) as string[],
        employeeRange: (profile.employeeRange ?? { min: 10, max: 10000, sweetSpot: 200 }) as { min: number; max: number; sweetSpot?: number },
        geographies: (profile.geographies ?? []) as string[],
        keywords: (profile.keywords ?? []) as string[],
        buyingSignals: (profile.buyingSignals ?? []) as Array<{ name: string; detectionMethod?: string; why?: string; strength?: string }>,
        disqualifiers: (profile.disqualifiers ?? []) as string[],
        competitors: (profile.competitors ?? []) as string[],
        segments: (profile.segments ?? []) as Array<{ name: string; titles?: string[]; industries?: string[]; sizes?: string[]; geos?: string[] }>,
        negativeIcp: profile.negativeIcp as Record<string, unknown> | null,
        confidence: (profile.confidence ?? { industry: 0.5, size: 0.5, title: 0.5, geo: 0.5, overall: 0.5 }) as { industry: number; size: number; title: number; geo: number; overall: number },
      },
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
