import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

const HUBSPOT_AUTH_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";

/**
 * GET /api/integrations/hubspot — Start OAuth flow
 * POST /api/integrations/hubspot — Handle OAuth callback (code exchange)
 */

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "HUBSPOT_CLIENT_ID not configured" }, { status: 500 });

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/hubspot`;
  const scopes = "crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.objects.deals.read";

  const url = `${HUBSPOT_AUTH_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&response_type=code`;

  return NextResponse.redirect(url);
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code } = await req.json();
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/hubspot`;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "HubSpot OAuth not configured" }, { status: 500 });
  }

  // Exchange code for tokens
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
    return NextResponse.json({ error: "Token exchange failed" }, { status: 400 });
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

  // Pull companies/deals from HubSpot as customer import
  try {
    const companiesRes = await fetch("https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=name,domain,industry,numberofemployees,country", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
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

      // Store as ingestion source
      await prisma.ingestionSource.create({
        data: {
          workspaceId: user.workspaceId,
          type: "crm",
          status: "complete",
          structuredData: { source: "hubspot", companies: companies.results.length },
          completedAt: new Date(),
        },
      });

      logger.info("[hubspot-oauth] Imported companies", { count: companies.results.length });
    }
  } catch (err) {
    logger.warn("[hubspot-oauth] Company import failed", { error: err instanceof Error ? err.message : String(err) });
  }

  return NextResponse.json({ success: true });
}
