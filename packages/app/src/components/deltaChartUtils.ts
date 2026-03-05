/**
 * Utility functions for DBDeltaChart.
 * Pure helpers with no React dependencies — safe to import from tests.
 */

// Recursively flattens nested objects/arrays into dot-notation keys.
// Empty objects produce an empty {} entry; empty arrays produce an empty [] entry.
// Based on https://stackoverflow.com/a/19101235
export function flattenData(data: Record<string, any>) {
  const result: Record<string, any> = {};
  function recurse(cur: Record<string, any>, prop: string) {
    if (Object(cur) !== cur) {
      result[prop] = cur;
    } else if (Array.isArray(cur)) {
      let l;
      for (let i = 0, l = cur.length; i < l; i++)
        recurse(cur[i], prop + '[' + i + ']');
      if (l == 0) result[prop] = [];
    } else {
      let isEmpty = true;
      for (const p in cur) {
        isEmpty = false;
        recurse(cur[p], prop ? prop + '.' + p : p);
      }
      if (isEmpty && prop) result[prop] = {};
    }
  }
  recurse(data, '');
  return result;
}

export function getPropertyStatistics(data: Record<string, any>[]) {
  const flattened = data.map(flattenData);
  const propertyOccurences = new Map<string, number>();

  const MIN_PROPERTY_OCCURENCES = 5;
  const commonProperties = new Set<string>();

  flattened.forEach(item => {
    Object.entries(item).forEach(([key, value]) => {
      const count = propertyOccurences.get(key) || 0;
      propertyOccurences.set(key, count + 1);

      if (count + 1 >= MIN_PROPERTY_OCCURENCES) {
        commonProperties.add(key);
      }
    });
  });

  // property -> (value -> count)
  const valueOccurences = new Map<string, Map<string, number>>();
  flattened.forEach(item => {
    Object.entries(item).forEach(([key, value]) => {
      if (commonProperties.has(key)) {
        let valuesMap = valueOccurences.get(key);
        if (!valuesMap) {
          valuesMap = new Map<string, number>();
          valueOccurences.set(key, valuesMap);
        }

        const valueCount = valuesMap.get(value) || 0;
        valuesMap.set(value, valueCount + 1);
      }
    });
  });

  const percentageOccurences = new Map<string, Map<string, number>>();
  valueOccurences.forEach((valuesMap, property) => {
    const percentageMap = new Map<string, number>();
    valuesMap.forEach((valueCount, value) => {
      percentageMap.set(
        value,
        (valueCount / (propertyOccurences.get(property) ?? 0)) * 100,
      );
    });
    percentageOccurences.set(property, percentageMap);
  });

  return {
    percentageOccurences,
    propertyOccurences,
    valueOccurences,
  };
}

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
// Field classification helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the base column name from a flattened key.
 * Strips array indices (e.g., "Events.Name[0]" → "Events.Name").
 * Returns null for keys with sub-keys after array indices (e.g., "Events.Attributes[0].spanId").
 */
