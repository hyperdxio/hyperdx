import { createHash } from 'crypto';

const CURSOR_VERSION = 1;
const FINGERPRINT_LENGTH = 16;

export type SearchCursorState = {
  windowIndex: number;
  offset: number;
};

export type CursorFingerprintInput = {
  sourceId: string;
  where: string;
  whereLanguage: string;
  select: string;
  orderBy: string;
  startTime: string;
  endTime: string;
};

export type CursorDecodeError = {
  error: 'INVALID_CURSOR' | 'CURSOR_QUERY_MISMATCH';
};

/**
 * Binds a cursor to the query that produced it. Window indices resolve against
 * any range, so without this a cursor replayed after the caller edits `where`
 * or the time range returns pages from a different result set.
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
    input.startTime,
    input.endTime,
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
  const { v, w, o, f } = parsed as Record<string, unknown>;
  if (
    v !== CURSOR_VERSION ||
    typeof w !== 'number' ||
    typeof o !== 'number' ||
    !Number.isInteger(w) ||
    !Number.isInteger(o) ||
    w < 0 ||
    o < 0 ||
    typeof f !== 'string'
  ) {
    return { error: 'INVALID_CURSOR' };
  }
  if (f !== fingerprint) {
    return { error: 'CURSOR_QUERY_MISMATCH' };
  }
  return { windowIndex: w, offset: o };
}
