/**
 * TAM Partitioner — Splits large TAM queries into partitions under 50K each.
 *
 * Apollo caps results at 50,000 per query (100/page × 500 pages).
 * A TAM of 847K needs splitting into partitions of < 50K.
 *
 * Algorithm: recursive split by geo → size → title.
 * Count results are cached to avoid duplicate API calls.
 */

import { apolloCount, type ApolloTAMSearchParams } from "@/server/lib/apollo/client";
import { logger } from "@/lib/logger";

// ─── Constants ──────────────────────────────────────────

const DEFAULT_MAX_PER_PARTITION = 50_000;

export const GEO_LIST = [
  "United States",
  "United Kingdom",
  "Germany",
  "France",
  "Canada",
  "Australia",
  "Netherlands",
  "Spain",
  "Italy",
  "Sweden",
  "Switzerland",
  "Belgium",
  "Ireland",
  "India",
  "Brazil",
  "Singapore",
  "Japan",
  "Israel",
  "Denmark",
  "Norway",
  "Finland",
  "Austria",
  "Poland",
  "Portugal",
  "Mexico",
  "Argentina",
  "Colombia",
  "South Korea",
  "United Arab Emirates",
  "South Africa",
] as const;

export const SIZE_SPLITS = [
  "1,10",
  "11,20",
  "21,50",
  "51,100",
  "101,200",
  "201,500",
  "501,1000",
  "1001,5000",
  "5001,10000",
] as const;

const SIZE_LABELS: Record<string, string> = {
  "1,10": "1-10 emp",
  "11,20": "11-20 emp",
  "21,50": "21-50 emp",
  "51,100": "51-100 emp",
  "101,200": "101-200 emp",
  "201,500": "201-500 emp",
  "501,1000": "501-1K emp",
  "1001,5000": "1K-5K emp",
  "5001,10000": "5K-10K emp",
};

// ─── Types ──────────────────────────────────────────────

export interface Partition {
  filters: ApolloTAMSearchParams;
  count: number;
  segmentName: string;
}

// ─── Count Cache ────────────────────────────────────────

function cacheKey(params: ApolloTAMSearchParams): string {
  const normalized = {
    t: params.person_titles?.slice().sort(),
    l: params.person_locations?.slice().sort(),
    s: params.person_seniorities?.slice().sort(),
    e: params.organization_num_employees_ranges?.slice().sort(),
    k: params.q_organization_keyword_tags?.slice().sort(),
  };
  return JSON.stringify(normalized);
}

async function cachedCount(
  params: ApolloTAMSearchParams,
  cache: Map<string, number>,
): Promise<number> {
  const key = cacheKey(params);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const count = await apolloCount(params);
  cache.set(key, count);
  return count;
}

// ─── Segment Name Builder ───────────────────────────────

function buildSegmentName(
  geo?: string,
  sizeRange?: string,
  title?: string,
): string {
  const parts: string[] = [];
  if (geo) parts.push(geo);
  if (sizeRange) parts.push(SIZE_LABELS[sizeRange] ?? sizeRange);
  if (title) parts.push(title);
  return parts.join(" · ") || "Global";
}

// ─── Partitioner ────────────────────────────────────────

/**
 * Partition a TAM query into sub-queries.
 *
 * Strategy: split by title first (fast — N titles = N API calls),
 * then only split further by geo if a title partition exceeds the limit.
 * Since the build step caps at 100 pages (10K leads) per partition anyway,
 * we don't need ultra-fine granularity — just enough to get diverse segments.
 *
 * @param baseFilters - The base Apollo search filters (titles, sizes, keywords, etc.)
 * @param maxPerPartition - Max results per partition (default 50,000)
 * @returns Array of partitions with filters, count, and human-readable segmentName
 */
