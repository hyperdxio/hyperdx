import LZString from 'lz-string';

// Prefix that marks a value as lz-string compressed.
// '~' is an RFC 3986 unreserved character so it is never encoded by browsers
// or mangled by URL-sharing platforms (Teams, Slack, etc.), and it cannot
// appear in lz-string's own base64url output alphabet (A-Za-z0-9+-=), so
// presence of this prefix unambiguously identifies the new compressed format.
const LZ_PREFIX = '~';

/**
 * Compresses and URL-encodes a JSON-serializable value for use as a URL parameter.
 * Output contains only URL-safe characters and is significantly shorter than
 * JSON.stringify for large objects (100+ characters), but may be slightly longer
 * for small payloads due to lz-string's encoding overhead.
 */
export function compressUrlParam(value: unknown): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(value));
}

/**
 * Decompresses a URL parameter value produced by compressUrlParam.
 * Falls back to plain JSON.parse for backwards compatibility with
 * existing links created before compression was introduced.
 * Returns null if neither strategy succeeds (nuqs treats null as "use default").
 */
export function decompressUrlParam<T>(value: string): T | null {
  // Strategy 1: lz-string compressed value (new format)
  try {
    const decompressed = LZString.decompressFromEncodedURIComponent(value);
    if (decompressed != null) {
      return JSON.parse(decompressed) as T;
    }
  } catch {
    // Decompression or JSON parse failed — fall through to strategy 2
  }

  // Strategy 2: plain JSON (old format, backwards compatibility)
  try {
    return JSON.parse(value) as T;
  } catch {
    // Not valid JSON either
  }

  return null;
}

/**
 * Compresses a plain string URL parameter.
 * Output is prefixed with LZ_PREFIX so the decompressor can detect the format
 * without guessing, eliminating false-positive decompression of old plain-text URLs.
 */
export function compressStringParam(value: string): string {
  return LZ_PREFIX + LZString.compressToEncodedURIComponent(value);
}

/**
 * Decompresses a plain string URL parameter produced by compressStringParam.
 * Falls back to the raw value for backwards compatibility with existing links.
 * Also handles the legacy %0A → newline encoding used by parseAsStringWithNewLines.
 */
export function decompressStringParam(value: string): string {
  if (value.startsWith(LZ_PREFIX)) {
    const decompressed = LZString.decompressFromEncodedURIComponent(
      value.slice(LZ_PREFIX.length),
    );
    if (decompressed != null) return decompressed;
  }
  // Old URL fallback: apply the same newline handling as the legacy parser
  return value.replace(/%0A/g, '\n');
}
