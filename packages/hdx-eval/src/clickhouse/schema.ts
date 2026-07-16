import type { ClickHouseClient } from '@clickhouse/client';

export const EVAL_DATABASE = 'default';
const SOURCE_TRACES_TABLE = 'otel_traces';
const SOURCE_LOGS_TABLE = 'otel_logs';

const METRIC_TABLES = [
  {
    field: 'metricsGauge',
    source: 'otel_metrics_gauge',
  },
  {
    field: 'metricsSum',
    source: 'otel_metrics_sum',
  },
  {
    field: 'metricsHistogram',
    source: 'otel_metrics_histogram',
  },
  {
    field: 'metricsExponentialHistogram',
    source: 'otel_metrics_exponential_histogram',
  },
  {
    field: 'metricsSummary',
    source: 'otel_metrics_summary',
  },
] as const;

type MetricTableField = (typeof METRIC_TABLES)[number]['field'];

export type ScenarioTables = {
  traces: string;
  logs: string;
  tracesKvRollup: string;
  tracesKeyRollup: string;
  logsKvRollup: string;
  logsKeyRollup: string;
} & Record<MetricTableField, string>;

export function scenarioSlug(scenario: string): string {
  if (!/^[a-z0-9_-]+$/.test(scenario)) {
    throw new Error(
      `Invalid scenario name "${scenario}": must match /^[a-z0-9_-]+$/`,
    );
  }
  return scenario.replace(/-/g, '_');
}

export function scenarioTables(scenario: string): ScenarioTables {
  const slug = scenarioSlug(scenario);
  const metricTables = Object.fromEntries(
    METRIC_TABLES.map(({ field, source }) => [field, `eval_${slug}_${source}`]),
  ) as Record<MetricTableField, string>;
  return {
    traces: `eval_${slug}_otel_traces`,
    logs: `eval_${slug}_otel_logs`,
    tracesKvRollup: `eval_${slug}_otel_traces_kv_rollup_15m`,
    tracesKeyRollup: `eval_${slug}_otel_traces_key_rollup_15m`,
    logsKvRollup: `eval_${slug}_otel_logs_kv_rollup_15m`,
    logsKeyRollup: `eval_${slug}_otel_logs_key_rollup_15m`,
    ...metricTables,
  };
}

async function tableExists(
  client: ClickHouseClient,
  database: string,
  table: string,
): Promise<boolean> {
  const rs = await client.query({
    query: `SELECT 1 FROM system.tables WHERE database = {db:String} AND name = {tbl:String}`,
    query_params: { db: database, tbl: table },
    format: 'JSONEachRow',
  });
  const rows = await rs.json<unknown>();
  return rows.length > 0;
}

async function assertSourceTablesExist(
  client: ClickHouseClient,
): Promise<void> {
  const required = [
    SOURCE_TRACES_TABLE,
    SOURCE_LOGS_TABLE,
    ...METRIC_TABLES.map(({ source }) => source),
  ];
  for (const t of required) {
    if (!(await tableExists(client, EVAL_DATABASE, t))) {
      throw new Error(
        `Required source table ${EVAL_DATABASE}.${t} does not exist. ` +
          `Start the dev stack (\`yarn dev\`) so the OTel collector can ` +
          `create the standard otel_* tables before seeding eval data.`,
      );
    }
  }
}

export async function ensureScenarioTables(
  client: ClickHouseClient,
  scenario: string,
): Promise<ScenarioTables> {
  await assertSourceTablesExist(client);
  const tables = scenarioTables(scenario);

  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${EVAL_DATABASE}.${tables.traces} AS ${EVAL_DATABASE}.${SOURCE_TRACES_TABLE}`,
  });
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${EVAL_DATABASE}.${tables.logs} AS ${EVAL_DATABASE}.${SOURCE_LOGS_TABLE}`,
  });

  // The source tables inherit a 1-day TTL from HyperDX migrations. Eval data
  // is anchored to a chosen `now` (often historical) and we control its
  // lifecycle via the seed/drop CLI, so strip TTL on the eval copies. Without
  // this, seeding with `--now` >1 day in the past silently drops the part.
  // Idempotent: subsequent runs error with "no TTL to remove" — ignore.
  await removeTtlIfPresent(client, tables.traces);
  await removeTtlIfPresent(client, tables.logs);

  for (const { field, source } of METRIC_TABLES) {
    const metricTable = tables[field];
    await client.command({
      query: `CREATE TABLE IF NOT EXISTS ${EVAL_DATABASE}.${metricTable} AS ${EVAL_DATABASE}.${source}`,
    });
    await removeTtlIfPresent(client, metricTable);
  }

  // Create KV/Key rollup tables and materialized views so the HyperDX MCP
  // can use fast metadata discovery instead of scanning the full raw tables.
  // MVs are created *before* seeding so they capture inserts as they happen.
  await ensureRollupTables(client, tables);

  return tables;
}

