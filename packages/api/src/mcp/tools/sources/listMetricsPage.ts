import {
  chSql,
  concatChSql,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import SqlString from 'sqlstring';

import type { ClickhouseClient } from '@/clickhouse';

import type { DiscoverableMetricKind } from './metricKinds';

export type MetricEntry = {
  name: string;
  kind: DiscoverableMetricKind;
  unit?: string;
  description?: string;
};

export type KindScan =
  | { status: 'pending' }
  | { status: 'ok'; names: string[] }
  | { status: 'error'; error: string };

export type KindToScan = {
  kind: DiscoverableMetricKind;
  /** Exclusive start within this kind; set only for the cursor's kind. */
  afterName?: string;
};

export type KindSlot = KindToScan & { scan: KindScan };

export type MetricsPage = {
  entries: MetricEntry[];
  /**
   * Where the next page starts. `lastName` is absent when the next page
   * starts at the beginning of `kind`. Absent when the scan is exhausted.
   */
  next?: { kind: DiscoverableMetricKind; lastName?: string };
  partialFailure: { kind: DiscoverableMetricKind; error: string }[];
};

export const KIND_TIMED_OUT_ERROR =
  'Timed out before this kind finished listing.';

/**
 * Build a page from per-kind scan results, filling `limit` entries in kind
 * order. Each scan holds up to `limit + 1` names so an overflow can be
 * detected. Returns null when a pending kind still decides the page's
 * contents, unless `finalize` is set, in which case the first pending kind
 * is reported as timed out and the page ends there.
 *
 * @internal Exported for testing.
 */
export function assembleMetricsPage(
  slots: KindSlot[],
  limit: number,
  finalize: boolean,
): MetricsPage | null {
  const entries: MetricEntry[] = [];
  const partialFailure: MetricsPage['partialFailure'] = [];
  const resumeAt = (slot: KindToScan): MetricsPage => ({
    entries,
    next: { kind: slot.kind, lastName: slot.afterName },
    partialFailure,
  });
  for (const [i, slot] of slots.entries()) {
    const { kind, scan } = slot;
    if (scan.status === 'pending') {
      if (!finalize) return null;
      // End the page at the timed-out kind so the cursor resumes there.
      // Moving on to later kinds would leave its names unreachable.
      partialFailure.push({ kind, error: KIND_TIMED_OUT_ERROR });
      return resumeAt(slot);
    }
    if (scan.status === 'error') {
      partialFailure.push({ kind, error: scan.error });
      continue;
    }
    const remaining = limit - entries.length;
    const kept = scan.names.slice(0, remaining);
    entries.push(...kept.map(name => ({ name, kind })));
    if (scan.names.length > remaining) {
      return { entries, next: { kind, lastName: kept.at(-1) }, partialFailure };
    }
    if (entries.length === limit) {
      // The page is full. Point the cursor at the next kind that may still
      // have names instead of waiting for it to finish.
      const nextSlot = slots
        .slice(i + 1)
        .find(s => s.scan.status !== 'ok' || s.scan.names.length > 0);
      return nextSlot ? resumeAt(nextSlot) : { entries, partialFailure };
    }
  }
  return { entries, partialFailure };
}

/**
 * Scan every kind in parallel and resolve as soon as the page is decided.
 * Queries for kinds that can no longer contribute are aborted. Kinds still
 * running at `deadlineAt` are reported as timed out so the kinds that
 * finished are returned instead of failing the whole call.
 */
export function scanKindsForPage({
  kinds,
  limit,
  deadlineAt,
  signal,
  fetchNames,
}: {
  kinds: KindToScan[];
  limit: number;
  deadlineAt: number;
  signal: AbortSignal;
  fetchNames: (kind: KindToScan, signal: AbortSignal) => Promise<string[]>;
}): Promise<MetricsPage> {
  const slots: KindSlot[] = kinds.map(k => ({
    ...k,
    scan: { status: 'pending' },
  }));
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });

  return new Promise(resolve => {
    let done = false;
    const tryFinish = (finalize: boolean) => {
      if (done) return;
      const page = assembleMetricsPage(slots, limit, finalize);
      if (!page) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      controller.abort();
      resolve(page);
    };
    const timer = setTimeout(
      () => tryFinish(true),
      Math.max(0, deadlineAt - Date.now()),
    );
    for (const slot of slots) {
      fetchNames(slot, controller.signal)
        .then(
          names => {
            slot.scan = { status: 'ok', names };
          },
          (e: unknown) => {
            if (done) return;
            const message = e instanceof Error ? e.message : String(e);
            slot.scan = {
              status: 'error',
              error: message.replace(/\s+/g, ' ').trim().slice(0, 200),
            };
          },
        )
        .finally(() => tryFinish(false));
    }
    // Resolves right away when there are no kinds to scan.
    tryFinish(false);
  });
}

