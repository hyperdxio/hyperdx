/**
 * Utility functions and types for DBDeltaChart.
 * Pure helpers with no React dependencies — safe to import from tests.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTypeWrappers(type: string): string {
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
 * Converts a flattened dot-notation property key (produced by flattenData())
 * into a valid ClickHouse SQL expression for use in filter conditions.
 *
 * flattenData() uses JavaScript's object/array iteration, producing keys like:
 *   "ResourceAttributes.service.name"     for Map(String, String) columns
 *   "Events.Attributes[0].message.type"   for Array(Map(String, String)) columns
 *
 * These must be converted to bracket notation for ClickHouse Map access:
 *   "ResourceAttributes['service.name']"
 *   "Events.Attributes[1]['message.type']"  (note: 0-based JS → 1-based CH index)
 */
export function flattenedKeyToSqlExpression(
  key: string,
  columnMeta: { name: string; type: string }[],
): string {
  for (const col of columnMeta) {
    const baseType = stripTypeWrappers(col.type);

    if (baseType.startsWith('Map(')) {
      // Simple Map column: "MapCol.some.key" → "MapCol['some.key']"
      if (key.startsWith(col.name + '.')) {
        const mapKey = key.slice(col.name.length + 1).replace(/'/g, "''");
        return `${col.name}['${mapKey}']`;
      }
    } else if (baseType.startsWith('Array(')) {
      const innerType = stripTypeWrappers(baseType.slice('Array('.length, -1));
      if (innerType.startsWith('Map(')) {
        // Array(Map) column: "ColName[N].key" → "ColName[N+1]['key']"
        // flattenData() uses 0-based JS indexing; ClickHouse SQL uses 1-based.
        const pattern = new RegExp(
          `^${escapeRegExp(col.name)}\\[(\\d+)\\]\\.(.+)$`,
        );
        const match = key.match(pattern);
        if (match) {
          const chIndex = parseInt(match[1]) + 1;
          const mapKey = match[2].replace(/'/g, "''");
          return `${col.name}[${chIndex}]['${mapKey}']`;
        }
      }
    }
  }
  return key;
}

/**
 * Returns true if the field is a structural ID field that should always be hidden.
 *
 * Matches:
 *   - Top-level String columns whose name ends in "Id" or "ID" (e.g., TraceId, SpanId)
 *   - Array(String) column elements or plain column references whose name ends in
 *     "Id" or "ID" (e.g., Links.TraceId[0] from a Links.TraceId Array(String) column)
 */
export function isIdField(
  key: string,
  columnMeta: { name: string; type: string }[],
): boolean {
  // Extract base column name:
  //   "ColName[N]" → colName is "ColName"
  //   "ColName" (no brackets) → colName is the key itself
  //   "ColName[N].subkey" → has brackets but doesn't end with ], skip
  const arrMatch = key.match(/^([^\[]+)\[(\d+)\]$/);
  const colName = arrMatch ? arrMatch[1] : key.includes('[') ? null : key;
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
 * Returns true if the field is a per-index timestamp array element (e.g.,
 * Events.Timestamp[0]) from a column of type Array(DateTime64(...)), or the
 * plain column reference itself (e.g., Events.Timestamp).
 */
export function isTimestampArrayField(
  key: string,
  columnMeta: { name: string; type: string }[],
): boolean {
  const arrMatch = key.match(/^([^\[]+)\[(\d+)\]$/);
  const colName = arrMatch ? arrMatch[1] : key.includes('[') ? null : key;
  if (!colName) return false;

  const col = columnMeta.find(c => c.name === colName);
  if (!col) return false;
  const baseType = stripTypeWrappers(col.type);
  if (!baseType.startsWith('Array(')) return false;
  const innerType = stripTypeWrappers(baseType.slice('Array('.length, -1));
  return innerType.startsWith('DateTime64(');
}

/**
 * Returns true if the field should always be hidden per the structural denylist:
 *   - ID fields (TraceId, SpanId, ParentSpanId, Links.TraceId[N], Links.SpanId[N], etc.)
 *   - Per-index timestamp array elements (Events.Timestamp[N], Links.Timestamp[N], etc.)
 */
export function isDenylisted(
  key: string,
  columnMeta: { name: string; type: string }[],
): boolean {
  return isIdField(key, columnMeta) || isTimestampArrayField(key, columnMeta);
}

/**
 * Returns true if the field should be hidden due to high cardinality (most values are
 * unique, meaning it provides little analytical value in the comparison view).
 *
 * Takes the percentage occurrence maps (value → percentage 0–100) produced by
 * getPropertyStatistics, and the raw property occurrence counts. Unique value count is
 * derived from the map's size.
 *
 * A field is considered high cardinality when:
 *   min(outlierUniqueness, inlierUniqueness) > 0.9 AND combined sample size > 20
 *
 * "min" ensures that if either group clusters (low cardinality), the field is kept visible.
 * If only one group has data, that group's uniqueness alone is used.
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

/*
 * Response Data is like...
{
  Timestamp: "",
  Map: {
    "property": value,
  }
}

- Flatten
- Count Property Occurences
- Pick most common properties
- Count values for most common properties

- Merge both sets of properties? one property?
 */

// TODO: doesn't work for empty objects?
// https://stackoverflow.com/a/19101235
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

  // Divide by total rows so percentages represent "fraction of ALL spans",
  // not "fraction of spans that have this property". This ensures a single-valued
  // field that only appears in 30% of spans shows 30%, not 100%.
  const totalRows = data.length || 1;
  const percentageOccurences = new Map<string, Map<string, number>>();
  valueOccurences.forEach((valuesMap, property) => {
    const percentageMap = new Map<string, number>();
    valuesMap.forEach((valueCount, value) => {
      percentageMap.set(value, (valueCount / totalRows) * 100);
    });
    percentageOccurences.set(property, percentageMap);
  });

  return {
    percentageOccurences,
    propertyOccurences,
  };
}

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

/**
 * Computes a distribution skewness score for sorting properties in "all spans" mode.
 *
 * Score = max(pct) - mean(pcts):
 *   - 0 for single-value fields (all spans share the same value → not useful for filtering)
 *   - 0 for perfectly uniform multi-value fields
 *   - High for skewed distributions where one value dominates others
 *
 * Uses mean(pcts) as the uniform baseline so the score works correctly even when
 * percentages don't sum to 100 (e.g., when each value's % is computed relative to
 * ALL spans, not just spans with this property).
 *
 * @param valuePercentages - Map from value string to its percentage (0–100) of occurrences
 */
export function computeDistributionScore(
  valuePercentages: Map<string, number>,
): number {
  const nValues = valuePercentages.size;
  if (nValues <= 1) return 0;
  let totalPct = 0;
  let maxPct = 0;
  valuePercentages.forEach(pct => {
    totalPct += pct;
    if (pct > maxPct) maxPct = pct;
  });
  if (totalPct === 0) return 0;
  const uniformExpected = totalPct / nValues;
  return maxPct - uniformExpected;
}

export type AddFilterFn = (
  property: string,
  value: string,
  action?: 'only' | 'exclude' | 'include',
) => void;

export type HighlightPoint = { tsMs: number; yValue: number | null };

/**
 * Tries to compute the heatmap Y-axis value for a span from a raw flattened row.
 * Handles simple SQL expressions: "ColName", "ColName / N", "ColName * N".
 * Returns null if the expression is too complex or the column is missing.
 */
export function computeYValue(
  valueExpr: string,
  flatRow: Record<string, any>,
): number | null {
  const trimmed = valueExpr.trim();

  // Identifier pattern (with optional surrounding parentheses):
  // Matches "ColName" and "(ColName)"
  const identPat = '\\(?([A-Za-z_][A-Za-z0-9_]*)\\)?';

  // Simple column reference: "Duration" or "(Duration)"
  const simpleMatch = trimmed.match(new RegExp(`^${identPat}$`));
  if (simpleMatch) {
    const v = flatRow[simpleMatch[1]];
    if (v == null) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  // Division: "Duration / 1000000", "(Duration)/1e6", "(Duration) / 1e6"
  const numPat = '([0-9]+(?:\\.[0-9]+)?(?:e[+-]?[0-9]+)?)';
  const divMatch = trimmed.match(
    new RegExp(`^${identPat}\\s*\\/\\s*${numPat}$`, 'i'),
  );
  if (divMatch) {
    const v = flatRow[divMatch[1]];
    if (v == null) return null;
    const n = Number(v);
    const d = parseFloat(divMatch[2]);
    return isNaN(n) || isNaN(d) || d === 0 ? null : n / d;
  }

  // Multiplication: "Duration * 0.001", "(Duration) * 0.001"
  const mulMatch = trimmed.match(
    new RegExp(`^${identPat}\\s*\\*\\s*${numPat}$`, 'i'),
  );
  if (mulMatch) {
    const v = flatRow[mulMatch[1]];
    if (v == null) return null;
    const n = Number(v);
    const m = parseFloat(mulMatch[2]);
    return isNaN(n) || isNaN(m) ? null : n * m;
  }

  return null;
}

// Number of rows randomly sampled per query (outlier, inlier, all-spans).
// Tunable: increase for better coverage of rare attribute values at the cost
// of higher query latency; decrease if ClickHouse scans become too slow.
export const SAMPLE_SIZE = 1000;

// When a field has more than this many distinct values, the remaining values
// are collapsed into a single "Other (N)" bucket shown in neutral gray.
export const MAX_CHART_VALUES = 6;

// Color for the "All spans" distribution bar (no selection / comparison mode off).
// Uses Mantine's blue-6 CSS variable so it adapts to light/dark themes.
export const ALL_SPANS_COLOR = 'var(--mantine-color-blue-6)';

// Color for the "Other (N)" aggregated bucket — neutral gray.
export const OTHER_BUCKET_COLOR = 'var(--mantine-color-gray-5)';

// Aggregates chart data beyond MAX_CHART_VALUES into a single "Other (N)" entry.
// Sorts by combined count (outlier + inlier) descending so the most frequent
// values are kept. Returns data unchanged if already within the limit.
export function applyTopNAggregation(
  data: { name: string; outlierCount: number; inlierCount: number }[],
): {
  name: string;
  outlierCount: number;
  inlierCount: number;
  isOther?: boolean;
}[] {
  if (data.length <= MAX_CHART_VALUES) return data;

  const sorted = [...data].sort(
    (a, b) =>
      b.outlierCount + b.inlierCount - (a.outlierCount + a.inlierCount),
  );
  const top = sorted.slice(0, MAX_CHART_VALUES);
  const rest = sorted.slice(MAX_CHART_VALUES);

  const otherOutlierCount = rest.reduce((sum, item) => sum + item.outlierCount, 0);
  const otherInlierCount = rest.reduce((sum, item) => sum + item.inlierCount, 0);

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
