import { createHash } from 'crypto';

const CURSOR_VERSION = 1;
const FINGERPRINT_LENGTH = 16;
// Above the `offset` field's 10,000 cap so a walk can page through a dense
// window; still bounded because cursors are unsigned.
export const MAX_CURSOR_OFFSET = 1_000_000;
// Also the `offset` request field's cap.
export const MAX_SINGLE_WINDOW_OFFSET = 10_000;

// Windows are built up front, so the range is capped. Also checked on decoded
// cursors, which are unsigned.
export const MAX_CURSOR_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

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
 * Ties a cursor to the query that produced it, so it can't be reused after
 * `where`, `select`, or `orderBy` change. The time range travels in the cursor
 * instead, so a defaulted `endTime` doesn't invalidate it.
 */
export function fingerprintQuery(input: CursorFingerprintInput): string {
  // A JSON array keeps field boundaries unambiguous.
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
  const fields: Record<string, unknown> = { ...parsed };
  const { v, w, o, f, s: start, e: end } = fields;
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
