import { createHash, createHmac, timingSafeEqual } from 'crypto';

import { EXPRESS_SESSION_SECRET } from '@/config';

const CURSOR_VERSION = 1;
const FINGERPRINT_LENGTH = 16;
// Also the `offset` request field's cap.
export const MAX_SINGLE_WINDOW_OFFSET = 10_000;
const SIGNATURE_CONTEXT = 'hdx-search-cursor:';
/** Hidden column carrying each row's second; reserved in `select`. */
export const CURSOR_TS_COLUMN = '__hdx_cursor_ts';

/** Literal `cursor` value that starts a windowed cursor walk. */
export const CURSOR_START = 'start';

export type CursorWindow = {
  ordinal: number;
  startTime: string;
  endTime: string;
};

export type SearchCursorState = {
  window: CursorWindow;
  offset: number;
  /** Time range pinned by the walk, so a defaulted endTime stays stable. */
  startTime: string;
  endTime: string;
};

/** A walk in progress; `window` is null on its first page. */
export type SearchWalk = Omit<SearchCursorState, 'window'> & {
  window: CursorWindow | null;
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

// Signed with the session secret, so a cursor can only come from this server
// and is valid wherever its sessions are.
function sign(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret)
    .update(SIGNATURE_CONTEXT + payload)
    .digest();
}

export function encodeSearchCursor(
  state: SearchCursorState,
  fingerprint: string,
  secret: string = EXPRESS_SESSION_SECRET,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: CURSOR_VERSION,
      k: state.window.ordinal,
      ws: state.window.startTime,
      we: state.window.endTime,
      o: state.offset,
      f: fingerprint,
      s: state.startTime,
      e: state.endTime,
    }),
  ).toString('base64url');
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

export function decodeSearchCursor(
  cursor: string,
  fingerprint: string,
  secret: string = EXPRESS_SESSION_SECRET,
): SearchCursorState | CursorDecodeError {
  const [payload, signature, ...rest] = cursor.split('.');
  if (!payload || !signature || rest.length > 0) {
    return { error: 'INVALID_CURSOR' };
  }
  const expected = sign(payload, secret);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { error: 'INVALID_CURSOR' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { error: 'INVALID_CURSOR' };
  }

  if (parsed == null || typeof parsed !== 'object') {
    return { error: 'INVALID_CURSOR' };
  }
  const fields: Record<string, unknown> = { ...parsed };
  const { v, k, ws, we, o, f, s: start, e: end } = fields;
  if (
    v !== CURSOR_VERSION ||
    typeof k !== 'number' ||
    typeof o !== 'number' ||
    !Number.isInteger(k) ||
    !Number.isInteger(o) ||
    k < 0 ||
    o < 0 ||
    typeof f !== 'string' ||
    typeof ws !== 'string' ||
    typeof we !== 'string' ||
    typeof start !== 'string' ||
    typeof end !== 'string'
  ) {
    return { error: 'INVALID_CURSOR' };
  }
  const [wsMs, weMs, startMs, endMs] = [ws, we, start, end].map(Date.parse);
  if (
    [wsMs, weMs, startMs, endMs].some(Number.isNaN) ||
    wsMs < startMs ||
    weMs > endMs ||
    wsMs > weMs
  ) {
    return { error: 'INVALID_CURSOR' };
  }
  if (f !== fingerprint) {
    return { error: 'CURSOR_QUERY_MISMATCH' };
  }
  return {
    window: { ordinal: k, startTime: ws, endTime: we },
    offset: o,
    startTime: start,
    endTime: end,
  };
}
