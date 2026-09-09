import {
  ClickHouseProgress,
  ClickHouseQueryError,
  ColumnMetaType,
  isException,
  isProgressRow,
  isRow,
} from '@hyperdx/common-utils/dist/clickhouse';

/**
 * Callbacks invoked as a ClickHouse response stream is decoded.
 *
 * `onMeta` fires once, before any `onRows`. `onProgress` may fire at any point,
 * including before `onMeta`: ClickHouse writes a progress line straight from
 * its progress callback without first emitting the format prefix.
 */
export type StreamHandlers = {
  onMeta: (meta: ColumnMetaType[]) => void;
  onRows: (rows: Record<string, unknown>[]) => void;
  onProgress?: (progress: ClickHouseProgress) => void;
};

/**
 * Consumes one batch of decoded NDJSON lines from a ClickHouse result stream.
 * Each element is the parsed JSON of a single line, in stream order.
 */
export type StreamParser = (events: unknown[]) => void;

/**
 * Parser for `JSONCompactEachRowWithNamesAndTypes`: a line of column names,
 * then a line of column types, then positional value arrays. Emits no progress.
 */
export function createCompactWithNamesAndTypesParser({
  onMeta,
  onRows,
}: StreamHandlers): StreamParser {
  // Header lines can be split across batches, so buffer until both arrive.
  const headerEvents: unknown[] = [];
  const meta: ColumnMetaType[] = [];

  return events => {
    let dataEvents = events;

    if (meta.length === 0) {
      headerEvents.push(...events);
      if (headerEvents.length < 2) {
        return;
      }

      const names = headerEvents[0] as string[];
      const types = headerEvents[1] as string[];
      if (names.length !== types.length) {
        throw new Error(
          'Invalid JSONCompactEachRowWithNamesAndTypes header rows',
        );
      }
      for (let i = 0; i < names.length; i++) {
        meta.push({ name: names[i], type: types[i] });
      }
      onMeta(meta);

      dataEvents = headerEvents.slice(2);
      headerEvents.length = 0;
    }

    const rows: Record<string, unknown>[] = [];
    for (const event of dataEvents) {
      const values = event as unknown[];
      const row: Record<string, unknown> = {};
      for (let i = 0; i < values.length; i++) {
        row[meta[i].name] = values[i];
      }
      rows.push(row);
    }

    if (rows.length > 0) {
      onRows(rows);
    }
  };
}

function isMetaEvent(event: unknown): event is { meta: ColumnMetaType[] } {
  return (
    event !== null &&
    typeof event === 'object' &&
    'meta' in event &&
    Array.isArray((event as { meta: unknown }).meta)
  );
}

/**
 * Parser for `JSONEachRowWithProgress`: a stream of single-key JSON objects —
 * `{"meta":[...]}`, `{"row":{...}}`, `{"progress":{...}}`, plus
 * `rows_before_limit_at_least` / `totals` / `extremes` events which are ignored
 * here.
 *
 * Rows already arrive keyed by column name, so `meta` only carries the column
 * types upward.
 *
 * A mid-stream `{"exception":...}` arrives under HTTP 200 (the status line went
 * out before the query failed), so it is surfaced as a `ClickHouseQueryError`.
 */
export function createEachRowWithProgressParser(
  { onMeta, onRows, onProgress }: StreamHandlers,
  query: string,
): StreamParser {
  return events => {
    const rows: Record<string, unknown>[] = [];

    for (const event of events) {
      if (isRow<Record<string, unknown>>(event)) {
        rows.push(event.row);
      } else if (isProgressRow(event)) {
        onProgress?.(event.progress);
      } else if (isMetaEvent(event)) {
        onMeta(event.meta);
      } else if (isException(event)) {
        // Emit what was decoded before the failure so partial results are not
        // dropped on the way to the error handler.
        if (rows.length > 0) {
          onRows(rows);
        }
        throw new ClickHouseQueryError(event.exception, query);
      }
    }

    if (rows.length > 0) {
      onRows(rows);
    }
  };
}
