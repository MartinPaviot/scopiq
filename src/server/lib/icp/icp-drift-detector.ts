/**
 * ICP Drift Detector -- Measures how much an ICP has changed.
 *
 * Uses Jaccard distance for set-based dimensions (industries, geos)
 * and normalized absolute difference for range dimensions (employee range).
 *
 * Significant drift (>30%) requires user confirmation regardless of autonomy level.
 */

import type { IcpProfileData } from "./icp-schema";

// --- Types ---

export interface DriftResult {
  /** Overall drift score (0-1). 0 = identical, 1 = completely different. */
  driftScore: number;
  /** Whether the drift exceeds the significance threshold (30%). */
  significantDrift: boolean;
  /** Which dimensions changed significantly. */
  changedDimensions: string[];
  /** Per-dimension drift values. */
  dimensionDrift: Record<string, number>;
}

// --- Jaccard Distance ---

function jaccardDistance(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;

  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;

  return 1 - intersection / union;
}

// --- Normalized Range Distance ---

function rangeDistance(
  current: { min: number; max: number; sweetSpot: number },
  proposed: { min: number; max: number; sweetSpot: number },
): number {
  const maxVal = Math.max(current.sweetSpot, proposed.sweetSpot, 1);
  return Math.abs(current.sweetSpot - proposed.sweetSpot) / maxVal;
}

// --- Main Function ---

const SIGNIFICANCE_THRESHOLD = 0.3;
const DIMENSION_THRESHOLD = 0.2;

export function computeDrift(
  current: IcpProfileData,
  proposed: IcpProfileData,
): DriftResult {
  const dimensionDrift: Record<string, number> = {};
  const changedDimensions: string[] = [];

  dimensionDrift.industry = jaccardDistance(current.industries, proposed.industries);
  if (dimensionDrift.industry > DIMENSION_THRESHOLD) {
    changedDimensions.push("industries");
  }

  dimensionDrift.geo = jaccardDistance(current.geographies, proposed.geographies);
  if (dimensionDrift.geo > DIMENSION_THRESHOLD) {
    changedDimensions.push("geographies");
  }

  const currentTitles = current.roles.map((r) => r.title);
  const proposedTitles = proposed.roles.map((r) => r.title);
  dimensionDrift.title = jaccardDistance(currentTitles, proposedTitles);
  if (dimensionDrift.title > DIMENSION_THRESHOLD) {
    changedDimensions.push("roles");
  }

  dimensionDrift.size = rangeDistance(current.employeeRange, proposed.employeeRange);
  if (dimensionDrift.size > DIMENSION_THRESHOLD) {
    changedDimensions.push("employeeRange");
  }

  dimensionDrift.keyword = jaccardDistance(current.keywords, proposed.keywords);
  if (dimensionDrift.keyword > DIMENSION_THRESHOLD) {
    changedDimensions.push("keywords");
  }

  const driftScore =
    dimensionDrift.industry * 0.3 +
    dimensionDrift.size * 0.25 +
    dimensionDrift.title * 0.2 +
    dimensionDrift.geo * 0.15 +
    dimensionDrift.keyword * 0.1;

  return {
    driftScore: Math.round(driftScore * 100) / 100,
    significantDrift: driftScore > SIGNIFICANCE_THRESHOLD,
    changedDimensions,
    dimensionDrift,
  };
}
