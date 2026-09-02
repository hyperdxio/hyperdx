/**
 * Reads the page-context members the browser ClickHouse client puts in W3C
 * baggage (see common-utils `clickhouse/browser`) and maps them to span
 * attributes. A proxied query otherwise records nothing about which screen
 * issued it — browsers send no Referer to the proxy and the route lives in
 * client-side state — so a tab saturating the shared proxy cannot be traced
 * back to the view that opened it.
 *
 * Only known keys are promoted: baggage is client-supplied, so an allowlist
 * keeps a caller from writing arbitrary attributes onto our spans.
 */
const BAGGAGE_SPAN_ATTRIBUTES: Record<string, string> = {
  'hyperdx.source_page': 'hyperdx.query.source_page',
  'hyperdx.source_mode': 'hyperdx.query.source_mode',
};

// Bounds the work done on an untrusted header.
const MAX_BAGGAGE_MEMBERS = 64;

export function parseSourcePageBaggage(
  header: string | string[] | undefined,
): Record<string, string> {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) {
    return {};
  }

  const attributes: Record<string, string> = {};
  for (const entry of raw.split(',', MAX_BAGGAGE_MEMBERS)) {
    // Baggage members may carry `;`-delimited properties after the value.
    const [pair] = entry.split(';');
    const separator = pair.indexOf('=');
    if (separator < 1) {
      continue;
    }

    const attribute = BAGGAGE_SPAN_ATTRIBUTES[pair.slice(0, separator).trim()];
    if (!attribute) {
      continue;
    }

    try {
      attributes[attribute] = decodeURIComponent(
        pair.slice(separator + 1).trim(),
      );
    } catch {
      // A malformed member must not discard the rest of the baggage.
    }
  }

  return attributes;
}
