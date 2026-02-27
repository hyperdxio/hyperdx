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
