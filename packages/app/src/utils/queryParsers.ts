import { createParser } from 'nuqs';
import { SortingState } from '@tanstack/react-table';

/**
 * Problem: nuqs serializes spaces as '+' (form-encoding). When
 * URLs are shared via Microsoft Teams (and some other systems), they re-encode
 * '+' as '%2B'. That makes '%2B' decode as a literal '+' instead of a space,
 * breaking lucene queries, SQL expressions, etc.
 *
 * Fix: pre-encode the value with encodeURIComponent in serialize (spaces →
 * '%20', brackets, quotes, etc. also encoded). nuqs then double-encodes our
 * '%' signs ('%20' → '%2520'). Teams sees only '%XX' sequences and leaves
 * them alone. On load, URLSearchParams.get() decodes one level and our parse
 * function decodes the second level.
 *
 * Backward compatible: old URLs where nuqs wrote '+' for spaces are still
 * handled correctly because URLSearchParams.get() decodes '+' → ' ' before
 * our parse function runs, and decodeURIComponent of a plain string is a no-op.
 *
 * Also supersedes parseAsStringWithNewLines (encodeURIComponent encodes \n
 * as %0A automatically).
 */
export const parseAsStringEncoded = createParser<string>({
  parse: value => {
    try {
      return decodeURIComponent(value);
    } catch {
      // Malformed URI sequence – return as-is for robustness.
      return value;
    }
  },
  serialize: value => encodeURIComponent(value),
});

/**
 * Same double-encoding protection as parseAsStringEncoded, but wraps
 * JSON.stringify / JSON.parse around the value.
 *
 * Backward compatible: old URLs where nuqs wrote raw JSON are parsed before
 * URI decoding, so literal '%XX' text inside JSON strings is preserved. New
 * URLs are decoded before JSON.parse so their encoded structure still works.
 *
 * Optional `validate`: a guard that either returns the (narrowed) value or
 * throws / returns `null` for a shape mismatch. A stale, hand-edited, or
 * cross-version URL whose param is valid JSON but the wrong shape (`{}`, `5`,
 * `"x"`, an array of malformed frames) then resolves to `null` instead of a
 * structurally-invalid object. Combined with `.withDefault(...)`, callers get
 * the safe default rather than a value that throws downstream during render.
 * Zod schemas satisfy this signature via `schema.parse`.
 */
export function parseAsJsonEncoded<T>(validate?: (value: unknown) => T) {
  const finalize = (parsed: unknown): T | null => {
    if (!validate) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return parsed as T;
    }
    try {
      const validated = validate(parsed);
      // A validator may signal rejection by returning null/undefined instead
      // of throwing; treat both the same as a thrown mismatch.
      return validated == null ? null : validated;
    } catch {
      return null;
    }
  };

  return createParser<T>({
    parse: value => {
      try {
        return finalize(JSON.parse(value));
      } catch {
        // New-format values are percent-encoded, so they cannot be parsed as
        // raw JSON. Fall through to the decoded representation.
      }

      try {
        return finalize(JSON.parse(decodeURIComponent(value)));
      } catch {
        return null;
      }
    },
    serialize: value => encodeURIComponent(JSON.stringify(value)),
  });
}

export const parseAsSortingStateString = createParser<SortingState[number]>({
  parse: value => {
    if (!value) {
      return null;
    }
    const keys = value.split(' ');
    const direction = keys.pop();
    const key = keys.join(' ');
    return {
      id: key,
      desc: direction === 'DESC',
    };
  },
  serialize: value => {
    if (!value) {
      return '';
    }
    return `${value.id} ${value.desc ? 'DESC' : 'ASC'}`;
  },
});
