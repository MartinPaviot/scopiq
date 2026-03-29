import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { Prisma } from "@prisma/client";

const HUBSPOT_AUTH_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";

/**
 * GET /api/integrations/hubspot
 * - Without ?code → redirect to HubSpot OAuth
 * - With ?code=xxx → handle callback, exchange code for tokens, pull companies
 */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002";
  const redirectUri = `${appUrl}/api/integrations/hubspot`;

  // ─── No code → initiate OAuth ────────────────
  if (!code) {
    if (!clientId) {
      return NextResponse.redirect(new URL("/setup?error=hubspot_not_configured", req.url));
    }

    const scopes = "crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.objects.deals.read";
    const authUrl = `${HUBSPOT_AUTH_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&response_type=code`;

    return NextResponse.redirect(authUrl);
  }

  // ─── With code → exchange for tokens ─────────
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/setup?error=hubspot_not_configured", req.url));
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.workspaceId) {
    return NextResponse.redirect(new URL("/setup?error=no_workspace", req.url));
  }

  try {
    const tokenRes = await fetch(HUBSPOT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      logger.error("[hubspot-oauth] Token exchange failed", { error: err });
      return NextResponse.redirect(new URL("/setup?error=hubspot_token_failed", req.url));
    }

    const tokens = await tokenRes.json();

    // Store encrypted tokens
    await prisma.integration.upsert({
      where: { workspaceId_type: { workspaceId: user.workspaceId, type: "hubspot" } },
      create: {
        workspaceId: user.workspaceId,
        type: "hubspot",
        accessToken: encrypt(tokens.access_token),
        refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        status: "ACTIVE",
      },
      update: {
        accessToken: encrypt(tokens.access_token),
        refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        status: "ACTIVE",
      },
    });

    logger.info("[hubspot-oauth] Connected", { workspaceId: user.workspaceId });

    // ─── Pull companies from HubSpot ───────────
    let companiesImported = 0;
    try {
      const companiesRes = await fetch(
        "https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=name,domain,industry,numberofemployees,country",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      const companies = await companiesRes.json();

      if (companies.results?.length > 0) {
        const importRecord = await prisma.customerImport.create({
          data: {
            workspaceId: user.workspaceId,
            source: "hubspot",
            rowCount: companies.results.length,
            processedAt: new Date(),
          },
        });

        await prisma.customerImportEntry.createMany({
          data: companies.results.map((c: Record<string, Record<string, string>>) => ({
            importId: importRecord.id,
            companyName: c.properties?.name ?? "Unknown",
            domain: c.properties?.domain ?? null,
            industry: c.properties?.industry ?? null,
            employeeCount: c.properties?.numberofemployees ? parseInt(c.properties.numberofemployees, 10) : null,
            country: c.properties?.country ?? null,
          })),
        });

        companiesImported = companies.results.length;

        // Store as ingestion source for ICP inference
        const existingCrmSource = await prisma.ingestionSource.findFirst({
          where: { workspaceId: user.workspaceId, type: "crm" },
        });
        const sourceData = { source: "hubspot", companies: companiesImported } as unknown as Prisma.InputJsonValue;
        if (existingCrmSource) {
          await prisma.ingestionSource.update({
            where: { id: existingCrmSource.id },
            data: { status: "complete", structuredData: sourceData, completedAt: new Date() },
          });
        } else {
          await prisma.ingestionSource.create({
            data: {
              workspaceId: user.workspaceId,
              type: "crm",
              status: "complete",
              structuredData: sourceData,
              completedAt: new Date(),
            },
          });
        }

        logger.info("[hubspot-oauth] Imported companies", { count: companiesImported });
      }
    } catch (importErr) {
      logger.warn("[hubspot-oauth] Company import failed (non-blocking)", {
        error: importErr instanceof Error ? importErr.message : String(importErr),
      });
    }

    // Redirect back to setup with success
    return NextResponse.redirect(
      new URL(`/setup?hubspot=connected&companies=${companiesImported}`, req.url),
    );
  } catch (err) {
    logger.error("[hubspot-oauth] Failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.redirect(new URL("/setup?error=hubspot_failed", req.url));
  }
}
