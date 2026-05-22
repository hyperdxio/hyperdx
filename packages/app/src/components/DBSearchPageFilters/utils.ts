// Utility functions for parsing and grouping map-like field names

import { parseKeyPath } from '@hyperdx/common-utils/dist/core/metadata';
import type { FilterState } from '@hyperdx/common-utils/dist/filters';

// Clean ClickHouse expressions to extract clean property paths
export function cleanClickHouseExpression(key: string): string {
  // Remove toString() wrapper if present
  let cleanKey = key.replace(/^toString\((.+)\)$/, '$1');

  // Convert backtick dot notation to clean dot notation
  // e.g., `host`.`arch` -> host.arch
  cleanKey = cleanKey.replace(/`([^`]+)`/g, '$1');

  return cleanKey;
}

// Parse map-like field names and extract the base name and property path
export function parseMapFieldName(
  key: string,
): { baseName: string; propertyPath: string } | null {
  const cleanKey = cleanClickHouseExpression(key);
  const path = parseKeyPath(cleanKey);

  if (path.length >= 2) {
    return {
      baseName: path[0],
      propertyPath: path.slice(1).join('.'),
    };
  }

  // Match dot notation patterns like: json_column.key or json_column.key.subkey
  const dotPattern = /^([^.]+)\.(.+)$/;
  const dotMatch = cleanKey.match(dotPattern);

  if (dotMatch) {
    return {
      baseName: dotMatch[1],
      propertyPath: dotMatch[2],
    };
  }

  return null;
}

// Bracket-form keys (e.g. LogAttributes['time']) are the canonical SQL form
// produced by mergePath for Map columns, while dot-form keys
// (e.g. LogAttributes.time) are what setFilterValue stores after its
// parseKeyPath().join('.') normalization and what parseLuceneFilter returns
// on URL load. Same logical field, different raw string.
function isBracketFormMapKey(key: string): boolean {
  return key.includes("['") || key.includes('["');
}

// Group facets by their base names for map-like fields.
//
// De-duplicates children that resolve to the same (baseName, propertyPath)
// — a filterState entry like `LogAttributes.time` and a facet entry like
// `LogAttributes['time']` refer to the same logical field and must collapse
// into a single child. When merging, we keep the bracket-form key so
// `child.key` remains a valid ClickHouse expression for "Load more" SQL.
export function groupFacetsByBaseName(
  facets: { key: string; value: (string | boolean)[] }[],
) {
  const grouped: Map<
    string,
    {
      key: string;
      value: (string | boolean)[];
      children: {
        key: string;
        value: (string | boolean)[];
        propertyPath: string;
      }[];
    }
  > = new Map();
  const nonGrouped: { key: string; value: (string | boolean)[] }[] = [];

  for (const facet of facets) {
    const parsed = parseMapFieldName(facet.key);
    if (parsed) {
      const { baseName, propertyPath } = parsed;
      if (!grouped.has(baseName)) {
        grouped.set(baseName, {
          key: baseName,
          value: [], // Base name doesn't have direct values
          children: [],
        });
      }
      const group = grouped.get(baseName)!;
      const existing = group.children.find(
        c => c.propertyPath === propertyPath,
      );
      if (existing) {
        const mergedValues: (string | boolean)[] = [...existing.value];
        for (const v of facet.value) {
          if (!mergedValues.includes(v)) {
            mergedValues.push(v);
          }
        }
        existing.value = mergedValues;
        if (
          isBracketFormMapKey(facet.key) &&
          !isBracketFormMapKey(existing.key)
        ) {
          existing.key = facet.key;
        }
      } else {
        group.children.push({
          ...facet,
          propertyPath,
        });
      }
    } else {
      nonGrouped.push(facet);
    }
  }

  return { grouped: Array.from(grouped.values()), nonGrouped };
}

// Look up a filterState entry by either bracket-form or dot-form map sub-key.
// Bracket form is the canonical SQL key used in facet results; dot form is
// what setFilterValue stores after its parseKeyPath().join('.') normalization
// and what parseLuceneFilter restores from a Lucene URL round-trip. Reads
// need to tolerate either so the user's selection still resolves regardless
// of which form `child.key` carries after groupFacetsByBaseName's merge.
export function getFilterStateEntry(
  filterState: FilterState,
  key: string,
): FilterState[string] | undefined {
  const direct = filterState[key];
  if (direct) return direct;
  const parsed = parseMapFieldName(key);
  if (!parsed) return undefined;
  return (
    filterState[`${parsed.baseName}.${parsed.propertyPath}`] ??
    filterState[`${parsed.baseName}['${parsed.propertyPath}']`]
  );
}

// Coerce a filterState key into a ClickHouse expression suitable for raw SQL.
// A dot-form Map sub-key like `LogAttributes.host.name` is rewritten to bracket
// form `LogAttributes['host.name']`. Bracket form, backtick-quoted JSON paths,
// `toString(...)` wrappers, and plain column names are returned unchanged. Use
// this when handing a filterState key off to a SQL caller (e.g. "Load more"
// via metadata.getKeyValues), since `setFilterValue` normalizes Map sub-keys
// to dot form which ClickHouse cannot resolve as map access.
export function toClickHouseKeyExpression(key: string): string {
  if (
    key.includes("['") ||
    key.includes('["') ||
    key.includes('`') ||
    key.startsWith('toString(')
  ) {
    return key;
  }
  const parsed = parseMapFieldName(key);
  if (!parsed) return key;
  return `${parsed.baseName}['${parsed.propertyPath}']`;
}
