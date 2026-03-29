/**
 * LinkedIn Connections — STUB for Scopiq.
 *
 * In LeadSens this uses li_at cookie to fetch connections.
 * For Scopiq, connections come from CSV upload (REQ-ING-04).
 * This stub exists only to satisfy imports in tam-build.ts cron.
 */

export interface LinkedInConnection {
  profileUrl?: string;
  name: string;
  headline?: string;
  companyName?: string;
  connectionDate?: string;
}

export async function fetchLinkedInConnections(
  _liAtCookie: string,
  _limit: number,
): Promise<LinkedInConnection[]> {
  return [];
}

export function extractCompanyFromHeadline(headline: string): string | undefined {
  const match = headline.match(/(?:at|@|chez)\s+(.+?)(?:\s*[|·-]|$)/i);
  return match?.[1]?.trim();
}
