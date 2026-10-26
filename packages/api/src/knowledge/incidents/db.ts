import { qualifiedTable } from '@/knowledge/tables';
import type { KnowledgeTarget } from '@/knowledge/target';

import type { IncidentRow } from './types';

const BASE_COLUMNS =
  'incident_id, title, status, opened_at, resolved_at, alerting_node, root_cause_node, root_cause, resolution, symptom_keys, summary, confirmed_by, version, path';
export const incidentColumns = (withEmbedding: boolean) =>
  withEmbedding ? `${BASE_COLUMNS}, embedding` : BASE_COLUMNS;

export const table = (t: KnowledgeTarget, name: string) =>
  qualifiedTable(t.database, name);

export async function select<T>(
  t: KnowledgeTarget,
  query: string,
  query_params: Record<string, unknown>,
): Promise<T[]> {
  const res = await t.client.query({
    query,
    query_params: { teamId: t.teamId, ...query_params },
    format: 'JSON',
    // Same format as the inserts, so returned rows equal read-back rows.
    clickhouse_settings: { date_time_output_format: 'simple' },
  });
  return (await res.json<T>()).data;
}

// UInt64 comes back as a string in JSON; embedding is absent when not selected.
export const toIncident = (
  r: Omit<IncidentRow, 'embedding'> & { embedding?: number[] },
): IncidentRow => ({
  ...r,
  embedding: r.embedding ?? [],
  version: Number(r.version),
});
