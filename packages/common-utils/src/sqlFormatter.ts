import { clickhouse, formatDialect } from 'sql-formatter';

export function format(query) {
  return formatDialect(query, { dialect: clickhouse });
}

/** Trino-flavored helpers for time bucketing / arithmetic. */
export type TrinoTimeUnit =
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year';

/**
 * Trino time-bucket via `date_trunc(unit, expr)`.
 * Replaces ClickHouse's `toStartOfInterval(expr, INTERVAL n UNIT)`.
 */
export function trinoTimeBucket(column: string, unit: TrinoTimeUnit): string {
  return `date_trunc('${unit}', ${column})`;
}

/** Trino `now()` literal. */
export function trinoNow(): string {
  return 'now()';
}

/**
 * Build a Trino-style interval literal. e.g. `trinoInterval(5, 'minute')` →
 * `INTERVAL '5' MINUTE`.
 */
export function trinoInterval(amount: number, unit: TrinoTimeUnit): string {
  return `INTERVAL '${amount}' ${unit.toUpperCase()}`;
}
