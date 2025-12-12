// Utility functions for parsing and grouping map-like field names

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
  // First clean the ClickHouse expression
  const cleanKey = cleanClickHouseExpression(key);

  // Match patterns like: ResourceAttributes['some.property'], SpanAttributes['key'], or json_column.key
  const mapPattern = /^([^[]+)\[['"]([^'"]+)['"]\]$/;
  const match = cleanKey.match(mapPattern);

  if (match) {
    return {
      baseName: match[1],
      propertyPath: match[2],
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

// Group facets by their base names for map-like fields
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
      group.children.push({
        ...facet,
        propertyPath,
      });
    } else {
      nonGrouped.push(facet);
    }
  }

  return { grouped: Array.from(grouped.values()), nonGrouped };
}
