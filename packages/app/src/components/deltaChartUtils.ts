/**
 * UI helpers for DBDeltaChart.
 *
 * Pure algorithm functions (flattenData, getPropertyStatistics,
 * computeComparisonScore, semanticBoost, isDenylisted, isHighCardinality,
 * sample-size helpers, rankProperties) live in
 * @hyperdx/common-utils/dist/core/eventDeltas so the MCP server can run the
 * same algorithm. This file re-exports them for backwards compatibility plus
 * the bits that are React/UI-specific (constants, AddFilterFn type, the
 * SQL/filter key conversion helpers that depend on UI semantics).
 */

export {
  computeComparisonScore,
  computeEffectiveSampleSize,
  flattenData,
  getBaseColumnName,
  getPropertyStatistics,
  getStableSampleExpression,
  isDenylisted,
  isHighCardinality,
  isIdField,
  isTimestampArrayField,
  MAX_SAMPLE_SIZE,
  MIN_PROPERTY_OCCURENCES,
  MIN_SAMPLE_SIZE,
  rankProperties,
  SAMPLE_RATIO,
  SAMPLE_SIZE,
  semanticBoost,
  stripTypeWrappers,
} from '@hyperdx/common-utils/dist/core/eventDeltas';

// ---------------------------------------------------------------------------
// UI-only helpers
// ---------------------------------------------------------------------------

// Maximum number of distinct values to show in a chart before collapsing
// the rest into an "Other (N)" bucket. The effective limit adapts: when the
// actual unique count is at most MAX_CHART_VALUES_UPPER, all values are shown
// without aggregation. This avoids the awkward "Other (1)" or "Other (2)" cases
// for attributes like http.status_code that naturally have 4-8 values.
export const MAX_CHART_VALUES = 6;
export const MAX_CHART_VALUES_UPPER = 8;

// Color for the "Other (N)" aggregated bucket — neutral gray.
export const OTHER_BUCKET_COLOR = 'var(--mantine-color-gray-5)';

// Color for the "All spans" distribution bar (no selection / comparison mode off).
export const ALL_SPANS_COLOR = 'var(--mantine-color-blue-6)';

export function mergeValueStatisticsMaps(
  outlierValues: Map<string, number>, // value -> count
  inlierValues: Map<string, number>,
) {
  const mergedArray: {
    name: string;
    outlierCount: number;
    inlierCount: number;
  }[] = [];
  // Collect all value names for this property
  // we sort them so timestamps are ordered
  const allValues = Array.from(
    new Set([...outlierValues.keys(), ...inlierValues.keys()]),
  ).sort();

  allValues.forEach(value => {
    const count1 = outlierValues.get(value) || 0;
    const count2 = inlierValues.get(value) || 0;
    mergedArray.push({
      name: value,
      outlierCount: count1,
      inlierCount: count2,
    });
  });

  return mergedArray;
}