export async function partitionTAM(
  baseFilters: ApolloTAMSearchParams,
  maxPerPartition: number = DEFAULT_MAX_PER_PARTITION,
): Promise<Partition[]> {
  const cache = new Map<string, number>();
  const partitions: Partition[] = [];

  // Get total count
  const totalCount = await cachedCount(baseFilters, cache);

  logger.info("[tam/partitioner] Starting partitioning", {
    totalCount,
    maxPerPartition,
  });

  // If small enough, return as single partition
  if (totalCount <= maxPerPartition) {
    return [
      {
        filters: baseFilters,
        count: totalCount,
        segmentName: "All Markets",
      },
    ];
  }

  const titles = baseFilters.person_titles ?? [];
  const geos = baseFilters.person_locations ?? [];

  // ── Strategy 1: Split by title (fast — N API calls) ──
  if (titles.length > 1) {
    for (const title of titles) {
      const titleFilters: ApolloTAMSearchParams = {
        ...baseFilters,
        person_titles: [title],
      };
      const titleCount = await cachedCount(titleFilters, cache);
      if (titleCount === 0) continue;

      if (titleCount <= maxPerPartition) {
        partitions.push({
          filters: titleFilters,
          count: titleCount,
          segmentName: title,
        });
        continue;
      }

      // Title too large — split further by geo (only ICP geos, not all 30)
      const geosToSplit = geos.length > 0 ? geos : GEO_LIST.slice(0, 10);
      for (const geo of geosToSplit) {
        const geoFilters: ApolloTAMSearchParams = {
          ...titleFilters,
          person_locations: [geo],
        };
        const geoCount = await cachedCount(geoFilters, cache);
        if (geoCount === 0) continue;

        partitions.push({
          filters: geoFilters,
          count: geoCount,
          segmentName: `${geo} · ${title}`,
        });
      }
    }
  } else {
    // ── Strategy 2: No titles — split by geo only ──
    const geosToSplit = geos.length > 0 ? geos : GEO_LIST.slice(0, 10);
    for (const geo of geosToSplit) {
      const geoFilters: ApolloTAMSearchParams = {
        ...baseFilters,
        person_locations: [geo],
      };
      const geoCount = await cachedCount(geoFilters, cache);
      if (geoCount === 0) continue;

      partitions.push({
        filters: geoFilters,
        count: geoCount,
        segmentName: geo,
      });
    }
  }

  // Fallback: if no partitions were created, use original query
  if (partitions.length === 0) {
    partitions.push({
      filters: baseFilters,
      count: totalCount,
      segmentName: "All Markets",
    });
  }

  logger.info("[tam/partitioner] Partitioning complete", {
    totalCount,
    partitions: partitions.length,
    apiCalls: cache.size,
    sumPartitionCounts: partitions.reduce((s, p) => s + p.count, 0),
  });

  return partitions;
}

// ─── Size Splitter ──────────────────────────────────────

async function splitBySize(
  baseFilters: ApolloTAMSearchParams,
  geoLabel: string,
  maxPerPartition: number,
  cache: Map<string, number>,
): Promise<Partition[]> {
  const partitions: Partition[] = [];

  for (const sizeRange of SIZE_SPLITS) {
    const sizeFilters: ApolloTAMSearchParams = {
      ...baseFilters,
      organization_num_employees_ranges: [sizeRange],
    };
    const sizeCount = await cachedCount(sizeFilters, cache);

    if (sizeCount === 0) continue;

    if (sizeCount <= maxPerPartition) {
      partitions.push({
        filters: sizeFilters,
        count: sizeCount,
        segmentName: buildSegmentName(geoLabel, sizeRange),
      });
      continue;
    }

    // Size bucket still too large — split by individual title
    const titlePartitions = await splitByTitle(
      sizeFilters,
      geoLabel,
      sizeRange,
      maxPerPartition,
      cache,
    );
    for (const p of titlePartitions) {
      partitions.push(p);
    }
  }

  return partitions;
}

// ─── Title Splitter ─────────────────────────────────────

async function splitByTitle(
  baseFilters: ApolloTAMSearchParams,
  geoLabel: string,
  sizeRange: string,
  maxPerPartition: number,
  cache: Map<string, number>,
): Promise<Partition[]> {
  const partitions: Partition[] = [];
  const titles = baseFilters.person_titles ?? [];

  if (titles.length === 0) {
    // No titles to split by — keep as oversized partition with warning
    const count = await cachedCount(baseFilters, cache);
    logger.warn("[tam/partitioner] Partition exceeds max, no titles to split further", {
      segmentName: buildSegmentName(geoLabel, sizeRange),
      count,
      maxPerPartition,
    });
    partitions.push({
      filters: baseFilters,
      count,
      segmentName: buildSegmentName(geoLabel, sizeRange),
    });
    return partitions;
  }

  for (const title of titles) {
    const titleFilters: ApolloTAMSearchParams = {
      ...baseFilters,
      person_titles: [title],
    };
    const titleCount = await cachedCount(titleFilters, cache);

    if (titleCount === 0) continue;

    if (titleCount > maxPerPartition) {
      logger.warn("[tam/partitioner] Single title partition exceeds max", {
        segmentName: buildSegmentName(geoLabel, sizeRange, title),
        count: titleCount,
        maxPerPartition,
      });
    }

    partitions.push({
      filters: titleFilters,
      count: titleCount,
      segmentName: buildSegmentName(geoLabel, sizeRange, title),
    });
  }

  return partitions;
}
