/**
 * Event-deltas algorithm — pure functions used by both the HyperDX UI
 * (DBDeltaChart) and the MCP server (hyperdx_event_deltas tool).
 *
 * Given two row sets — a target group and a baseline group — the algorithm
 * ranks each property by how differently its values are distributed between
 * the two groups. Output is a sorted list of property keys, with optional
 * filtering for ID/timestamp fields and high-cardinality columns.
 *
 * No React or environment-specific dependencies — safe to import from a Node
 * server, a browser app, or a test runner.
 */

// ---------------------------------------------------------------------------
// Row flattening
// ---------------------------------------------------------------------------

/**
 * Recursively flattens nested objects/arrays into dot-notation keys.
 * Empty objects → "{}" entry; empty arrays → "[]" entry.
 * Based on https://stackoverflow.com/a/19101235
 */
export function flattenData(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};

  function recurse(cur: Record<string, any>, prop: string) {
    if (Object(cur) !== cur) {
      result[prop] = cur; // eslint-disable-line security/detect-object-injection
    } else if (Array.isArray(cur)) {
      for (let i = 0; i < cur.length; i++)
        recurse(cur[i], prop + '[' + i + ']');
      if (cur.length === 0) result[prop] = []; // eslint-disable-line security/detect-object-injection
    } else {
      let isEmpty = true;
      for (const p in cur) {
        isEmpty = false;
        recurse(cur[p], prop ? prop + '.' + p : p);
      }
      if (isEmpty && prop) result[prop] = {}; // eslint-disable-line security/detect-object-injection
    }
  }
  recurse(data, '');
  return result;
}

// ---------------------------------------------------------------------------
// Property statistics
// ---------------------------------------------------------------------------

export interface PropertyStatistics {
  /** Property key → (value → percentage of rows where this property has this value) */
  percentageOccurences: Map<string, Map<string, number>>;
  /** Property key → number of rows where the key was present */
  propertyOccurences: Map<string, number>;
  /** Property key → (value → count) */
  valueOccurences: Map<string, Map<string, number>>;
}

/** Minimum row count for a property to qualify as "common" enough to score. */
export const MIN_PROPERTY_OCCURENCES = 5;

export function getPropertyStatistics(
  data: Record<string, any>[],
): PropertyStatistics {
  const flattened = data.map(flattenData);
  const propertyOccurences = new Map<string, number>();
  const commonProperties = new Set<string>();

  flattened.forEach(item => {
    Object.entries(item).forEach(([key]) => {
      const count = propertyOccurences.get(key) || 0;
      propertyOccurences.set(key, count + 1);
      if (count + 1 >= MIN_PROPERTY_OCCURENCES) {
        commonProperties.add(key);
      }
    });
  });

  const valueOccurences = new Map<string, Map<string, number>>();
  flattened.forEach(item => {
    Object.entries(item).forEach(([key, value]) => {
      if (commonProperties.has(key)) {
        let valuesMap = valueOccurences.get(key);
        if (!valuesMap) {
          valuesMap = new Map<string, number>();
          valueOccurences.set(key, valuesMap);
        }
        const valueStr =
          value === null || value === undefined ? '' : String(value);
        const valueCount = valuesMap.get(valueStr) || 0;
        valuesMap.set(valueStr, valueCount + 1);
      }
    });
  });

  const percentageOccurences = new Map<string, Map<string, number>>();
  valueOccurences.forEach((valuesMap, property) => {
    const percentageMap = new Map<string, number>();
    valuesMap.forEach((valueCount, value) => {
      percentageMap.set(
        value,
        (valueCount / (propertyOccurences.get(property) ?? 1)) * 100,
      );
    });
    percentageOccurences.set(property, percentageMap);
  });

  return { percentageOccurences, propertyOccurences, valueOccurences };
}

// ---------------------------------------------------------------------------
// Field classification
// ---------------------------------------------------------------------------

/** Strips LowCardinality(...)/Nullable(...) wrappers from a ClickHouse type. */
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
 * Extracts the base column name from a flattened key (strips array indices).
 * "Events.Name[0]" → "Events.Name"; returns null for keys with sub-keys
 * after array indices ("Events.Attributes[0].spanId").
 */
