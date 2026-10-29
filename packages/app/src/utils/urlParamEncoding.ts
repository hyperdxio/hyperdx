/**
 * The inner encoding layer of `parseAsStringEncoded` / `parseAsJsonEncoded`
 * (see `queryParsers.ts` for why it exists). Kept free of nuqs so code that
 * builds links to those params can share it without loading nuqs at import
 * time.
 */
export const encodeUrlParamValue = (value: string) => encodeURIComponent(value);

export const decodeUrlParamValue = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed URI sequence – return as-is for robustness.
    return value;
  }
};

export const encodeJsonUrlParamValue = (value: unknown) =>
  encodeUrlParamValue(JSON.stringify(value));
