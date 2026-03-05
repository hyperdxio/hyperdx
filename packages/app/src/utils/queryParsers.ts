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
 * Backward compatible: old URLs where nuqs wrote raw JSON (with '+' for
 * spaces, unencoded '[', ']', etc.) are handled via a fallback to plain
 * JSON.parse after the decodeURIComponent step naturally resolves '%22' →
 * '"', '+' → ' ', etc. via URLSearchParams.get().
 */
export function parseAsJsonEncoded<T>() {
  return createParser<T>({
    parse: value => {
      let decoded: string;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        // Malformed URI sequence — value is likely old-format plain JSON.
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      // URI decoded successfully; parse the decoded string as JSON.
      // This handles both new-format (double-encoded) and old-format URLs,
      // since decodeURIComponent is a no-op on plain JSON strings.
      try {
        return JSON.parse(decoded);
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
