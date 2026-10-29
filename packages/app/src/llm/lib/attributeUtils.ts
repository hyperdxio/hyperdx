import { SpanAttributeMap } from './types';

/** Type guard for plain objects (excludes arrays and null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Guard for anything string-indexable (objects and arrays). */
function isIndexable(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

/**
 * Read an attribute as a display string. Map columns store everything as
 * strings; JSON columns may return numbers/booleans/objects.
 */
export function asString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** Read an attribute as a finite number, tolerating string encodings. */
export function asNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Parse a value that may be a JSON string or an already-parsed object. */
export function parseMaybeJson(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (!/^[[{"]|^-?\d|^(true|false|null)$/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** First defined string among the given attribute keys. */
export function firstString(
  attributes: SpanAttributeMap,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = asString(attributes[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** First defined number among the given attribute keys. */
export function firstNumber(
  attributes: SpanAttributeMap,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = asNumber(attributes[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** True if any attribute key starts with the given prefix. */
export function hasKeyWithPrefix(
  attributes: SpanAttributeMap,
  prefix: string,
): boolean {
  return Object.keys(attributes).some(key => key.startsWith(prefix));
}

/**
 * Upper bound for numeric key-path indices. Real conversations have at most
 * a few hundred entries; attribute keys arrive verbatim from ingested
 * telemetry, and a key like `llm.input_messages.2000000000.message.content`
 * would otherwise create a ~2e9-length sparse array whose filter/map
 * iteration freezes the tab (~27s per pass measured in V8).
 */
const MAX_KEY_PATH_INDEX = 4096;

/**
 * Reconstruct an array of objects from key-path attributes, e.g.
 * `gen_ai.prompt.0.role` / `gen_ai.prompt.0.content` →
 * `[{ role, content }]`. Nested indices ("tool_calls.0.name") produce nested
 * arrays/objects. Used by the OpenLLMetry and OpenInference adapters.
 */
export function keyPathsToArray(
  attributes: SpanAttributeMap,
  prefix: string,
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const fullPrefix = `${prefix}.`;
  for (const [key, rawValue] of Object.entries(attributes)) {
    if (!key.startsWith(fullPrefix)) continue;
    const path = key.slice(fullPrefix.length).split('.');
    const index = Number(path[0]);
    if (!Number.isInteger(index) || index < 0 || path.length < 2) continue;
    // Every integer segment indexes into an array (top-level or nested), so
    // one oversized index anywhere in the path is rejected wholesale.
    if (
      path.some(segment => {
        const n = Number(segment);
        return Number.isInteger(n) && n > MAX_KEY_PATH_INDEX;
      })
    ) {
      continue;
    }

    let node: Record<string, unknown> = (items[index] ??= {});
    for (let i = 1; i < path.length - 1; i++) {
      const segment = path[i];
      const nextIsIndex = Number.isInteger(Number(path[i + 1]));
      const existing = node[segment];
      // Arrays are valid nodes here (nested indices) — only initialize when
      // the slot isn't an object at all.
      if (existing == null || typeof existing !== 'object') {
        node[segment] = nextIsIndex ? [] : {};
      }
      const next: unknown = node[segment];
      if (!isIndexable(next)) break; // unreachable: initialized above
      node = next;
    }
    node[path[path.length - 1]] = rawValue;
  }
  // Key-path indices may be sparse; drop holes.
  return items.filter(item => item != null);
}
