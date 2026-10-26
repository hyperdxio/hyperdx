import type { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { ClickhouseClient as ApiClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource, getSources } from '@/controllers/sources';
import { getTeam } from '@/controllers/team';
import { KnowledgeTargetError, withWriteGrants } from '@/knowledge/errors';
import { ensureKnowledgeTables } from '@/knowledge/tables';
import type { ISource } from '@/models/source';

export type KnowledgeTarget = {
  client: ClickhouseClient;
  database: string;
  traceSource: ISource;
  sourceId: string;
  teamId: string;
  // Team setting for the eval: retrieval also returns unconfirmed incidents.
  includeUnconfirmed?: boolean;
};

// Recorded only after the DDL succeeds, so a failed attempt retries.
const ensuredTables = new Set<string>();

async function findTraceSource(
  teamId: string,
  configuredId: string | undefined,
): Promise<ISource> {
  if (configuredId) {
    const configured = await getSource(teamId, configuredId);
    if (!configured) {
      throw new KnowledgeTargetError(
        'The configured knowledge graph trace source was not found. Set it with PUT /api/v2/knowledge/settings.',
      );
    }
    if (configured.kind !== SourceKind.Trace) {
      throw new KnowledgeTargetError(
        'The configured knowledge graph trace source is not a trace source. Set it with PUT /api/v2/knowledge/settings.',
      );
    }
    return configured;
  }
  const traceSources = (await getSources(teamId)).filter(
    s => s.kind === SourceKind.Trace,
  );
  if (traceSources.length === 0) {
    throw new KnowledgeTargetError(
      'No trace source found. Create one before using the knowledge graph.',
    );
  }
  if (traceSources.length > 1) {
    throw new KnowledgeTargetError(
      'Several trace sources found. Pick one with PUT /api/v2/knowledge/settings.',
    );
  }
  return traceSources[0];
}

export async function resolveKnowledgeTarget(
  teamId: string,
): Promise<KnowledgeTarget> {
  const team = await getTeam(teamId, [
    'knowledgeGraphTraceSource',
    'knowledgeGraphIncludeUnconfirmed',
  ]);
  const traceSource = await findTraceSource(
    teamId,
    team?.knowledgeGraphTraceSource?.toString(),
  );
  const connectionId = traceSource.connection.toString();
  const connection = await getConnectionById(teamId, connectionId, true);
  if (!connection) {
    throw new KnowledgeTargetError(
      'The trace source connection was not found.',
    );
  }
  const client = new ApiClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });
  const database = traceSource.from.databaseName;

  const key = `${connectionId}\u0000${database}`;
  if (!ensuredTables.has(key)) {
    await withWriteGrants(database, () =>
      ensureKnowledgeTables(client, database),
    );
    ensuredTables.add(key);
  }
  return {
    client,
    database,
    traceSource,
    // Documents carry _id; the inferred source type only declares id.
    sourceId:
      '_id' in traceSource ? String(traceSource._id) : String(traceSource.id),
    teamId,
    includeUnconfirmed: team?.knowledgeGraphIncludeUnconfirmed ?? false,
  };
}
