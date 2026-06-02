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
 * Parses a Map-access key string into a path array.
 *
 * Handles ClickHouse Map access forms:
 *   - Bracket form (canonical input):
 *       `ResourceAttributes['service.name']` -> `['ResourceAttributes', 'service.name']`
 *       `ResourceAttributes["service.name"]` -> `['ResourceAttributes', 'service.name']`
 *   - Function-call form (what ClickHouse renders in result column names):
 *       `arrayElement(ResourceAttributes, 'service.name')` -> `['ResourceAttributes', 'service.name']`
 *
 * Native columns return a single-element path:
 *   `ServiceName` -> `['ServiceName']`
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
  // ClickHouse Map access function-call form. ClickHouse renders Map
  // subscript expressions (e.g. `SpanAttributes['http.route']`) as
  // `arrayElement(SpanAttributes, 'http.route')` in result column names.
  const ARRAY_ELEMENT_PREFIX = 'arrayElement(';
  if (key.startsWith(ARRAY_ELEMENT_PREFIX) && key.endsWith(')')) {
    const inner = key.slice(ARRAY_ELEMENT_PREFIX.length, -1);
    const parts = inner.split(',').map(e => e.trim());
    return [parts[0], parts[1].replaceAll("'", '')];
  }
  return [key];
}
