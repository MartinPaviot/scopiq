import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "../trpc";
import { logger } from "@/lib/logger";

// ─── Lightweight site scraper (no LLM, no Jina dependency) ──

async function scrapeSiteBasic(url: string): Promise<{
  title: string;
  description: string;
  ogImage: string | null;
  markdown: string;
  ok: boolean;
}> {
  const fallback = { title: "", description: "", ogImage: null, markdown: "", ok: false };

  try {
    // Try Jina first (best quality)
    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/markdown" },
      signal: AbortSignal.timeout(12000),
    });

    if (jinaRes.ok) {
      const md = await jinaRes.text();
      if (md.length > 100) {
        // Extract title — Jina uses "Title: ..." format, also try markdown heading
        const jinaTitleMatch = md.match(/^Title:\s*(.+)/m);
        const mdTitleMatch = md.match(/^#\s+(.+)/m);
        const title = jinaTitleMatch?.[1]?.trim() ?? mdTitleMatch?.[1]?.trim() ?? "";
        // Description — first substantial paragraph of text
        const descMatch = md.match(/\n([A-Z][A-Za-z][\s\S]{30,300}?)(?:\n\n|\n[#\-*])/);
        return {
          title,
          description: descMatch?.[1]?.trim().replace(/\n/g, " ") ?? "",
          ogImage: null,
          markdown: md.slice(0, 15000),
          ok: true,
        };
      }
    }
  } catch {
    logger.info("[workspace] Jina scrape failed, falling back to direct fetch");
  }

  // Fallback: direct HTML fetch + meta tag extraction
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Scopiq/1.0 (TAM Engine)" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });

    if (!res.ok) return fallback;

    const html = await res.text();

    const getMetaContent = (name: string): string => {
      const match = html.match(
        new RegExp(`<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i")
      ) ?? html.match(
        new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i")
      );
      return match?.[1] ?? "";
    };

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

    return {
      title: titleMatch?.[1]?.trim() ?? getMetaContent("og:title"),
      description: getMetaContent("description") || getMetaContent("og:description"),
      ogImage: getMetaContent("og:image") || null,
      markdown: `# ${titleMatch?.[1]?.trim() ?? url}\n\n${getMetaContent("description")}\n\n${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 10000)}`,
      ok: true,
    };
  } catch {
    return fallback;
  }
}

// ─── Router ──────────────────────────────────────

export const workspaceRouter = router({
  /** Get current workspace settings. */
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    return prisma.workspace.findUnique({
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
  }),

  /** Update workspace settings. */
  updateSettings: protectedProcedure
    .input(z.object({ name: z.string().min(1).optional(), companyUrl: z.string().url().optional() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await prisma.workspace.update({ where: { id: ctx.workspaceId }, data: input });
      return { id: updated.id, name: updated.name };
    }),

  /** Scrape a URL and store site data. No LLM — fast and reliable. */
  analyzeUrl: protectedProcedure
    .input(z.object({ url: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      let url = input.url.trim();
      if (!/^https?:\/\//.test(url)) url = `https://${url}`;

      logger.info("[workspace.analyzeUrl] Starting", { url });

      const scraped = await scrapeSiteBasic(url);

      // Always save the URL to workspace, even if scrape failed
      const basicDna = {
        oneLiner: scraped.description || scraped.title || "",
        targetBuyers: [],
        keyResults: [],
        differentiators: [],
        problemsSolved: [],
        pricingModel: null,
        socialProof: [],
        toneOfVoice: { register: "conversational", traits: [], avoidWords: [] },
        ctas: [],
      };

      await prisma.workspace.update({
        where: { id: ctx.workspaceId },
        data: {
          companyUrl: url,
          companyDna: basicDna as unknown as Prisma.InputJsonValue,
        },
      });

      // Cache markdown for later ICP inference (the LLM will process it there)
      if (scraped.ok && scraped.markdown.length > 50) {
        try {
          const domain = new URL(url).hostname;
          await prisma.companyCache.upsert({
            where: { domain },
            create: { domain, workspaceId: ctx.workspaceId, markdown: scraped.markdown },
            update: { markdown: scraped.markdown, scrapedAt: new Date() },
          });
        } catch {
          // Non-critical
        }
      }

      logger.info("[workspace.analyzeUrl] Done", {
        url,
        ok: scraped.ok,
        titleLength: scraped.title.length,
        markdownLength: scraped.markdown.length,
      });

      return {
        title: scraped.title,
        description: scraped.description,
        ogImage: scraped.ogImage,
        ok: scraped.ok,
      };
    }),

  /** Get onboarding data. */
  getOnboardingData: protectedProcedure.query(async ({ ctx }) => {
    return prisma.workspace.findUnique({
      where: { id: ctx.workspaceId },
      select: { companyDna: true, companyUrl: true, activeIcpId: true, tamBuiltAt: true },
    });
  }),
});
