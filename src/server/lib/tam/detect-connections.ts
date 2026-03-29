/**
 * TAM Signal Detector — LinkedIn Connections (BYOT).
 *
 * Checks if the user has 1st-degree LinkedIn connections at a prospect company.
 * Uses pre-synced LinkedInConnection records (matched by companyDomain).
 *
 * This is a FAST detector (DB lookup only, no external API call).
 * The Apify sync happens separately via weekly cron.
 */

import { prisma } from "@/lib/prisma";
import type { SignalResult } from "./detect-signals";

export interface ConnectionSignalResult extends SignalResult {
  connectionNames: string[];
}

/**
 * Detect LinkedIn connections at a prospect company.
 * Matches pre-synced LinkedInConnection records by companyDomain.
 */
export async function detectLinkedInConnections(
  domain: string,
  workspaceId: string,
): Promise<ConnectionSignalResult> {
  const result: ConnectionSignalResult = {
    name: "LinkedIn Connection",
    detected: false,
    evidence: "",
    sources: [],
    reasoning: "No LinkedIn connections at this company",
    points: 0,
    connectionNames: [],
  };

  try {
    // Look up pre-synced connections by company domain
    const connections = await prisma.linkedInConnection.findMany({
      where: {
        workspaceId,
        companyDomain: domain,
      },
      take: 5,
      select: { name: true, headline: true, profileUrl: true },
    });

    if (connections.length === 0) return result;

    result.detected = true;
    result.connectionNames = connections.map((c) => c.name);
    result.evidence = `Connected to: ${connections.map((c) => c.name).join(", ")}`;
    result.sources = connections.map((c) => ({
      url: c.profileUrl,
      title: c.headline ?? c.name,
    }));
    result.reasoning = `You have ${connections.length} LinkedIn connection${connections.length > 1 ? "s" : ""} at this company — warm intro path available.`;
    result.points = Math.min(connections.length * 5, 15);

    return result;
  } catch {
    return result;
  }
}
