import { createHash } from 'crypto';

const CURSOR_VERSION = 1;
const FINGERPRINT_LENGTH = 16;
// Must match the `offset` field's cap in the request schema. The fingerprint is
// an unkeyed hash of request fields, so a caller can mint a cursor carrying any
// offset; without this bound that would skip more rows than the endpoint allows.
const MAX_CURSOR_OFFSET = 10_000;

/** Literal `cursor` value that starts a windowed cursor walk. */
export const CURSOR_START = 'start';

export type SearchCursorState = {
  windowIndex: number;
  offset: number;
  /** Time range pinned by the walk, so a defaulted endTime stays stable. */
  startTime: string;
  endTime: string;
};

export type CursorFingerprintInput = {
  sourceId: string;
  where: string;
  whereLanguage: string;
  select: string;
  orderBy: string;
};

export type CursorDecodeError = {
  error: 'INVALID_CURSOR' | 'CURSOR_QUERY_MISMATCH';
};

/**
 * Binds a cursor to the query that produced it. Window indices resolve against
 * any range, so without this a cursor replayed after the caller edits `where`
 * returns pages from a different result set. The time range is carried in the
 * cursor rather than fingerprinted, so a defaulted `endTime` resolving to a
 * fresh `now` on each request does not invalidate the walk.
 */
export function fingerprintQuery(input: CursorFingerprintInput): string {
  // JSON.stringify of a fixed-order array is unambiguous: a value containing
  // the delimiter cannot forge another field's boundary, because quotes inside
  // values are escaped.
  const canonical = JSON.stringify([
    input.sourceId,
    input.where,
    input.whereLanguage,
    input.select,
    input.orderBy,
  ]);
  return createHash('sha256')
    .update(canonical)
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
}

export function encodeSearchCursor(
  state: SearchCursorState,
  fingerprint: string,
): string {
  return Buffer.from(
    JSON.stringify({
      v: CURSOR_VERSION,
      w: state.windowIndex,
      o: state.offset,
      f: fingerprint,
      s: state.startTime,
      e: state.endTime,
    }),
  ).toString('base64url');
}

export function decodeSearchCursor(
  cursor: string,
  fingerprint: string,
): SearchCursorState | CursorDecodeError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return { error: 'INVALID_CURSOR' };
  }

  if (parsed == null || typeof parsed !== 'object') {
    return { error: 'INVALID_CURSOR' };
  }
  const { v, w, o, f, s: start, e: end } = parsed as Record<string, unknown>;
  if (
    v !== CURSOR_VERSION ||
    typeof w !== 'number' ||
    typeof o !== 'number' ||
    !Number.isInteger(w) ||
    !Number.isInteger(o) ||
    w < 0 ||
    o < 0 ||
    o > MAX_CURSOR_OFFSET ||
    typeof f !== 'string' ||
    typeof start !== 'string' ||
    typeof end !== 'string' ||
    Number.isNaN(Date.parse(start)) ||
    Number.isNaN(Date.parse(end))
  ) {
    return { error: 'INVALID_CURSOR' };
  }
  if (f !== fingerprint) {
    return { error: 'CURSOR_QUERY_MISMATCH' };
  }
  return { windowIndex: w, offset: o, startTime: start, endTime: end };
}
