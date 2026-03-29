import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { router, protectedProcedure } from "../trpc";
import { scrapeViaJina } from "@/server/lib/connectors/jina";
import { Prisma } from "@prisma/client";
import { analyzeClientSite } from "@/server/lib/enrichment/company-analyzer";
import { logger } from "@/lib/logger";

// ─── CSV Parser (ported from LeadSens customer-import-step) ──

const CUSTOMER_HEADERS: Record<string, string> = {
  company: "companyName", "company name": "companyName", entreprise: "companyName",
  "société": "companyName", societe: "companyName", name: "companyName", nom: "companyName",
  domain: "domain", "company domain": "domain", website: "domain", site: "domain",
  industry: "industry", industrie: "industry", secteur: "industry",
  employees: "employeeCount", "employee count": "employeeCount", "company size": "employeeCount",
  effectif: "employeeCount", taille: "employeeCount", size: "employeeCount",
  "deal value": "dealValue", deal_value: "dealValue", revenue: "dealValue",
  montant: "dealValue", ca: "dealValue", "contract value": "dealValue",
  country: "country", pays: "country",
};

interface ParsedCustomer {
  companyName: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  dealValue?: number;
  country?: string;
}

function parseCustomerCSV(raw: string): ParsedCustomer[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const delimiter = headerLine.includes("\t") ? "\t" : headerLine.includes(";") ? ";" : ",";
  const headers = headerLine.split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, "").toLowerCase());

  const rows: ParsedCustomer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map((v) => v.trim().replace(/^["']|["']$/g, ""));
    const mapped: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = CUSTOMER_HEADERS[headers[j]];
      if (key && values[j]) mapped[key] = values[j];
    }
    if (!mapped.companyName) continue;
    rows.push({
      companyName: mapped.companyName,
      domain: mapped.domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
      industry: mapped.industry,
      employeeCount: mapped.employeeCount ? parseInt(mapped.employeeCount, 10) || undefined : undefined,
      dealValue: mapped.dealValue ? parseFloat(mapped.dealValue.replace(/[^0-9.]/g, "")) || undefined : undefined,
      country: mapped.country,
    });
  }
  return rows;
}

// ─── LinkedIn URL Extraction ─────────────────────

