/**
 * Leaf module for the bracket-notation -> path-array helper. Lives in
 * its own file so `types.ts` can normalize dashboard-filter expressions
 * with the same rules `core/metadata.ts` applies to query parsing,
 * without dragging the heavy ClickHouse / query-rendering deps of
 * `core/metadata.ts` into the types module (which would form a circular
 * import: `types.ts -> metadata.ts -> clickhouse/* -> guards.ts ->
 * types.ts`).
 *
 * Imported by `types.ts`, `core/metadata.ts` (re-export), and any other
 * module that needs the normalization (e.g. `filters.ts`, `queryParser.ts`).
 */

/**
 * Parses a bracket-notation key string into a path array.
 * e.g. `ResourceAttributes['service.name']` -> `['ResourceAttributes', 'service.name']`
 *      `ServiceName` -> `['ServiceName']`
 *
 * Currently handles a single trailing bracket segment. Nested
 * bracket-notation (e.g. `SpanAttributes['k8s']['pod']`) is uncommon in
 * dashboard filter expressions and is treated as a single key by all
 * call sites that consume the result, so they all see the same key.
 */
export function parseKeyPath(key: string): string[] {
  const singleIdx = key.indexOf("['");
  if (singleIdx !== -1 && key.endsWith("']")) {
    return [key.slice(0, singleIdx), key.slice(singleIdx + 2, -2)];
  }
  const doubleIdx = key.indexOf('["');
  if (doubleIdx !== -1 && key.endsWith('"]')) {
    return [key.slice(0, doubleIdx), key.slice(doubleIdx + 2, -2)];
  }
  return [key];
}
