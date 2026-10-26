import { KnowledgeError, withWriteGrants } from '@/knowledge/errors';
import { KG_TABLES } from '@/knowledge/tables';
import type { KnowledgeTarget } from '@/knowledge/target';

import { incidentColumns, select, table, toIncident } from './db';
import type { IncidentRow } from './types';

// Lightweight deletes are async by default; wait so the rows are gone on return.
// Needs a ClickHouse version that supports lightweight_deletes_sync.
const SYNC_DELETE = { lightweight_deletes_sync: '2' } as const;
const REVIEW_LIMIT = 100;

type Status = 'open' | 'resolved';

async function queryIncidents(
  t: KnowledgeTarget,
  o: {
    status?: Status;
    confirmed?: boolean;
    withEmbedding: boolean;
    limit?: number;
  },
): Promise<IncidentRow[]> {
  const rows = await select<IncidentRow>(
    t,
    `SELECT ${incidentColumns(o.withEmbedding)} FROM ${table(t, KG_TABLES.incidents)} FINAL
     WHERE team_id = {teamId:String}
       AND ({status:String} = '' OR status = {status:String})
       AND ({confirmed:String} = '' OR (confirmed_by != '') = ({confirmed:String} = 'true'))
     ORDER BY opened_at DESC
     ${o.limit ? `LIMIT ${Math.trunc(o.limit)}` : ''}`,
    {
      status: o.status ?? '',
      confirmed: o.confirmed === undefined ? '' : String(o.confirmed),
    },
  );
  return rows.map(toIncident);
}

// Retrieval input: confirmed incidents only unless includeUnconfirmed.
export const listIncidents = (
  t: KnowledgeTarget,
  opts: {
    status?: Status;
    includeUnconfirmed?: boolean;
    withEmbedding?: boolean;
    limit?: number;
  },
) =>
  queryIncidents(t, {
    status: opts.status,
    confirmed: opts.includeUnconfirmed ? undefined : true,
    withEmbedding: opts.withEmbedding ?? false,
    limit: opts.limit,
  });

export async function listAffectedNodes(
  t: KnowledgeTarget,
  incidentId: string,
): Promise<string[]> {
  const rows = await select<{ dst: string }>(
    t,
    `SELECT DISTINCT dst FROM ${table(t, KG_TABLES.edges)} FINAL
     WHERE team_id = {teamId:String} AND src = {src:String} AND rel = 'AFFECTED'
     ORDER BY dst`,
    { src: `incident:${incidentId}` },
  );
  return rows.map(r => r.dst);
}

// For a person reviewing incidents before confirming them; newest first.
export const listIncidentsForReview = (
  t: KnowledgeTarget,
  opts: { status?: Status; confirmed?: boolean },
) => queryIncidents(t, { ...opts, withEmbedding: false, limit: REVIEW_LIMIT });

export async function deleteIncidentsByTitlePrefix(
  t: KnowledgeTarget,
  prefix: string,
): Promise<number> {
  if (prefix.trim().length < 3) {
    throw new KnowledgeError(
      'invalid',
      'titlePrefix must be at least 3 characters',
    );
  }
  const ids = (
    await select<{ incident_id: string }>(
      t,
      `SELECT incident_id FROM ${table(t, KG_TABLES.incidents)} FINAL
       WHERE team_id = {teamId:String} AND startsWith(title, {prefix:String})`,
      { prefix },
    )
  ).map(r => r.incident_id);
  if (ids.length === 0) return 0;

  // Incident edges are removed whatever trace source they were written under.
  const del = (name: string, column: string, values: string[]) =>
    withWriteGrants(t.database, () =>
      t.client.command({
        query: `DELETE FROM ${table(t, name)}
                WHERE team_id = {teamId:String} AND ${column} IN {values:Array(String)}`,
        query_params: { teamId: t.teamId, values },
        clickhouse_settings: SYNC_DELETE,
      }),
    );
  await del(KG_TABLES.incidents, 'incident_id', ids);
  await del(KG_TABLES.actions, 'incident_id', ids);
  await del(
    KG_TABLES.edges,
    'src',
    ids.map(id => `incident:${id}`),
  );
  return ids.length;
}
