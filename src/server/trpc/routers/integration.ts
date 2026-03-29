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
          accountEmail: input.accountEmail,
          accountName: input.accountName,
          status: "ACTIVE",
        },
        update: {
          apiKey: encrypted,
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
