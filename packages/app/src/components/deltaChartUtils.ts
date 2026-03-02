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
  };
}

// Maximum number of distinct values to show in a chart before collapsing
// the rest into an "Other (N)" bucket. The effective limit adapts: when the
// actual unique count is at most MAX_CHART_VALUES_UPPER, all values are shown
// without aggregation. This avoids the awkward "Other (1)" or "Other (2)" cases
// for attributes like http.status_code that naturally have 4-8 values.
export const MAX_CHART_VALUES = 6;
export const MAX_CHART_VALUES_UPPER = 8;

// Color for the "All spans" distribution bar (no selection / comparison mode off).
// Uses Mantine's blue-6 CSS variable so it adapts to light/dark themes.
export const ALL_SPANS_COLOR = 'var(--mantine-color-blue-6)';

// Color for the "Other (N)" aggregated bucket — neutral gray.
export const OTHER_BUCKET_COLOR = 'var(--mantine-color-gray-5)';

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
    (a, b) =>
      b.outlierCount + b.inlierCount - (a.outlierCount + a.inlierCount),
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
