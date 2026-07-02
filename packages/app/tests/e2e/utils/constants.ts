export const DEFAULT_SESSIONS_SOURCE_NAME = 'E2E Sessions';
export const DEFAULT_TRACES_SOURCE_NAME = 'E2E Traces';
export const DEFAULT_METRICS_SOURCE_NAME = 'E2E Metrics';
export const DEFAULT_LOGS_SOURCE_NAME = 'E2E Logs';

// Source backed by `otel_logs_interesting_filter_keys`, used by the filter-key
// edge case tests to exercise identifier escaping (dotted/hyphenated column
// names, Map keys, and JSON paths) in search and dashboard filters.
export const INTERESTING_FILTER_KEYS_SOURCE_NAME =
  'E2E Interesting Filter Keys';

// Log source backed by a plain otel_logs-schema base table whose facet
// keys/values are served from metadata materialized views (key + key/value
// 15-minute rollups) registered on the source definition. Used by the
// filter-key edge case tests to exercise the rollup-backed facet path.
export const METADATA_MV_LOGS_SOURCE_NAME = 'E2E Metadata MV Logs';

// Trace source pre-configured with a materialized view (e2e_otel_traces_1m),
// used by the materialized-view acceleration tests.
export const DEFAULT_TRACES_MV_SOURCE_NAME = 'E2E Traces MV';
// Trace source WITHOUT a materialized view, used to test configuring an MV
// (with auto-population) in the source form without mutating shared sources.
export const DEFAULT_TRACES_MV_AUTOPOPULATE_SOURCE_NAME =
  'E2E Traces MV AutoPopulate';

// ClickHouse database/table names backing the default E2E sources. Must stay
// in sync with `tests/e2e/fixtures/e2e-fixtures.json` and the CREATE TABLE
// statements in `docker/clickhouse/local/init-db-e2e.sh`.
export const E2E_CLICKHOUSE_DATABASE = 'default';
export const E2E_LOGS_TABLE = 'e2e_otel_logs';
export const E2E_TRACES_TABLE = 'e2e_otel_traces';
// AggregatingMergeTree rollup of e2e_otel_traces populated by the
// e2e_otel_traces_1m_mv materialized view.
export const E2E_TRACES_MV_TABLE = 'e2e_otel_traces_1m';
export const E2E_SESSIONS_TABLE = 'e2e_hyperdx_sessions';
export const E2E_METRICS_GAUGE_TABLE = 'e2e_otel_metrics_gauge';
export const E2E_METRICS_SUM_TABLE = 'e2e_otel_metrics_sum';
// Table backing the INTERESTING_FILTER_KEYS_SOURCE_NAME source. Created in
// `docker/clickhouse/local/init-db-e2e.sh` and seeded in `seed-clickhouse.ts`.
export const E2E_INTERESTING_FILTER_KEYS_TABLE =
  'otel_logs_interesting_filter_keys';
// Base table backing METADATA_MV_LOGS_SOURCE_NAME, plus the key/value rollup
// tables auto-populated by materialized views on insert. Created in
// `docker/clickhouse/local/init-db-e2e.sh` and seeded in `seed-clickhouse.ts`.
export const E2E_METADATA_MV_LOGS_TABLE = 'e2e_otel_logs_metadata_mv';
export const E2E_METADATA_MV_KV_ROLLUP_TABLE = 'e2e_otel_logs_kv_rollup_15m';
export const E2E_METADATA_MV_KEY_ROLLUP_TABLE = 'e2e_otel_logs_key_rollup_15m';
