import type { ClickHouseClient } from '@clickhouse/client';

export const EVAL_DATABASE = 'default';
export const SOURCE_TRACES_TABLE = 'otel_traces';
export const SOURCE_LOGS_TABLE = 'otel_logs';

export type ScenarioTables = {
  traces: string;
  logs: string;
};

function scenarioSlug(scenario: string): string {
  return scenario.replace(/-/g, '_');
}

export function scenarioTables(scenario: string): ScenarioTables {
  const slug = scenarioSlug(scenario);
  return {
    traces: `eval_${slug}_otel_traces`,
    logs: `eval_${slug}_otel_logs`,
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
  for (const t of [SOURCE_TRACES_TABLE, SOURCE_LOGS_TABLE]) {
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

export async function truncateScenarioTables(
  client: ClickHouseClient,
  scenario: string,
): Promise<void> {
  const tables = scenarioTables(scenario);
  await client.command({
    query: `TRUNCATE TABLE IF EXISTS ${EVAL_DATABASE}.${tables.traces}`,
  });
  await client.command({
    query: `TRUNCATE TABLE IF EXISTS ${EVAL_DATABASE}.${tables.logs}`,
  });
}

export async function dropScenarioTables(
  client: ClickHouseClient,
  scenario: string,
): Promise<void> {
  const tables = scenarioTables(scenario);
  await client.command({
    query: `DROP TABLE IF EXISTS ${EVAL_DATABASE}.${tables.traces}`,
  });
  await client.command({
    query: `DROP TABLE IF EXISTS ${EVAL_DATABASE}.${tables.logs}`,
  });
}
