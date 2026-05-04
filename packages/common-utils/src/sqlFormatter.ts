import { clickhouse, formatDialect } from 'sql-formatter';

export function format(query) {
  return formatDialect(query, { dialect: clickhouse });
}
