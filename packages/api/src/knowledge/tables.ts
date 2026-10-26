import type { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import SqlString from 'sqlstring';

import { withWriteGrants } from '@/knowledge/errors';
import type { KnowledgeTarget } from '@/knowledge/target';

export const KG_TABLES = {
  nodes: 'hdx_kg_nodes',
  edges: 'hdx_kg_edges',
  incidents: 'hdx_kg_incidents',
  actions: 'hdx_kg_incident_actions',
} as const;

export const qualifiedTable = (database: string, name: string) =>
  `${SqlString.escapeId(database)}.${SqlString.escapeId(name)}`;

// DateTime64 text in UTC, the format every table column is written in.
export const fmt = (d: Date) =>
  d.toISOString().replace('T', ' ').replace('Z', '');

export const insertRows = (
  t: KnowledgeTarget,
  name: string,
  values: Record<string, unknown>[],
) =>
  withWriteGrants(t.database, () =>
    t.client.insert({ table: qualifiedTable(t.database, name), values }),
  );

function knowledgeTableDdl(database: string): string[] {
  const t = (name: string) => qualifiedTable(database, name);
  return [
    `CREATE TABLE IF NOT EXISTS ${t(KG_TABLES.nodes)} (
  team_id String,
  source_id String,
  node_key String,
  kind LowCardinality(String),
  label String,
  attrs String,
  observed_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(observed_at)
ORDER BY (team_id, source_id, node_key)`,
    `CREATE TABLE IF NOT EXISTS ${t(KG_TABLES.edges)} (
  team_id String,
  source_id String,
  src String,
  rel LowCardinality(String),
  dst String,
  request_count UInt64,
  error_count UInt64,
  p95_ms Float64,
  observed_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(observed_at)
ORDER BY (team_id, source_id, src, rel, dst)`,
    `CREATE TABLE IF NOT EXISTS ${t(KG_TABLES.incidents)} (
  team_id String,
  incident_id String,
  title String,
  status LowCardinality(String),
  opened_at DateTime64(3, 'UTC'),
  resolved_at Nullable(DateTime64(3, 'UTC')),
  alerting_node String,
  root_cause_node String,
  root_cause String,
  resolution String,
  symptom_keys Array(String),
  summary String,
  embedding Array(Float32),
  confirmed_by String,
  version UInt64,
  path String DEFAULT ''
) ENGINE = ReplacingMergeTree(version)
ORDER BY (team_id, incident_id)`,
    `CREATE TABLE IF NOT EXISTS ${t(KG_TABLES.actions)} (
  team_id String,
  incident_id String,
  seq UInt32,
  ts DateTime64(3, 'UTC'),
  actor String,
  action_type LowCardinality(String),
  tool String,
  args String,
  reason String,
  outcome LowCardinality(String),
  summary String
) ENGINE = ReplacingMergeTree
ORDER BY (team_id, incident_id, seq)`,
  ];
}

export async function ensureKnowledgeTables(
  client: ClickhouseClient,
  database: string,
): Promise<void> {
  for (const query of knowledgeTableDdl(database)) {
    await client.command({ query });
  }
  // Upgrades incident tables created before the path column existed.
  await client.command({
    query: `ALTER TABLE ${qualifiedTable(database, KG_TABLES.incidents)} ADD COLUMN IF NOT EXISTS path String DEFAULT ''`,
  });
}
