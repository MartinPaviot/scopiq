import { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { router, protectedProcedure } from "../trpc";
import { encrypt, decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

export const integrationRouter = router({
  /** List all integrations for this workspace. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const integrations = await prisma.integration.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: {
        id: true,
        type: true,
        accountEmail: true,
        accountName: true,
        status: true,
        createdAt: true,
      },
    });
    return integrations;
  }),

  /** Connect an integration by API key. */
  connect: protectedProcedure
    .input(
      z.object({
        type: z.string().min(1),
        apiKey: z.string().min(1),
        accountEmail: z.string().optional(),
        accountName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const encrypted = encrypt(input.apiKey);

      const integration = await prisma.integration.upsert({
        where: {
          workspaceId_type: {
            workspaceId: ctx.workspaceId,
            type: input.type,
          },
        },
        create: {
          workspaceId: ctx.workspaceId,
          type: input.type,
          apiKey: encrypted,
          accessToken: input.type === "hubspot" ? encrypted : undefined,
          accountEmail: input.accountEmail,
          accountName: input.accountName,
          status: "ACTIVE",
        },
        update: {
          apiKey: encrypted,
          accessToken: input.type === "hubspot" ? encrypted : undefined,
          accountEmail: input.accountEmail,
          accountName: input.accountName,
          status: "ACTIVE",
        },
      });

      logger.info("[integration.connect] Connected", {
        type: input.type,
        workspaceId: ctx.workspaceId,
      });

      return { id: integration.id, type: integration.type, status: integration.status };
    }),

  /** Disconnect an integration. */
  disconnect: protectedProcedure
    .input(z.object({ type: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.integration.updateMany({
        where: { workspaceId: ctx.workspaceId, type: input.type },
        data: { status: "DISCONNECTED" },
      });
      return { disconnected: true };
    }),

  /** Pull companies from HubSpot (server-side to avoid CORS). */
  pullHubspot: protectedProcedure.mutation(async ({ ctx }) => {
    logger.info("[pullHubspot] Starting pull", { workspaceId: ctx.workspaceId });

    const integration = await prisma.integration.findFirst({
      where: { workspaceId: ctx.workspaceId, type: "hubspot", status: "ACTIVE" },
    });

    if (!integration?.apiKey) {
      logger.error("[pullHubspot] No integration found or no apiKey");
      throw new Error("No HubSpot token found — connect HubSpot first");
    }

    logger.info("[pullHubspot] Found integration", { id: integration.id, hasApiKey: !!integration.apiKey, hasAccessToken: !!integration.accessToken });

    const token = decrypt(integration.apiKey);
    logger.info("[pullHubspot] Decrypted token", { tokenPrefix: token.slice(0, 10) + "..." });

    const url = "https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=name,domain,industry,numberofemployees,country";
    logger.info("[pullHubspot] Calling HubSpot API", { url });

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    logger.info("[pullHubspot] HubSpot response", { status: res.status, statusText: res.statusText });

    if (!res.ok) {
      const text = await res.text();
      logger.error("[pullHubspot] HubSpot API error", { status: res.status, body: text });
      throw new Error(`HubSpot API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const raw = await res.text();
    logger.info("[pullHubspot] Raw response length", { length: raw.length, preview: raw.slice(0, 500) });

    const data = JSON.parse(raw) as { total?: number; results?: Array<{ properties: Record<string, string> }> };
    const companies = data.results ?? [];

    logger.info("[pullHubspot] Parsed response", {
      total: data.total,
      resultsCount: companies.length,
      firstCompany: companies[0]?.properties ?? "none",
    });

    return { companies: companies.length };
  }),

  /** Test an integration connection. */
  testConnection: protectedProcedure
    .input(z.object({ type: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const integration = await prisma.integration.findFirst({
        where: { workspaceId: ctx.workspaceId, type: input.type, status: "ACTIVE" },
      });

      if (!integration?.apiKey) {
        return { success: false, error: "No API key found" };
      }

      try {
        const key = decrypt(integration.apiKey);

        if (input.type === "apollo") {
          // Test Apollo API key with a minimal call
          const res = await fetch("https://api.apollo.io/api/v1/auth/health", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: key }),
            signal: AbortSignal.timeout(10_000),
          });
          return { success: res.ok, error: res.ok ? undefined : `Apollo API returned ${res.status}` };
        }

        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Test failed" };
      }
    }),
});