function extractLinkedInCompanyData(markdown: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  // Extract company name (usually first heading)
  const nameMatch = markdown.match(/^#\s+(.+)/m);
  if (nameMatch) data.name = nameMatch[1].trim();

  // Extract employee count
  const empMatch = markdown.match(/(\d[\d,]+)\s+(?:employees?|collaborateurs?)/i);
  if (empMatch) data.employeeCount = parseInt(empMatch[1].replace(/,/g, ""), 10);

  // Extract industry
  const indMatch = markdown.match(/(?:Industry|Industrie|Secteur)\s*[:\-]\s*(.+)/i);
  if (indMatch) data.industry = indMatch[1].trim();

  // Extract location
  const locMatch = markdown.match(/(?:Headquarters|Siège|Location)\s*[:\-]\s*(.+)/i);
  if (locMatch) data.headquarters = locMatch[1].trim();

  // Extract description (first long paragraph)
  const descMatch = markdown.match(/\n([A-Z].{100,500})/);
  if (descMatch) data.description = descMatch[1].trim();

  return data;
}

function extractLinkedInProfileData(markdown: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  const nameMatch = markdown.match(/^#\s+(.+)/m);
  if (nameMatch) data.name = nameMatch[1].trim();

  const headlineMatch = markdown.match(/^(?!#)(.{20,120})$/m);
  if (headlineMatch) data.headline = headlineMatch[1].trim();

  // Extract current company from headline
  const companyMatch = markdown.match(/(?:at|@|chez)\s+([A-Z][A-Za-z0-9 &.]+)/i);
  if (companyMatch) data.currentCompany = companyMatch[1].trim();

  return data;
}

// ─── Router ──────────────────────────────────────

export const ingestionRouter = router({
  /** List all ingestion sources for this workspace. */
  getSources: protectedProcedure.query(async ({ ctx }) => {
    return prisma.ingestionSource.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
    });
  }),

  /** Process a URL-based source (website, linkedin_company, linkedin_profile). */
  processUrl: protectedProcedure
    .input(
      z.object({
        type: z.enum(["website", "linkedin_company", "linkedin_profile"]),
        url: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let url = input.url.trim();
      if (!/^https?:\/\//.test(url)) url = `https://${url}`;

      // Upsert: replace existing source of same type
      const existing = await prisma.ingestionSource.findFirst({
        where: { workspaceId: ctx.workspaceId, type: input.type },
      });

      const sourceId = existing?.id ?? undefined;
      const source = sourceId
        ? await prisma.ingestionSource.update({
            where: { id: sourceId },
            data: { inputUrl: url, status: "processing", errorMessage: null, structuredData: Prisma.JsonNull, rawContent: null },
          })
        : await prisma.ingestionSource.create({
            data: { workspaceId: ctx.workspaceId, type: input.type, inputUrl: url, status: "processing" },
          });

      // Scrape in-band (fast enough for single pages)
      try {
        const result = await scrapeViaJina(url);
        if (!result.ok) {
          await prisma.ingestionSource.update({
            where: { id: source.id },
            data: { status: "error", errorMessage: result.message },
          });
          return { sourceId: source.id, status: "error" as const, error: result.message };
        }

        let structuredData: Record<string, unknown> = {};

        if (input.type === "website") {
          // Full CompanyDna extraction
          const companyDna = await analyzeClientSite(result.markdown, ctx.workspaceId);
          structuredData = companyDna as Record<string, unknown>;

          // Also update workspace companyDna
          await prisma.workspace.update({
            where: { id: ctx.workspaceId },
            data: { companyUrl: url, companyDna: structuredData as unknown as Prisma.InputJsonValue },
          });
        } else if (input.type === "linkedin_company") {
          structuredData = extractLinkedInCompanyData(result.markdown);
        } else if (input.type === "linkedin_profile") {
          structuredData = extractLinkedInProfileData(result.markdown);
        }

        await prisma.ingestionSource.update({
          where: { id: source.id },
          data: {
            status: "complete",
            rawContent: result.markdown,
            structuredData: structuredData as unknown as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });

        return { sourceId: source.id, status: "complete" as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Processing failed";
        await prisma.ingestionSource.update({
          where: { id: source.id },
          data: { status: "error", errorMessage: message },
        });
        return { sourceId: source.id, status: "error" as const, error: message };
      }
    }),

  /** Process an uploaded file (CSV customers). */
  processUpload: protectedProcedure
    .input(
      z.object({
        type: z.enum(["csv_customers", "document"]),
        fileName: z.string(),
        content: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await prisma.ingestionSource.create({
        data: {
          workspaceId: ctx.workspaceId,
          type: input.type,
          fileName: input.fileName,
          status: "processing",
          rawContent: input.content.slice(0, 500_000), // Cap at 500KB
        },
      });

      try {
        if (input.type === "csv_customers") {
          const customers = parseCustomerCSV(input.content);
          if (customers.length === 0) {
            await prisma.ingestionSource.update({
              where: { id: source.id },
              data: { status: "error", errorMessage: "No valid rows found. Ensure CSV has a header with 'company' or 'company name' column." },
            });
            return { sourceId: source.id, status: "error" as const, error: "No valid rows" };
          }

          // Store in CustomerImport
          const importRecord = await prisma.customerImport.create({
            data: {
              workspaceId: ctx.workspaceId,
              source: "csv",
              fileName: input.fileName,
              rowCount: customers.length,
              processedAt: new Date(),
            },
          });

          await prisma.customerImportEntry.createMany({
            data: customers.map((c) => ({
              importId: importRecord.id,
              companyName: c.companyName,
              domain: c.domain,
              industry: c.industry,
              employeeCount: c.employeeCount,
              dealValue: c.dealValue,
              country: c.country,
            })),
          });

          // Compute pattern summary
          const industries = new Map<string, number>();
          const sizes = new Map<string, number>();
          const geos = new Map<string, number>();
          let totalDealValue = 0;
          let dealCount = 0;

          for (const c of customers) {
            if (c.industry) industries.set(c.industry, (industries.get(c.industry) ?? 0) + 1);
            if (c.employeeCount) {
              const bucket = c.employeeCount <= 50 ? "1-50" : c.employeeCount <= 200 ? "51-200" : c.employeeCount <= 1000 ? "201-1000" : "1000+";
              sizes.set(bucket, (sizes.get(bucket) ?? 0) + 1);
            }
            if (c.country) geos.set(c.country, (geos.get(c.country) ?? 0) + 1);
            if (c.dealValue) { totalDealValue += c.dealValue; dealCount++; }
          }

          const sortedMap = (m: Map<string, number>) =>
            [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => ({
              value,
              percentage: Math.round((count / customers.length) * 100),
            }));

          const patterns = {
            topIndustries: sortedMap(industries),
            topSizes: sortedMap(sizes),
            topGeos: sortedMap(geos),
            avgDealValue: dealCount > 0 ? Math.round(totalDealValue / dealCount) : null,
            totalCustomers: customers.length,
          };

          await prisma.ingestionSource.update({
            where: { id: source.id },
            data: { status: "complete", structuredData: patterns, completedAt: new Date() },
          });

          return { sourceId: source.id, status: "complete" as const, patterns };
        }

        // Document type — just store raw text (PDF/DOCX parsing is P1)
        await prisma.ingestionSource.update({
          where: { id: source.id },
          data: { status: "complete", completedAt: new Date() },
        });

        return { sourceId: source.id, status: "complete" as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload processing failed";
        logger.error("[ingestion.processUpload] Failed", { error: message });
        await prisma.ingestionSource.update({
          where: { id: source.id },
          data: { status: "error", errorMessage: message },
        });
        return { sourceId: source.id, status: "error" as const, error: message };
      }
    }),

  /** Delete a source. */
  deleteSource: protectedProcedure
    .input(z.object({ sourceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.ingestionSource.deleteMany({
        where: { id: input.sourceId, workspaceId: ctx.workspaceId },
      });
    }),

  /** Get status of a specific source. */
  getStatus: protectedProcedure
    .input(z.object({ sourceId: z.string() }))
    .query(async ({ ctx, input }) => {
      return prisma.ingestionSource.findFirst({
        where: { id: input.sourceId, workspaceId: ctx.workspaceId },
      });
    }),
});