export function getBaseColumnName(key: string): string | null {
  const arrMatch = key.match(/^([^[]+)\[(\d+)\]$/);
  return arrMatch ? arrMatch[1] : key.includes('[') ? null : key;
}

/** Top-level String columns or Array(String) elements ending in Id/ID. */
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

/** Per-index timestamp array elements (Events.Timestamp[N] of Array(DateTime64)). */
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

/** Hide-by-default fields (IDs + per-index timestamps). */
export function isDenylisted(
  key: string,
  columnMeta: { name: string; type: string }[],
): boolean {
  return isIdField(key, columnMeta) || isTimestampArrayField(key, columnMeta);
}

/**
 * High cardinality: most values are unique (uniqueness > 0.9 with > 20
 * combined samples). Such columns produce noisy/distracting deltas and are
 * hidden by default.
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
// Scoring
// ---------------------------------------------------------------------------

/**
 * Comparison-mode scoring: normalizes each group's percentages to sum to 100%
 * before computing the max delta. Fields with identical proportional
 * distributions score 0 regardless of coverage rate differences.
 */
export function computeComparisonScore(
  outlierValues: Map<string, number>,
  inlierValues: Map<string, number>,
): number {
  const allValues = new Set([...outlierValues.keys(), ...inlierValues.keys()]);
  if (allValues.size === 0) return 0;

  let outlierSum = 0;
  let inlierSum = 0;
  outlierValues.forEach(v => (outlierSum += v));
  inlierValues.forEach(v => (inlierSum += v));

  if (outlierSum === 0 && inlierSum === 0) return 0;
  if (outlierSum === 0 || inlierSum === 0) {
    const presentValues = outlierSum > 0 ? outlierValues : inlierValues;
    if (presentValues.size <= 1) return 0;
    const presentSum = outlierSum > 0 ? outlierSum : inlierSum;
    let maxNormPct = 0;
    presentValues.forEach(v => {
      const pct = (v / presentSum) * 100;
      if (pct > maxNormPct) maxNormPct = pct;
    });
    return maxNormPct;
  }

  let maxDelta = 0;
  allValues.forEach(value => {
    const outlierNorm = ((outlierValues.get(value) ?? 0) / outlierSum) * 100;
    const inlierNorm = ((inlierValues.get(value) ?? 0) / inlierSum) * 100;
    const delta = Math.abs(outlierNorm - inlierNorm);
    if (delta > maxDelta) maxDelta = delta;
  });
  return maxDelta;
}

/** Well-known OTel attribute suffixes that get a tiebreaker score boost. */
const BOOSTED_ATTRIBUTE_SUFFIXES = [
  'service.name',
  'http.method',
  'http.request.method',
  'http.status_code',
  'http.response.status_code',
  'error',
  'error.type',
  'deployment.environment',
  'deployment.environment.name',
  'rpc.method',
  'rpc.service',
  'db.system',
  'db.operation',
  'messaging.system',
  'messaging.operation',
];

/** 1 for well-known OTel attributes (dot-segment match), 0 otherwise. */
export function semanticBoost(key: string): number {
  const lowerKey = key.toLowerCase();
  for (const suffix of BOOSTED_ATTRIBUTE_SUFFIXES) {
    if (lowerKey.endsWith('.' + suffix) || lowerKey === suffix) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Sampling configuration (used by callers that build their own queries)
// ---------------------------------------------------------------------------

export const SAMPLE_SIZE = 1000;
export const MIN_SAMPLE_SIZE = 500;
export const MAX_SAMPLE_SIZE = 5000;
export const SAMPLE_RATIO = 0.01;

export function getStableSampleExpression(spanIdExpression?: string): string {
  if (spanIdExpression) {
    return `cityHash64(${spanIdExpression})`;
  }
  return 'rand()';
}

export function computeEffectiveSampleSize(totalCount: number): number {
  if (totalCount <= 0) return SAMPLE_SIZE;
  return Math.min(
    MAX_SAMPLE_SIZE,
    Math.max(MIN_SAMPLE_SIZE, Math.ceil(totalCount * SAMPLE_RATIO)),
  );
}

// ---------------------------------------------------------------------------
// Composed: rank properties by their group-to-group delta
// ---------------------------------------------------------------------------

export interface RankedProperty {
  key: string;
  /** computeComparisonScore + semanticBoost*0.1 (boost only applied when score > 0) */
  score: number;
  baseScore: number;
  semanticBoost: number;
  hidden: boolean;
  hiddenReason?: 'denylist' | 'high_cardinality';
}

export interface RankPropertiesOptions {
  /** Rows in the target / outlier group. */
  targetRows: Record<string, any>[];
  /** Rows in the baseline / inlier group. */
  baselineRows: Record<string, any>[];
  /** Column metadata (name + ClickHouse type) for denylist + cardinality checks. */
  columnMeta: { name: string; type: string }[];
}

export interface RankPropertiesResult {
  ranked: RankedProperty[];
  targetStats: PropertyStatistics;
  baselineStats: PropertyStatistics;
}

/**
 * Run getPropertyStatistics on both groups, then rank every property by
 * computeComparisonScore + semanticBoost. Annotates each entry with whether
 * it would be hidden in the UI (denylisted ID / timestamp arrays, or high
 * cardinality). Pure function — does not query ClickHouse.
 */
export function rankProperties(
  opts: RankPropertiesOptions,
): RankPropertiesResult {
  const targetStats = getPropertyStatistics(opts.targetRows);
  const baselineStats = getPropertyStatistics(opts.baselineRows);

  const uniqueKeys = new Set<string>([
    ...targetStats.valueOccurences.keys(),
    ...baselineStats.valueOccurences.keys(),
  ]);

  const ranked: RankedProperty[] = [];
  for (const key of uniqueKeys) {
    const targetValueCounts =
      targetStats.valueOccurences.get(key) ?? new Map<string, number>();
    const baselineValueCounts =
      baselineStats.valueOccurences.get(key) ?? new Map<string, number>();

    const baseScore = computeComparisonScore(
      targetValueCounts,
      baselineValueCounts,
    );
    const boost = baseScore > 0 ? semanticBoost(key) : 0;
    const score = baseScore + boost * 0.1;

    let hidden = false;
    let hiddenReason: 'denylist' | 'high_cardinality' | undefined;
    if (isDenylisted(key, opts.columnMeta)) {
      hidden = true;
      hiddenReason = 'denylist';
    } else if (
      isHighCardinality(
        key,
        targetStats.valueOccurences,
        baselineStats.valueOccurences,
        targetStats.propertyOccurences,
        baselineStats.propertyOccurences,
      )
    ) {
      hidden = true;
      hiddenReason = 'high_cardinality';
    }

    ranked.push({
      key,
      score,
      baseScore,
      semanticBoost: boost,
      hidden,
      hiddenReason,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return { ranked, targetStats, baselineStats };
}
