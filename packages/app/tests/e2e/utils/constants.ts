export const DEFAULT_SESSIONS_SOURCE_NAME = 'E2E Sessions';
export const DEFAULT_TRACES_SOURCE_NAME = 'E2E Traces';
export const DEFAULT_METRICS_SOURCE_NAME = 'E2E Metrics';
export const DEFAULT_LOGS_SOURCE_NAME = 'E2E Logs';

// ClickHouse database/table names backing the default E2E sources. Must stay
// in sync with `tests/e2e/fixtures/e2e-fixtures.json` and the CREATE TABLE
// statements in `docker/clickhouse/local/init-db-e2e.sh`.
export const E2E_CLICKHOUSE_DATABASE = 'default';
export const E2E_LOGS_TABLE = 'e2e_otel_logs';
export const E2E_TRACES_TABLE = 'e2e_otel_traces';
export const E2E_SESSIONS_TABLE = 'e2e_hyperdx_sessions';
export const E2E_METRICS_GAUGE_TABLE = 'e2e_otel_metrics_gauge';
export const E2E_METRICS_SUM_TABLE = 'e2e_otel_metrics_sum';
