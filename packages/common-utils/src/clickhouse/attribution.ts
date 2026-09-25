/**
 * Tags each ClickHouse query with what asked for it, so a row in
 * `system.query_log` points back to a tile, a search, or an alert.
 *
 * Records what was asked for, never who asked. No team, user or session id
 * goes in here.
 *
 * Two places carry the tag. `log_comment` holds the JSON and is what you query
 * later. `query_id` gets an `hdx-<surface>-<uuid>` prefix, which is readable in
 * `system.processes` while the query is still running.
 *
 * None of this changes what a query returns, so it must never throw.
 *
 * One exception: queries that set `shouldSkipApplySettings` have their
 * settings dropped, so they get a `query_id` but no `log_comment`.
 */

/**
 * Which part of the product sent the query.
 */
export const QUERY_SURFACES = [
  'alert',
  'api',
  'chart-preview',
  'cli',
  'dashboard',
  'mcp',
  'metadata',
  'metrics-explorer',
  'search',
  'service-dashboard',
  'session-replay',
  'unknown',
] as const;

export type QuerySurface = (typeof QUERY_SURFACES)[number];

/**
 * What we know about one query. Everything is optional; callers fill in
 * whatever they have.
 *
 * These key names end up in the log, so people write queries against them.
 * Renaming one breaks those queries, which is what `QUERY_ATTRIBUTION_VERSION`
 * is for.
 */
export type QueryAttribution = {
  surface?: QuerySurface;
  dashboard?: string;
  tile?: string;
  search?: string;
  alert?: string;
  source?: string;
  trace?: string;
  /** Anything more specific than the surface, e.g. an MCP tool name. */
  label?: string;
};

/**
 * Written as `v` into every log comment. Callers cannot set it per query.
 */
export const QUERY_ATTRIBUTION_VERSION = 1;

/**
 * ClickHouse allows far more, but the browser sends settings in the URL, and a
 * long URL pushes the request onto a path some proxies reject.
 */
const MAX_LOG_COMMENT_BYTES = 1024;

/** Longest any single value may be. */
const MAX_FIELD_LENGTH = 128;

/**
 * Most useful first. If the payload runs out of room, fields at the end are
 * dropped whole, so the result is still valid JSON.
 *
 * Today's fields cannot fill the budget even at full length, so nothing is
 * ever dropped. This keeps that true if fields are added later.
 *
 * Pairs rather than a list of key names, so nothing below has to read a field
 * out of the attribution through a variable key.
 */
function idFields(
  attribution: QueryAttribution,
): readonly (readonly [string, string | undefined])[] {
  return [
    ['dashboard', attribution.dashboard],
    ['tile', attribution.tile],
    ['search', attribution.search],
    ['alert', attribution.alert],
    ['source', attribution.source],
    ['trace', attribution.trace],
    ['label', attribution.label],
  ];
}

/**
 * Keep an allowlist of characters and cap the length.
 *
 * An allowlist rather than a denylist because from the browser this value
 * travels in the URL query string. An `&`, `?` or `#` reaching the proxy ends
 * the value early and injects a bogus parameter, which ClickHouse then
 * rejects — so one odd character in a dashboard id would fail every query on
 * the page, not just lose its tag.
 *
 * Restricting to ASCII also means the length cap counts bytes as well as
 * characters, so the payload budget is exact, and no multi-byte character can
 * be cut in half into something ClickHouse cannot parse as JSON.
 *
 * Everything we put here is an id, a route or a name we chose, so nothing
 * legitimate is lost. Values are only ever JSON strings, never SQL.
 */
function sanitizeField(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;

  // Checked by code point, not a regex, so no control character has to appear
  // in this file - a stray one would make it read as binary to grep.
  const isAllowed = (code: number) =>
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x20 || // space
    code === 0x2d || // -
    code === 0x2e || // .
    code === 0x2f || // /
    code === 0x3a || // :
    code === 0x5f; // _

  let kept = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (isAllowed(code)) kept += char;
  }

  const cleaned = kept.trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, MAX_FIELD_LENGTH);
}

function isQuerySurface(value: unknown): value is QuerySurface {
  return (
    typeof value === 'string' &&
    (QUERY_SURFACES as readonly string[]).includes(value)
  );
}

/**
 * Later layers win, but only where they have a value. So a tile can add its own
 * id without erasing the dashboard id it sits inside.
 */
export function mergeQueryAttribution(
  ...layers: (QueryAttribution | undefined)[]
): QueryAttribution {
  const merged: QueryAttribution = {};
  for (const layer of layers) {
    if (!layer) continue;

    // Field by field: a spread would copy an `undefined` over a real value.
    if (layer.surface) merged.surface = layer.surface;
    if (layer.dashboard) merged.dashboard = layer.dashboard;
    if (layer.tile) merged.tile = layer.tile;
    if (layer.search) merged.search = layer.search;
    if (layer.alert) merged.alert = layer.alert;
    if (layer.source) merged.source = layer.source;
    if (layer.trace) merged.trace = layer.trace;
    if (layer.label) merged.label = layer.label;
  }
  return merged;
}

/** Returns undefined when there is nothing worth recording. */
export function buildLogComment(
  attribution: QueryAttribution | undefined,
): string | undefined {
  if (!attribution) return undefined;

  // A Map, not an object literal: insertion order is the drop order, and
  // nothing here is written through a variable key.
  const payload = new Map<string, string | number>([
    ['v', QUERY_ATTRIBUTION_VERSION],
  ]);

  const surface = isQuerySurface(attribution.surface)
    ? attribution.surface
    : undefined;
  if (surface) {
    payload.set('surface', surface);
  }

  let serialized = safeStringify(payload);
  if (serialized === undefined) return undefined;

  for (const [field, raw] of idFields(attribution)) {
    const cleaned = sanitizeField(raw);
    if (!cleaned) continue;

    payload.set(field, cleaned);
    const candidate = safeStringify(payload);
    if (
      candidate === undefined ||
      byteLength(candidate) > MAX_LOG_COMMENT_BYTES
    ) {
      payload.delete(field);
      continue;
    }
    serialized = candidate;
  }

  // Only the version survived, so there is nothing to say.
  return payload.size > 1 ? serialized : undefined;
}

function safeStringify(payload: Map<string, string | number>) {
  try {
    return JSON.stringify(Object.fromEntries(payload));
  } catch {
    return undefined;
  }
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

/**
 * Browsers hide `crypto.randomUUID` on plain HTTP, which is how plenty of
 * self-hosted HyperDX is reached, hence the fallback. These ids only need to
 * be distinct, not unguessable.
 */
function randomId(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) {
    try {
      return cryptoObj.randomUUID();
    } catch {
      // fall through
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const rand = (Math.random() * 16) | 0;
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * The random part is required: ClickHouse rejects a query whose id matches one
 * already running.
 */
export function buildQueryId(
  attribution: QueryAttribution | undefined,
): string {
  const surface = isQuerySurface(attribution?.surface)
    ? attribution.surface
    : 'unknown';
  return `hdx-${surface}-${randomId()}`;
}
