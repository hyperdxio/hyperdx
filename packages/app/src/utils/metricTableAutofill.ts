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

const SERIES_SUFFIXES = ['_series', '-series'];

// Prefer otel_metrics_ prefixed names first, then shortest match
function pickBestMatch(candidates: string[]): string {
  const sorted = [...candidates].sort((a, b) => {
    const aOtel = a.toLowerCase().startsWith('otel_metrics_') ? 0 : 1;
    const bOtel = b.toLowerCase().startsWith('otel_metrics_') ? 0 : 1;
    if (aOtel !== bOtel) return aOtel - bOtel;
    return a.length - b.length;
  });
  return sorted[0];
}

/**
 * Given a list of table names from a ClickHouse database, returns the
 * best-matching table name for the metrics `series` table,
 * based on suffix conventions. Returns undefined if a value is already set
 * or no candidate matches.
 */
export function matchSeriesTable(
  tableNames: string[],
  currentValue: string | undefined,
): string | undefined {
  if (currentValue) return undefined; // Don't overwrite user selections

  const candidates = tableNames.filter(name => {
    const lower = name.toLowerCase();
    return SERIES_SUFFIXES.some(suffix => lower.endsWith(suffix));
  });

  if (candidates.length === 0) return undefined;

  return pickBestMatch(candidates);
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
  const result: Partial<Record<MetricsDataType, string>> = {};

  for (const metricType of Object.values(MetricsDataType)) {
    if (currentValues[metricType]) continue; // Don't overwrite user selections

    const candidates = tableNames.filter(name => {
      const lower = name.toLowerCase();
      const matchesSuffix = SUFFIX_MAP[metricType].some(suffix =>
        lower.endsWith(suffix),
      );
      if (!matchesSuffix) return false;

      const excl = EXCLUSIONS[metricType];
      if (excl) {
        return !excl.some(ex => lower.endsWith(ex));
      }
      return true;
    });

    if (candidates.length === 0) continue;

    result[metricType] = pickBestMatch(candidates);
  }

  return result;
}
