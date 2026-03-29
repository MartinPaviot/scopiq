/**
 * ICP Schema — Unified Zod schemas for the ICP system.
 *
 * Single source of truth for ICP data shapes used across:
 * - IcpProfile (Prisma model)
 * - ICP inference engine
 * - Onboarding UI
 * - Evolution engine
 * - Apollo filter conversion
 */

import { z } from "zod/v4";

// ─── ICP Role ──────────────────────────────────────────

export const icpRoleSchema = z.object({
  title: z.string(),
  variations: z.array(z.string()).default([]),
  seniority: z.string().default(""),
  why: z.string().default(""),
});

export type IcpRole = z.infer<typeof icpRoleSchema>;

// ─── Buying Signal ─────────────────────────────────────

export const buyingSignalSchema = z.object({
  name: z.string(),
  detectionMethod: z.string().default(""),
  why: z.string().default(""),
  strength: z.enum(["strong", "moderate", "weak"]).default("moderate"),
});

export type BuyingSignal = z.infer<typeof buyingSignalSchema>;

// ─── Employee Range ────────────────────────────────────

export const employeeRangeSchema = z.object({
  min: z.number().default(10),
  max: z.number().default(10000),
  sweetSpot: z.number().default(200),
});

export type EmployeeRange = z.infer<typeof employeeRangeSchema>;

// ─── Segment ───────────────────────────────────────────

export const icpSegmentSchema = z.object({
  name: z.string(),
  titles: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  sizes: z.array(z.string()).default([]),
  geos: z.array(z.string()).default([]),
});

export type IcpSegment = z.infer<typeof icpSegmentSchema>;

// ─── Negative ICP ──────────────────────────────────────

export const negativeIcpSchema = z.object({
  industries: z.array(z.string()).default([]),
  titles: z.array(z.string()).default([]),
  companyPatterns: z.array(z.string()).default([]),
  sizeExclusions: z.array(z.string()).default([]),
});

export type NegativeIcp = z.infer<typeof negativeIcpSchema>;

// ─── Confidence Scores ─────────────────────────────────

export const confidenceScoresSchema = z.object({
  industry: z.number().min(0).max(1).default(0.3),
  size: z.number().min(0).max(1).default(0.3),
  title: z.number().min(0).max(1).default(0.3),
  geo: z.number().min(0).max(1).default(0.3),
  overall: z.number().min(0).max(1).default(0.3),
});

export type ConfidenceScores = z.infer<typeof confidenceScoresSchema>;

// ─── Customer Patterns ─────────────────────────────────

export const distributionEntrySchema = z.object({
  value: z.string(),
  count: z.number(),
  percentage: z.number(),
});

export type DistributionEntry = z.infer<typeof distributionEntrySchema>;

export const customerPatternsSchema = z.object({
  industryDist: z.array(distributionEntrySchema).default([]),
  sizeDist: z.array(distributionEntrySchema).default([]),
  geoDist: z.array(distributionEntrySchema).default([]),
  avgDealValue: z.number().nullable().default(null),
  medianDealValue: z.number().nullable().default(null),
  totalCustomers: z.number().default(0),
});

export type CustomerPatterns = z.infer<typeof customerPatternsSchema>;

// ─── Sales Cycle Length ────────────────────────────────

export const salesCycleLengthSchema = z.enum([
  "<14d",
  "14-30d",
  "30-90d",
  "90-180d",
  ">180d",
]);

export type SalesCycleLength = z.infer<typeof salesCycleLengthSchema>;

// ─── ICP Profile (full structured ICP) ─────────────────

export const icpProfileDataSchema = z.object({
  // User inputs
  nlDescription: z.string().nullable().default(null),
  acv: z.number().nullable().default(null),
  salesCycleLength: salesCycleLengthSchema.nullable().default(null),
  winReasons: z.string().nullable().default(null),
  lossReasons: z.string().nullable().default(null),

  // Structured dimensions
  roles: z.array(icpRoleSchema).default([]),
  industries: z.array(z.string()).default([]),
  employeeRange: employeeRangeSchema.default({ min: 10, max: 10000, sweetSpot: 200 }),
  geographies: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  buyingSignals: z.array(buyingSignalSchema).default([]),
  disqualifiers: z.array(z.string()).default([]),
  competitors: z.array(z.string()).default([]),
  segments: z.array(icpSegmentSchema).default([]),

  // Negative ICP
  negativeIcp: negativeIcpSchema.nullable().default(null),

  // Confidence
  confidence: confidenceScoresSchema.default({
    industry: 0.3, size: 0.3, title: 0.3, geo: 0.3, overall: 0.3,
  }),

  // Customer patterns snapshot
  customerPatterns: customerPatternsSchema.nullable().default(null),
});

export type IcpProfileData = z.infer<typeof icpProfileDataSchema>;

// ─── ICP Inference Input ───────────────────────────────

export const icpInferenceInputSchema = z.object({
  companyDna: z.record(z.string(), z.unknown()),
  customerPatterns: customerPatternsSchema.nullable().default(null),
  nlDescription: z.string().nullable().default(null),
  acv: z.number().nullable().default(null),
  salesCycleLength: salesCycleLengthSchema.nullable().default(null),
  winReasons: z.string().nullable().default(null),
  lossReasons: z.string().nullable().default(null),
  negativeIcpText: z.string().nullable().default(null),
  workspaceId: z.string(),
  siteUrl: z.string(),
});

export type IcpInferenceInput = z.infer<typeof icpInferenceInputSchema>;

// ─── Evolution Proposal Change ─────────────────────────

export const evolutionChangeSchema = z.object({
  dimension: z.string(),
  action: z.enum(["add", "remove", "modify"]),
  current: z.unknown(),
  proposed: z.unknown(),
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
});

export type EvolutionChange = z.infer<typeof evolutionChangeSchema>;
