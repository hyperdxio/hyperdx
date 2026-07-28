/**
 * Reserved query param that carries a compressed snapshot of a page's view
 * state. Kept short since it prefixes every shared link.
 */
export const SHARE_PARAM = 'share';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(token: string): Uint8Array {
  const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function pipe(
  input: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  // Drive both ends concurrently (no backpressure), and settle BOTH sides even
  // on error so a failing stream (e.g. a corrupt token) can't leak an unhandled
  // rejection into a later task.
  const writer = stream.writable.getWriter();
  const write = writer.write(input as BufferSource).then(() => writer.close());
  const read = readAll(stream.readable as ReadableStream<Uint8Array>);
  const [writeResult, readResult] = await Promise.allSettled([write, read]);
  if (writeResult.status === 'rejected') {
    throw writeResult.reason;
  }
  if (readResult.status === 'rejected') {
    throw readResult.reason;
  }
  return readResult.value;
}

/**
 * Compress a URL query string into a compact, URL-safe token using the native
 * `CompressionStream` (raw DEFLATE) + base64url. base64url is inherently
 * URL-safe (no `+`, `/`, `=`), so the token survives the URL bar untouched.
 *
 * @param search The query string WITHOUT the leading '?'.
 */
export async function encodeShareToken(search: string): Promise<string> {
  const compressed = await pipe(
    new TextEncoder().encode(search),
    new CompressionStream('deflate-raw'),
  );
  return bytesToBase64Url(compressed);
}

/**
 * Decode a share token back into the original query string. Returns `null` if
 * the token is empty or cannot be decompressed (never throws, so a malformed
 * link can't crash the page).
 */
export async function decodeShareToken(token: string): Promise<string | null> {
  if (!token) {
    return null;
  }
  try {
    const bytes = await pipe(
      base64UrlToBytes(token),
      new DecompressionStream('deflate-raw'),
    );
    const decoded = new TextDecoder().decode(bytes);
    return decoded || null;
  } catch {
    return null;
  }
}

/**
 * Drop noise that only inflates a shared link, without touching the encoding of
 * any surviving pair (byte-safe round-trip):
 *   - a leading '?' (so callers can pass `window.location.search` directly),
 *   - the `share` param itself,
 *   - empty values (`where=`, `select=`, empty `filters=[]`) — these equal the
 *     page defaults, so their absence restores the same state,
 *   - duplicate keys (keep the first, matching nuqs' `.get()` semantics).
 */
function cleanSearch(search: string): string {
  const raw = search.replace(/^\?+/, '');
  if (!raw) {
    return '';
  }
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    if (key === SHARE_PARAM || seen.has(key)) continue;
    if (isEmptyValue(value)) continue;
    seen.add(key);
    kept.push(pair); // keep the original pair verbatim
  }
  return kept.join('&');
}

/** True for '', '[]' or '{}' at either encoding depth (single or double). */
function isEmptyValue(value: string): boolean {
  let decoded = value;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded === '' || decoded === '[]' || decoded === '{}';
}

/**
 * Build an absolute, shareable URL for the current page, returning the SHORTER
 * of the plain URL (`origin/path?<search>`) or the compressed URL
 * (`origin/path?share=<token>`).
 *
 * Compression only helps when the query state is large. For pages whose
 * identity lives in the path (e.g. `/dashboards/<id>`) the transient state is
 * tiny, so the plain URL wins. `useExpandShareLink` is a no-op on plain URLs,
 * so either form is safe to open. Falls back to the plain URL if the browser
 * lacks `CompressionStream` or compression fails.
 *
 * @param search The (already URL-encoded) query string to share; a leading '?'
 *   is tolerated.
 */
export async function buildShareUrl(search: string): Promise<string> {
  const query = cleanSearch(search);
  const { origin, pathname } = window.location;
  const base = `${origin}${pathname}`;
  const plain = query ? `${base}?${query}` : base;
  if (!query || typeof CompressionStream === 'undefined') {
    return plain;
  }
  try {
    const compressed = `${base}?${SHARE_PARAM}=${await encodeShareToken(query)}`;
    return compressed.length < plain.length ? compressed : plain;
  } catch {
    return plain;
  }
}

/**
 * Freeze a query string's time range to absolute from/to values so a shared
 * link shows recipients the same window rather than re-evaluating a relative
 * range (e.g. "Past 1h") against their own clock. Also disables live tailing.
 * Mirrors the intent of DBSearchPage's `generateSearchUrl`.
 *
 * @param search The query string to normalize, without a leading '?'.
 * @param timeRange The resolved [from, to] range from `useNewTimeQuery`.
 */
export function freezeTimeRange(
  search: string,
  timeRange: [Date, Date],
): string {
  const params = new URLSearchParams(search);
  params.delete(SHARE_PARAM);
  params.delete('tq');
  params.set('from', String(timeRange[0].getTime()));
  params.set('to', String(timeRange[1].getTime()));
  params.set('isLive', 'false');
  return params.toString();
}
