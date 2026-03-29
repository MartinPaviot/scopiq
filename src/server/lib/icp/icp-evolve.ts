/**
 * ICP Evolution Engine — STUB for Scopiq (P1).
 *
 * In LeadSens, this analyzes campaign performance (emailPerformance + Lead models)
 * to suggest ICP adjustments. Scopiq doesn't have the email pipeline, so this
 * will be reimplemented to use TAM account performance data instead.
 *
 * TODO (P1): Implement based on TamAccount scoring patterns + customer import data.
 */

import { logger } from "@/lib/logger";

export interface EvolutionResult {
  proposalCreated: boolean;
  reason: string;
}

export async function runIcpEvolution(
  workspaceId: string,
): Promise<EvolutionResult> {
  logger.info("[icp-evolve] Stub: ICP evolution not yet implemented for Scopiq", {
    workspaceId,
  });

  return {
    proposalCreated: false,
    reason: "ICP evolution not yet implemented — requires TAM performance data",
  };
}
