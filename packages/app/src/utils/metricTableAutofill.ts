import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

const SUFFIX_MAP: Record<MetricsDataType, string[]> = {
  [MetricsDataType.Gauge]: ['_gauge', '-gauge'],
  [MetricsDataType.Histogram]: ['_histogram', '-histogram'],
  [MetricsDataType.Sum]: ['_sum', '-sum'],
  [MetricsDataType.Summary]: ['_summary', '-summary'],
  [MetricsDataType.ExponentialHistogram]: [
    '_exp_histogram',
    '-exp-histogram',
    '_exponential_histogram',
    '-exponential-histogram',
  ],
};

// Exclusion suffixes to avoid mismatches
// (e.g. `_summary` should not match `sum`, `_exp_histogram` should not match `histogram`)
const EXCLUSIONS: Partial<Record<MetricsDataType, string[]>> = {
  [MetricsDataType.Histogram]: [
    '_exp_histogram',
    '-exp-histogram',
    '_exponential_histogram',
    '-exponential-histogram',
  ],
  [MetricsDataType.Sum]: ['_summary', '-summary'],
};

// Metrics v2 (series/points split schema) table suffixes
export const METRICS_V2_TABLE_KEYS = [
  'series',
  'points',
  'histogramPoints',
  'expHistogramPoints',
  'summaryPoints',
  'families',
  'points5m',
  'points1h',
  'histogramPoints5m',
  'histogramPoints1h',
  'expHistogramPoints5m',
  'expHistogramPoints1h',
] as const;
export type MetricsV2TableKey = (typeof METRICS_V2_TABLE_KEYS)[number];

const V2_SUFFIX_MAP: Record<MetricsV2TableKey, string[]> = {
  series: ['_series', '-series'],
  points: ['_points', '-points'],
  histogramPoints: ['_histogram_points', '-histogram-points'],
  expHistogramPoints: ['_exp_histogram_points', '-exp-histogram-points'],
  summaryPoints: ['_summary_points', '-summary-points'],
  families: ['_families', '-families'],
  points5m: ['_points_5m', '-points-5m'],
  points1h: ['_points_1h', '-points-1h'],
  histogramPoints5m: ['_histogram_points_5m', '-histogram-points-5m'],
  histogramPoints1h: ['_histogram_points_1h', '-histogram-points-1h'],
  expHistogramPoints5m: [
    '_exp_histogram_points_5m',
    '-exp-histogram-points-5m',
  ],
  expHistogramPoints1h: [
    '_exp_histogram_points_1h',
    '-exp-histogram-points-1h',
  ],
};

const V2_EXCLUSIONS: Partial<Record<MetricsV2TableKey, string[]>> = {
  points: [
    '_histogram_points',
    '-histogram-points',
    '_exp_histogram_points',
    '-exp-histogram-points',
    '_summary_points',
    '-summary-points',
  ],
  histogramPoints: ['_exp_histogram_points', '-exp-histogram-points'],
  points5m: [
    '_histogram_points_5m',
    '-histogram-points-5m',
    '_exp_histogram_points_5m',
    '-exp-histogram-points-5m',
  ],
  points1h: [
    '_histogram_points_1h',
    '-histogram-points-1h',
    '_exp_histogram_points_1h',
    '-exp-histogram-points-1h',
  ],
  histogramPoints5m: ['_exp_histogram_points_5m', '-exp-histogram-points-5m'],
  histogramPoints1h: ['_exp_histogram_points_1h', '-exp-histogram-points-1h'],
};

function matchTablesBySuffix<K extends string>(
  tableNames: string[],
  currentValues: Partial<Record<K, string>>,
  suffixMap: Record<K, string[]>,
  exclusions: Partial<Record<K, string[]>>,
): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {};

  for (const key of Object.keys(suffixMap) as K[]) {
    if (currentValues[key]) continue; // Don't overwrite user selections

    const candidates = tableNames.filter(name => {
      const lower = name.toLowerCase();
      const matchesSuffix = suffixMap[key].some(suffix =>
        lower.endsWith(suffix),
      );
      if (!matchesSuffix) return false;

      const excl = exclusions[key];
      if (excl) {
        return !excl.some(ex => lower.endsWith(ex));
      }
      return true;
    });

    if (candidates.length === 0) continue;

    // Prefer otel_metrics_ prefixed names first, then shortest match
    candidates.sort((a, b) => {
      const aOtel = a.toLowerCase().startsWith('otel_metrics_') ? 0 : 1;
      const bOtel = b.toLowerCase().startsWith('otel_metrics_') ? 0 : 1;
      if (aOtel !== bOtel) return aOtel - bOtel;
      return a.length - b.length;
    });

    result[key] = candidates[0];
  }

  return result;
}

/**
 * Given a list of table names from a ClickHouse database, returns a map from
 * MetricsDataType to the best-matching table name based on suffix conventions.
 *
 * Only populates entries for metric types whose current value is empty/unset.
 * Prefers `otel_metrics_`-prefixed names, then shortest match.
 */
export function matchMetricTables(
  tableNames: string[],
  currentValues: Partial<Record<MetricsDataType, string>>,
): Partial<Record<MetricsDataType, string>> {
  return matchTablesBySuffix(tableNames, currentValues, SUFFIX_MAP, EXCLUSIONS);
}

/**
 * Matches metrics v2 (series/points split schema) tables by suffix, e.g.
 * otel_metrics_series / otel_metrics_points / otel_metrics_histogram_points /
 * otel_metrics_families. Rollup tables (_5m/_1h) never match since they don't
 * share the point-table suffixes.
 */
export function matchMetricTablesV2(
  tableNames: string[],
  currentValues: Partial<Record<MetricsV2TableKey, string>>,
): Partial<Record<MetricsV2TableKey, string>> {
  return matchTablesBySuffix(
    tableNames,
    currentValues,
    V2_SUFFIX_MAP,
    V2_EXCLUSIONS,
  );
}