// Aggregates chart data beyond the effective limit into a single "Other (N)" entry.
// Sorts by combined count (outlier + inlier) descending so the most frequent
// values are kept. The effective limit adapts: if the total unique count is at
// most MAX_CHART_VALUES_UPPER, all values are shown without aggregation.
export function applyTopNAggregation(
  data: { name: string; outlierCount: number; inlierCount: number }[],
): {
  name: string;
  outlierCount: number;
  inlierCount: number;
  isOther?: boolean;
}[] {
  // Adaptive: show all values when they fit within the upper bound
  if (data.length <= MAX_CHART_VALUES_UPPER) return data;

  const sorted = [...data].sort(
    (a, b) => b.outlierCount + b.inlierCount - (a.outlierCount + a.inlierCount),
  );
  const top = sorted.slice(0, MAX_CHART_VALUES);
  const rest = sorted.slice(MAX_CHART_VALUES);

  const otherOutlierCount = rest.reduce(
    (sum, item) => sum + item.outlierCount,
    0,
  );
  const otherInlierCount = rest.reduce(
    (sum, item) => sum + item.inlierCount,
    0,
  );

  return [
    ...top,
    {
      name: `Other (${rest.length})`,
      outlierCount: otherOutlierCount,
      inlierCount: otherInlierCount,
      isOther: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Filter key conversion helpers (UI-specific — produce ClickHouse SQL
// expressions / filter keys for the search bar).
// ---------------------------------------------------------------------------

import { stripTypeWrappers } from '@hyperdx/common-utils/dist/core/eventDeltas';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts a flattened dot-notation property key (produced by flattenData())
 * into a valid ClickHouse SQL expression for use in filter conditions.
 *
 * flattenData() uses JavaScript's object/array iteration, producing keys like:
 *   "ResourceAttributes.service.name"     for Map(String, String) columns
 *   "Events.Attributes[0].message.type"   for Array(Map(String, String)) columns
 *
 * These must be converted to bracket notation for ClickHouse Map access:
 *   "ResourceAttributes['service.name']"
 *   "Events.Attributes[1]['message.type']"  (note: 0-based JS -> 1-based CH index)
 */
export function flattenedKeyToSqlExpression(
  key: string,
  columnMeta: { name: string; type: string }[],
): string {
  for (const col of columnMeta) {
    const baseType = stripTypeWrappers(col.type);

    if (baseType.startsWith('Map(')) {
      if (key.startsWith(col.name + '.')) {
        const mapKey = key.slice(col.name.length + 1).replace(/'/g, "''");
        return `${col.name}['${mapKey}']`;
      }
    } else if (baseType.startsWith('Array(')) {
      const innerType = stripTypeWrappers(baseType.slice('Array('.length, -1));
      if (innerType.startsWith('Map(')) {
        const pattern = new RegExp(
          `^${escapeRegExp(col.name)}\\[(\\d+)\\]\\.(.+)$`,
        );
        const match = key.match(pattern);
        if (match) {
          const chIndex = parseInt(match[1], 10) + 1;
          const mapKey = match[2].replace(/'/g, "''");
          return `${col.name}[${chIndex}]['${mapKey}']`;
        }
      }
    }
  }
  return key;
}

/**
 * Converts a flattened dot-notation property key into a filter key using
 * ClickHouse bracket notation for Map columns.
 * This matches the search bar format (WHERE ResourceAttributes['k8s.pod.name'] = ...).
 * For simple (non-Map) columns, returns the key unchanged.
 *
 * NOTE: Currently produces the same output as flattenedKeyToSqlExpression for
 * Map columns. Kept separate because filter keys may diverge in the future
 * (e.g., sidebar facet format vs SQL WHERE clause format for Array(Map) columns).
 */
export function flattenedKeyToFilterKey(
  key: string,
  columnMeta: { name: string; type: string }[],
): string {
  return flattenedKeyToSqlExpression(key, columnMeta);
}

export type AddFilterFn = (
  property: string,
  value: string,
  action?: 'only' | 'exclude' | 'include',
) => void;

// ---------------------------------------------------------------------------
// Entropy scoring (UI-only — used for distribution mode sorting, not by MCP)
// ---------------------------------------------------------------------------

/**
 * Shannon entropy-based distribution score for sorting properties.
 * Returns [0, 1]: 1 = maximally useful (low entropy, dominant value among several),
 * 0 = not useful (single value, empty, or perfectly uniform).
 */
export function computeEntropyScore(
  valuePercentages: Map<string, number>,
): number {
  const nValues = valuePercentages.size;
  if (nValues <= 1) return 0;

  let totalPct = 0;
  valuePercentages.forEach(pct => {
    totalPct += pct;
  });
  if (totalPct === 0) return 0;

  let entropy = 0;
  valuePercentages.forEach(pct => {
    const p = pct / totalPct;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  });

  const maxEntropy = Math.log2(nValues);
  if (maxEntropy === 0) return 0;

  return 1 - entropy / maxEntropy;
}
