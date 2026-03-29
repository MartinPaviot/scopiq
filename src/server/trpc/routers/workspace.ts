import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "../trpc";
import { scrapeViaJina } from "@/server/lib/connectors/jina";
import { analyzeClientSite } from "@/server/lib/enrichment/company-analyzer";
import { logger } from "@/lib/logger";

export const workspaceRouter = router({
  /** Get current workspace settings. */
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const workspace = await prisma.workspace.findUnique({
      where: { id: ctx.workspaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        companyUrl: true,
        companyDna: true,
        activeIcpId: true,
        tamBuiltAt: true,
        createdAt: true,
      },
    });
    return workspace;
  }),

  /** Update workspace settings. */
  updateSettings: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        companyUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await prisma.workspace.update({
        where: { id: ctx.workspaceId },
        data: input,
      });
      return { id: updated.id, name: updated.name };
    }),

  /** Scrape a URL and extract CompanyDna. */
  analyzeUrl: protectedProcedure
    .input(z.object({ url: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      let url = input.url.trim();
      if (!/^https?:\/\//.test(url)) {
        url = `https://${url}`;
      }

      logger.info("[workspace.analyzeUrl] Scraping", { url, workspaceId: ctx.workspaceId });

      const scrapeResult = await scrapeViaJina(url);
      if (!scrapeResult.ok) {
        logger.warn("[workspace.analyzeUrl] Scrape failed", { url, reason: scrapeResult.reason });
        return { error: scrapeResult.message };
      }

      const companyDna = await analyzeClientSite(scrapeResult.markdown, ctx.workspaceId);

      // Store on workspace
      await prisma.workspace.update({
        where: { id: ctx.workspaceId },
        data: {
          companyUrl: url,
          companyDna: companyDna as unknown as Prisma.InputJsonValue,
        },
      });

      // Also cache the raw scrape
      await prisma.companyCache.upsert({
        where: { domain: new URL(url).hostname },
        create: {
          domain: new URL(url).hostname,
          workspaceId: ctx.workspaceId,
          markdown: scrapeResult.markdown,
        },
        update: {
          markdown: scrapeResult.markdown,
          scrapedAt: new Date(),
        },
      });

      logger.info("[workspace.analyzeUrl] CompanyDna extracted", {
        url,
        oneLiner: companyDna.oneLiner?.slice(0, 80),
      });

      return { companyDna };
    }),

  /** Get onboarding data (companyDna, activeIcpId, tamBuiltAt). */
  getOnboardingData: protectedProcedure.query(async ({ ctx }) => {
    const workspace = await prisma.workspace.findUnique({
      where: { id: ctx.workspaceId },
      select: {
        companyDna: true,
        companyUrl: true,
        activeIcpId: true,
        tamBuiltAt: true,
      },
    });
    return workspace;
  }),
});
