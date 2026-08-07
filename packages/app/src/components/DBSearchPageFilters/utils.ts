// Utility functions for parsing and grouping map-like field names

import {
  parseKeyPath,
  parseRenderedJsonStringExpression,
  quoteIdentifierIfNeeded,
  renderJsonStringExpression,
  stripClickHouseJsonTypeSuffix,
} from '@hyperdx/common-utils/dist/core/metadata';
import type { FilterState } from '@hyperdx/common-utils/dist/filters';

import { mergePath } from '@/utils';

// Clean ClickHouse expressions to extract clean property paths
export function cleanClickHouseExpression(key: string): string {
  const renderedJsonKey = parseRenderedJsonStringExpression(key);
  if (renderedJsonKey) {
    return renderedJsonKey.key === ''
      ? `${renderedJsonKey.column}['']`
      : `${renderedJsonKey.column}.${renderedJsonKey.key}`;
  }

  // Remove toString() wrapper if present
  let cleanKey = key.replace(/^toString\((.+)\)$/, '$1');

  // Typed JSON subcolumns use a terminal ClickHouse type suffix
  // (ResourceAttributes.`k8s`.`namespace`.`name`.:String). The sidebar keeps
  // clean, type-free keys in memory so persisted URL filters match facet keys.
  cleanKey = stripClickHouseJsonTypeSuffix(cleanKey);

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

// A key that begins with `identifier(` is a raw SQL function call (e.g.
// `toString(...)`, `JSONExtractString(...)`), not a column name or a dot-form
// Map sub-key, so it is already a valid ClickHouse expression.
const isSqlFunctionCallExpression = (key: string): boolean =>
  /^[A-Za-z_]\w*\(/.test(key);

// Coerce a filterState key into a ClickHouse expression suitable for raw SQL.
// A dot-form Map sub-key like `LogAttributes.host.name` is rewritten to bracket
// form `LogAttributes['host.name']` via `mergePath` so the conversion stays
// consistent with the keys produced by the facet-discovery path. Bracket form,
// backtick-quoted JSON paths, raw SQL function-call expressions
// (`toString(...)`, `JSONExtractString(...)`), and plain column names are
// returned unchanged. Use this when handing a filterState key off to a SQL
// caller (e.g. "Load more" via metadata.getKeyValues), since `setFilterValue`
// normalizes Map sub-keys to dot form which ClickHouse cannot resolve as map
// access.
//
// `parseMapFieldName` already guarantees `parsed.baseName` is a Map (its only
// callers are the dot-form facet keys that originate from Map columns), so
// `mergePath` must treat it as one. Without the third argument, a numeric-
// looking sub-key like `LogAttributes.1` collapses into the Array branch and
// emits the illegal `LogAttributes[2]`. HDX-4369.
export function toClickHouseKeyExpression(key: string): string {
  if (
    key.includes("['") ||
    key.includes('["') ||
    key.includes('`') ||
    // "Add to Filters" on a value inside parsed JSON from a String column builds
    // a function-call key (e.g. JSONExtractString(Body, 'app.user.currency'));
    // it must pass through untouched. Without this, parseMapFieldName splits on
    // the dot inside the quoted argument and mergePath mangles it into the
    // invalid `JSONExtractString(Body, 'app['user.currency')']`. HDX-4427.
    isSqlFunctionCallExpression(key)
  ) {
    return key;
  }
  const parsed = parseMapFieldName(key);
  if (!parsed) return key;
  return mergePath(
    [parsed.baseName, parsed.propertyPath],
    [],
    [parsed.baseName],
  );
}

type KeyExpressionOptions = {
  jsonColumns?: readonly string[];
};

/**
 * Coerce a filterState key into a ClickHouse expression suitable for raw SQL,
 * backtick-quoting identifiers with special characters.
 *
 * `knownColumns` is the set of real top-level column names on the table. Only
 * keys matching a known column or accessing a map key of a known column will
 * be quoted.
 */
export function toQuotedClickHouseKeyExpression(
  key: string,
  knownColumns: Set<string>,
  options: KeyExpressionOptions = {},
): string {
  const jsonColumns = new Set(options.jsonColumns ?? []);

  // A whole-key match against a real column wins: quote the entire name as one
  // identifier (handles flat columns whose name contains dots/hyphens/etc.).
  if (knownColumns.has(key)) {
    return quoteIdentifierIfNeeded(key);
  }

  const parsedKey = parseMapFieldName(key);
  if (parsedKey && jsonColumns.has(parsedKey.baseName)) {
    return renderJsonStringExpression(
      parsedKey.baseName,
      parsedKey.propertyPath,
    );
  }

  // Normalize dot-form (ResourceAttributes.host.name) to map access form (ResourceAttributes['host.name'])
  const expr = toClickHouseKeyExpression(key);

  // Already quoted: leave untouched
  if (expr.startsWith('`') || expr.startsWith('"')) {
    return expr;
  }

  // Quote a map column name and leave the property path untouched, e.g. `LogAttributes`['host.name'].
  const path = parseKeyPath(expr);
  if (path.length >= 2 && knownColumns.has(path[0])) {
    const bracketStart = expr.indexOf('[');
    return `${quoteIdentifierIfNeeded(path[0])}${expr.slice(bracketStart)}`;
  }

  return expr;
}
