import LZString from 'lz-string';

/**
 * Compresses and URL-encodes a JSON-serializable value for use as a URL parameter.
 * Output contains only URL-safe characters (alphanumeric + a small set),
 * and is typically 60-70% shorter than JSON.stringify for complex objects.
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
 */
export function compressStringParam(value: string): string {
  return LZString.compressToEncodedURIComponent(value);
}

/**
 * Decompresses a plain string URL parameter produced by compressStringParam.
 * Falls back to the raw value for backwards compatibility with existing links.
 * Also handles the legacy %0A → newline encoding used by parseAsStringWithNewLines.
 */
export function decompressStringParam(value: string): string {
  const decompressed = LZString.decompressFromEncodedURIComponent(value);
  if (decompressed != null) return decompressed;
  // Old URL fallback: apply the same newline handling as the legacy parser
  return value.replace(/%0A/g, '\n');
}