export function getBaseColumnName(key: string): string | null {
  const arrMatch = key.match(/^([^[]+)\[(\d+)\]$/);
  return arrMatch ? arrMatch[1] : key.includes('[') ? null : key;
}

/** Removes `LowCardinality(...)` and `Nullable(...)` wrappers from ClickHouse type strings. */
export function stripTypeWrappers(type: string): string {
  let t = type.trim();
  let changed = true;
  while (changed) {
    changed = false;
    if (t.startsWith('LowCardinality(') && t.endsWith(')')) {
      t = t.slice('LowCardinality('.length, -1).trim();
      changed = true;
    } else if (t.startsWith('Nullable(') && t.endsWith(')')) {
      t = t.slice('Nullable('.length, -1).trim();
      changed = true;
    }
  }
  return t;
}

/**
 * Returns true if the field is a structural ID field that should always be hidden.
 * Matches top-level String columns or Array(String) elements ending in "Id"/"ID".
 */
export function isIdField(
  key: string,
  columnMeta: { name: string; type: string }[],
): boolean {
  const colName = getBaseColumnName(key);
  if (!colName) return false;
  if (!/(Id|ID)$/.test(colName)) return false;

  const col = columnMeta.find(c => c.name === colName);
  if (!col) return false;
  const baseType = stripTypeWrappers(col.type);
  if (baseType === 'String') return true;
  if (baseType.startsWith('Array(')) {
    const innerType = stripTypeWrappers(baseType.slice('Array('.length, -1));
    return innerType === 'String';
  }
  return false;
}

/**
 * Returns true if the field is a per-index timestamp array element
 * (e.g., Events.Timestamp[0]) from a column of type Array(DateTime64(...)).
 */
export function isTimestampArrayField(
  key: string,
  columnMeta: { name: string; type: string }[],
): boolean {
  const colName = getBaseColumnName(key);
  if (!colName) return false;

  const col = columnMeta.find(c => c.name === colName);
  if (!col) return false;
  const baseType = stripTypeWrappers(col.type);
  if (!baseType.startsWith('Array(')) return false;
  const innerType = stripTypeWrappers(baseType.slice('Array('.length, -1));
  return innerType.startsWith('DateTime64(');
}

/**
 * Returns true if the field should always be hidden (ID fields + timestamp arrays).
 */
export function isDenylisted(
  key: string,
  columnMeta: { name: string; type: string }[],
): boolean {
  return isIdField(key, columnMeta) || isTimestampArrayField(key, columnMeta);
}

/**
 * Returns true if the field has high cardinality (most values unique).
 * Uses min(outlierUniqueness, inlierUniqueness) > 0.9 with combined sample > 20.
 */
export function isHighCardinality(
  key: string,
  outlierValueOccurences: Map<string, Map<string, number>>,
  inlierValueOccurences: Map<string, Map<string, number>>,
  outlierPropertyOccurences: Map<string, number>,
  inlierPropertyOccurences: Map<string, number>,
): boolean {
  const outlierTotal = outlierPropertyOccurences.get(key) ?? 0;
  const inlierTotal = inlierPropertyOccurences.get(key) ?? 0;
  const combinedSampleSize = outlierTotal + inlierTotal;
  if (combinedSampleSize <= 20) return false;

  const outlierUniqueValues = outlierValueOccurences.get(key)?.size ?? 0;
  const inlierUniqueValues = inlierValueOccurences.get(key)?.size ?? 0;

  const outlierUniqueness =
    outlierTotal > 0 ? outlierUniqueValues / outlierTotal : null;
  const inlierUniqueness =
    inlierTotal > 0 ? inlierUniqueValues / inlierTotal : null;

  let effectiveUniqueness: number;
  if (outlierUniqueness !== null && inlierUniqueness !== null) {
    effectiveUniqueness = Math.min(outlierUniqueness, inlierUniqueness);
  } else if (outlierUniqueness !== null) {
    effectiveUniqueness = outlierUniqueness;
  } else if (inlierUniqueness !== null) {
    effectiveUniqueness = inlierUniqueness;
  } else {
    return false;
  }

  return effectiveUniqueness > 0.9;
}

// ---------------------------------------------------------------------------
// Sampling configuration
// ---------------------------------------------------------------------------

/** Default number of rows sampled when the total count is unknown */
export const SAMPLE_SIZE = 1000;

/** Minimum number of rows to sample */
export const MIN_SAMPLE_SIZE = 500;

/** Maximum number of rows to sample */
export const MAX_SAMPLE_SIZE = 5000;

/** Fraction of total rows to sample (e.g., 0.01 = 1%) */
export const SAMPLE_RATIO = 0.01;

/**
 * Builds a deterministic ORDER BY expression for stable sampling.
 * Uses the source's spanIdExpression when available, falls back to rand().
 */
export function getStableSampleExpression(spanIdExpression?: string): string {
  if (spanIdExpression) {
    return `cityHash64(${spanIdExpression})`;
  }
  return 'rand()';
}

/**
 * Computes the effective sample size based on total row count.
 * Adaptive formula: clamp(MIN_SAMPLE_SIZE, ceil(totalCount * SAMPLE_RATIO), MAX_SAMPLE_SIZE).
 * Returns SAMPLE_SIZE as fallback when totalCount is 0 or unavailable.
 */
export function computeEffectiveSampleSize(totalCount: number): number {
  if (totalCount <= 0) return SAMPLE_SIZE;
  return Math.min(
    MAX_SAMPLE_SIZE,
    Math.max(MIN_SAMPLE_SIZE, Math.ceil(totalCount * SAMPLE_RATIO)),
  );
}