async function removeTtlIfPresent(
  client: ClickHouseClient,
  table: string,
): Promise<void> {
  try {
    await client.command({
      query: `ALTER TABLE ${EVAL_DATABASE}.${table} REMOVE TTL`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cannot remove|doesn't have any table TTL/i.test(msg)) return;
    throw err;
  }
}

/**
 * Return `true` when the scenario's traces table exists and has at least one
 * row. A quick, cheap check to decide whether an auto-seed is needed before
 * a `run`.
 */
export async function scenarioIsSeeded(
  client: ClickHouseClient,
  scenario: string,
): Promise<boolean> {
  const tables = scenarioTables(scenario);
  if (!(await tableExists(client, EVAL_DATABASE, tables.traces))) {
    return false;
  }
  const rs = await client.query({
    query: `SELECT 1 FROM ${EVAL_DATABASE}.${tables.traces} LIMIT 1`,
    format: 'JSONEachRow',
  });
  const rows = await rs.json<unknown>();
  return rows.length > 0;
}

export async function truncateScenarioTables(
  client: ClickHouseClient,
  scenario: string,
): Promise<void> {
  const tables = scenarioTables(scenario);
  // Truncate rollup tables alongside raw tables.
  await client.command({
    query: `TRUNCATE TABLE IF EXISTS ${EVAL_DATABASE}.${tables.tracesKvRollup}`,
  });
  await client.command({
    query: `TRUNCATE TABLE IF EXISTS ${EVAL_DATABASE}.${tables.tracesKeyRollup}`,
  });
  await client.command({
    query: `TRUNCATE TABLE IF EXISTS ${EVAL_DATABASE}.${tables.logsKvRollup}`,
  });
  await client.command({
    query: `TRUNCATE TABLE IF EXISTS ${EVAL_DATABASE}.${tables.logsKeyRollup}`,
  });
  await client.command({
    query: `TRUNCATE TABLE IF EXISTS ${EVAL_DATABASE}.${tables.traces}`,
  });
  await client.command({
    query: `TRUNCATE TABLE IF EXISTS ${EVAL_DATABASE}.${tables.logs}`,
  });
  for (const { field } of METRIC_TABLES) {
    await client.command({
      query: `TRUNCATE TABLE IF EXISTS ${EVAL_DATABASE}.${tables[field]}`,
    });
  }
}

export async function dropScenarioTables(
  client: ClickHouseClient,
  scenario: string,
): Promise<void> {
  const tables = scenarioTables(scenario);
  // Drop MVs first (they depend on the tables), then rollup tables, then raw.
  await dropRollupTables(client, tables);
  await client.command({
    query: `DROP TABLE IF EXISTS ${EVAL_DATABASE}.${tables.traces}`,
  });
  await client.command({
    query: `DROP TABLE IF EXISTS ${EVAL_DATABASE}.${tables.logs}`,
  });
  for (const { field } of METRIC_TABLES) {
    await client.command({
      query: `DROP TABLE IF EXISTS ${EVAL_DATABASE}.${tables[field]}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Rollup tables & materialized views
// ---------------------------------------------------------------------------

const ROLLUP_TABLE_DDL = `(
    \`Timestamp\` DateTime,
    \`ColumnIdentifier\` LowCardinality(String),
    \`Key\` LowCardinality(String),
    \`Value\` String,
    \`count\` UInt64,
    INDEX idx_count_minmax count TYPE minmax GRANULARITY 1,
    INDEX idx_timestamp_minmax Timestamp TYPE minmax GRANULARITY 1
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ColumnIdentifier, Key, Timestamp, Value)
SETTINGS index_granularity = 8192`;

const KEY_ROLLUP_TABLE_DDL = `(
    \`Timestamp\` DateTime,
    \`ColumnIdentifier\` LowCardinality(String),
    \`Key\` LowCardinality(String),
    \`count\` UInt64,
    INDEX idx_count_minmax count TYPE minmax GRANULARITY 1,
    INDEX idx_timestamp_minmax Timestamp TYPE minmax GRANULARITY 1
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ColumnIdentifier, Key, Timestamp)
SETTINGS index_granularity = 8192`;

function mvName(rollupTable: string): string {
  return `${rollupTable}_mv`;
}

function keyMvName(keyRollupTable: string): string {
  return `${keyRollupTable}_mv`;
}

/** Build the KV rollup MV SELECT for a traces table. */
function tracesKvMvSelect(db: string, rawTable: string): string {
  return `
WITH elements AS (
    SELECT
        'ResourceAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM ${db}.${rawTable}
    ARRAY JOIN ResourceAttributes AS entry
    UNION ALL
    SELECT
        'SpanAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM ${db}.${rawTable}
    ARRAY JOIN SpanAttributes AS entry
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'ServiceName', CAST(ServiceName AS String) FROM ${db}.${rawTable}
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'SpanName', CAST(SpanName AS String) FROM ${db}.${rawTable}
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'SpanKind', CAST(SpanKind AS String) FROM ${db}.${rawTable}
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'StatusCode', CAST(StatusCode AS String) FROM ${db}.${rawTable}
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'ScopeName', CAST(ScopeName AS String) FROM ${db}.${rawTable}
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'ScopeVersion', CAST(ScopeVersion AS String) FROM ${db}.${rawTable}
)
SELECT Timestamp, ColumnIdentifier, Key, Value, count() AS count FROM elements
GROUP BY Timestamp, ColumnIdentifier, Key, Value`;
}

/** Build the KV rollup MV SELECT for a logs table. */
function logsKvMvSelect(db: string, rawTable: string): string {
  return `
WITH elements AS (
    SELECT
        'ResourceAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM ${db}.${rawTable}
    ARRAY JOIN ResourceAttributes AS entry
    UNION ALL
    SELECT
        'LogAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM ${db}.${rawTable}
    ARRAY JOIN LogAttributes AS entry
    UNION ALL
    SELECT
        'ScopeAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM ${db}.${rawTable}
    ARRAY JOIN ScopeAttributes AS entry
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'SeverityText', CAST(SeverityText AS String) FROM ${db}.${rawTable}
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'ServiceName', CAST(ServiceName AS String) FROM ${db}.${rawTable}
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'ScopeName', CAST(ScopeName AS String) FROM ${db}.${rawTable}
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'ScopeVersion', CAST(ScopeVersion AS String) FROM ${db}.${rawTable}
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'ResourceSchemaUrl', CAST(ResourceSchemaUrl AS String) FROM ${db}.${rawTable}
    UNION ALL
    SELECT 'NativeColumn', toStartOfFifteenMinutes(Timestamp), 'ScopeSchemaUrl', CAST(ScopeSchemaUrl AS String) FROM ${db}.${rawTable}
)
SELECT Timestamp, ColumnIdentifier, Key, Value, count() AS count FROM elements
GROUP BY Timestamp, ColumnIdentifier, Key, Value`;
}

/** Key rollup MV SELECT (shared for both traces and logs). */
function keyRollupMvSelect(db: string, kvRollupTable: string): string {
  return `
SELECT
    Timestamp,
    ColumnIdentifier,
    Key,
    sum(count) as count
FROM ${db}.${kvRollupTable}
GROUP BY ColumnIdentifier, Key, Timestamp`;
}

async function ensureRollupTables(
  client: ClickHouseClient,
  tables: ScenarioTables,
): Promise<void> {
  const db = EVAL_DATABASE;

  // -- Traces rollups --
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${db}.${tables.tracesKvRollup} ${ROLLUP_TABLE_DDL}`,
  });
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${db}.${tables.tracesKeyRollup} ${KEY_ROLLUP_TABLE_DDL}`,
  });
  // KV rollup MV: raw traces → kv rollup
  await client.command({
    query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.${mvName(tables.tracesKvRollup)} TO ${db}.${tables.tracesKvRollup} AS ${tracesKvMvSelect(db, tables.traces)}`,
  });
  // Key rollup MV: kv rollup → key rollup
  await client.command({
    query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.${keyMvName(tables.tracesKeyRollup)} TO ${db}.${tables.tracesKeyRollup} AS ${keyRollupMvSelect(db, tables.tracesKvRollup)}`,
  });

  // -- Logs rollups --
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${db}.${tables.logsKvRollup} ${ROLLUP_TABLE_DDL}`,
  });
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS ${db}.${tables.logsKeyRollup} ${KEY_ROLLUP_TABLE_DDL}`,
  });
  // KV rollup MV: raw logs → kv rollup
  await client.command({
    query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.${mvName(tables.logsKvRollup)} TO ${db}.${tables.logsKvRollup} AS ${logsKvMvSelect(db, tables.logs)}`,
  });
  // Key rollup MV: kv rollup → key rollup
  await client.command({
    query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.${keyMvName(tables.logsKeyRollup)} TO ${db}.${tables.logsKeyRollup} AS ${keyRollupMvSelect(db, tables.logsKvRollup)}`,
  });
}

async function dropRollupTables(
  client: ClickHouseClient,
  tables: ScenarioTables,
): Promise<void> {
  const db = EVAL_DATABASE;
  // Drop MVs first (they reference the tables).
  for (const mv of [
    mvName(tables.tracesKvRollup),
    keyMvName(tables.tracesKeyRollup),
    mvName(tables.logsKvRollup),
    keyMvName(tables.logsKeyRollup),
  ]) {
    await client.command({
      query: `DROP VIEW IF EXISTS ${db}.${mv}`,
    });
  }
  for (const tbl of [
    tables.tracesKvRollup,
    tables.tracesKeyRollup,
    tables.logsKvRollup,
    tables.logsKeyRollup,
  ]) {
    await client.command({
      query: `DROP TABLE IF EXISTS ${db}.${tbl}`,
    });
  }
}
