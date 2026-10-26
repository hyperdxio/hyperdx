import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { ClickhouseClient } from '@/clickhouse';
import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import { ensureKnowledgeTables, KG_TABLES } from '@/knowledge/tables';
import type { KnowledgeTarget } from '@/knowledge/target';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

export const kgClient = () =>
  new ClickhouseClient({
    host: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
  });

export async function truncateKnowledgeTables(client: ClickhouseClient) {
  for (const t of Object.values(KG_TABLES)) {
    await client.command({
      query: `TRUNCATE TABLE IF EXISTS ${DEFAULT_DATABASE}.${t}`,
    });
  }
}

// A logged-in team with one trace source and the knowledge tables in place.
export async function createIncidentTarget(
  server: ReturnType<typeof getServer>,
  client: ClickhouseClient,
): Promise<KnowledgeTarget> {
  const { team } = await getLoggedInAgent(server);
  const connection = await Connection.create({
    team: team._id,
    name: 'Default',
    host: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
  });
  const traceSource = await Source.create({
    kind: SourceKind.Trace,
    team: team._id,
    from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_TRACES_TABLE },
    timestampValueExpression: 'Timestamp',
    connection: connection._id,
    name: 'Traces',
  });
  await ensureKnowledgeTables(client, DEFAULT_DATABASE);
  return {
    client,
    database: DEFAULT_DATABASE,
    traceSource: traceSource.toObject(),
    sourceId: traceSource._id.toString(),
    teamId: team._id.toString(),
  };
}