/**
 * Distinct metric names for one kind. Reads only MetricName and TimeUnix;
 * unit and description are fetched separately for the returned page, since
 * aggregating those String columns across the whole window was the bulk of
 * the bytes read.
 */
export async function fetchMetricNames({
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  startDate,
  endDate,
  namePattern,
  afterName,
  limit,
  maxExecutionSeconds,
  signal,
}: {
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  startDate: Date;
  endDate: Date;
  namePattern: string | undefined;
  afterName: string | undefined;
  limit: number;
  maxExecutionSeconds: number;
  signal: AbortSignal;
}): Promise<string[]> {
  const whereParts = [
    chSql`TimeUnix >= fromUnixTimestamp64Milli(${{ Int64: startDate.getTime() }})`,
    chSql`TimeUnix <= fromUnixTimestamp64Milli(${{ Int64: endDate.getTime() }})`,
    ...(afterName !== undefined
      ? [chSql`MetricName > ${{ String: afterName }}`]
      : []),
    ...(namePattern
      ? [chSql`MetricName ILIKE ${{ String: namePattern }}`]
      : []),
  ];

  const sql = chSql`
    SELECT MetricName
    FROM ${tableExpr({ database: databaseName, table: tableName })}
    WHERE ${concatChSql(' AND ', whereParts)}
    GROUP BY MetricName
    ORDER BY MetricName ASC
    LIMIT ${{ Int32: limit }}
  `;

  const response = await clickhouseClient.query<'JSON'>({
    query: sql.sql,
    query_params: sql.params,
    format: 'JSON',
    connectionId,
    clickhouse_settings: {
      max_execution_time: maxExecutionSeconds,
      timeout_overflow_mode: 'break',
    },
    abort_signal: signal,
  });
  const result = (await response.json()) as { data: { MetricName: string }[] };
  return result.data.map(row => row.MetricName);
}

/**
 * Unit and description for a page of metric names. `LIMIT 1 BY` plus the
 * outer LIMIT lets ClickHouse stop reading once every name has a row, instead
 * of aggregating every point in the window. The row picked is arbitrary, which
 * matches the `anyLast` this replaced; unit and description are effectively
 * constant per metric.
 */
export async function fetchMetricUnitsAndDescriptions({
  clickhouseClient,
  databaseName,
  tableName,
  connectionId,
  names,
  startDate,
  endDate,
  hasUnit,
  hasDescription,
  maxExecutionSeconds,
  signal,
}: {
  clickhouseClient: ClickhouseClient;
  databaseName: string;
  tableName: string;
  connectionId: string;
  names: string[];
  startDate: Date;
  endDate: Date;
  hasUnit: boolean;
  hasDescription: boolean;
  maxExecutionSeconds: number;
  signal: AbortSignal;
}): Promise<Map<string, { unit?: string; description?: string }>> {
  const enrichments = new Map<
    string,
    { unit?: string; description?: string }
  >();
  if (names.length === 0 || (!hasUnit && !hasDescription)) return enrichments;

  const projections = [
    chSql`MetricName`,
    ...(hasUnit ? [chSql`${{ Identifier: 'MetricUnit' }}`] : []),
    ...(hasDescription ? [chSql`${{ Identifier: 'MetricDescription' }}`] : []),
  ];
  const sql = chSql`
    SELECT ${concatChSql(', ', projections)}
    FROM ${tableExpr({ database: databaseName, table: tableName })}
    WHERE MetricName IN (${{
      // Inline names as escaped literals: one bind param per name (up to
      // 500) pushes the client into a multipart request that query proxies
      // can reject.
      UNSAFE_RAW_SQL: names.map(name => SqlString.escape(name)).join(','),
    }})
      AND TimeUnix >= fromUnixTimestamp64Milli(${{ Int64: startDate.getTime() }})
      AND TimeUnix <= fromUnixTimestamp64Milli(${{ Int64: endDate.getTime() }})
    LIMIT 1 BY MetricName
    LIMIT ${{ Int32: names.length }}
  `;

  const response = await clickhouseClient.query<'JSON'>({
    query: sql.sql,
    query_params: sql.params,
    format: 'JSON',
    connectionId,
    clickhouse_settings: {
      max_execution_time: maxExecutionSeconds,
      timeout_overflow_mode: 'break',
    },
    abort_signal: signal,
  });
  const result = (await response.json()) as {
    data: {
      MetricName: string;
      MetricUnit?: string;
      MetricDescription?: string;
    }[];
  };
  for (const row of result.data) {
    enrichments.set(row.MetricName, {
      ...(row.MetricUnit ? { unit: row.MetricUnit } : {}),
      ...(row.MetricDescription ? { description: row.MetricDescription } : {}),
    });
  }
  return enrichments;
}
