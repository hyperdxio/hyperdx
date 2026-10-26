import { randomUUID } from 'crypto';

import { KnowledgeError } from '@/knowledge/errors';
import {
  embedText,
  incidentEmbeddingText,
} from '@/knowledge/incidents/embedding';
import { fmt, insertRows, KG_TABLES } from '@/knowledge/tables';
import type { KnowledgeTarget } from '@/knowledge/target';
import { findCalleePath, loadGraph } from '@/knowledge/topology/graph';
import { toNodeKey } from '@/knowledge/topology/nodeKey';
import logger from '@/utils/logger';

import { incidentColumns, select, table, toIncident } from './db';
import {
  type ActionRow,
  type IncidentRow,
  type OpenIncidentInput,
  openIncidentSchema,
  type RecordActionInput,
  recordActionSchema,
  type ResolveIncidentInput,
  resolveIncidentSchema,
} from './types';

const ACTION_COLUMNS =
  'incident_id, seq, ts, actor, action_type, tool, args, reason, outcome, summary';

async function writeIncident(t: KnowledgeTarget, row: IncidentRow) {
  await insertRows(t, KG_TABLES.incidents, [{ team_id: t.teamId, ...row }]);
  return row;
}

export async function getIncident(
  t: KnowledgeTarget,
  incidentId: string,
): Promise<IncidentRow | null> {
  const rows = await select<IncidentRow>(
    t,
    `SELECT ${incidentColumns(true)} FROM ${table(t, KG_TABLES.incidents)} FINAL
     WHERE team_id = {teamId:String} AND incident_id = {incidentId:String}`,
    { incidentId },
  );
  return rows[0] ? toIncident(rows[0]) : null;
}

export async function requireIncident(t: KnowledgeTarget, incidentId: string) {
  const row = await getIncident(t, incidentId);
  if (!row) throw new KnowledgeError('not_found', 'Incident not found');
  return row;
}

export async function openIncident(
  t: KnowledgeTarget,
  _actor: string,
  input: OpenIncidentInput,
): Promise<IncidentRow> {
  const { title, alertingService, symptomKeys, summary } =
    openIncidentSchema.parse(input);
  const alerting_node = toNodeKey(alertingService);
  return writeIncident(t, {
    incident_id: randomUUID(),
    title,
    status: 'open',
    opened_at: fmt(new Date()),
    resolved_at: null,
    alerting_node,
    root_cause_node: '',
    root_cause: '',
    resolution: '',
    symptom_keys: [...new Set([alerting_node, ...symptomKeys])],
    summary: summary ?? '',
    embedding: [],
    confirmed_by: '',
    version: 1,
    path: '',
  });
}

export async function listActions(
  t: KnowledgeTarget,
  incidentId: string,
): Promise<ActionRow[]> {
  return select<ActionRow>(
    t,
    `SELECT ${ACTION_COLUMNS} FROM ${table(t, KG_TABLES.actions)} FINAL
     WHERE team_id = {teamId:String} AND incident_id = {incidentId:String}
     ORDER BY seq`,
    { incidentId },
  );
}

// shortcut: serialised per process only; several API instances can still collide, move seq allocation into a single writer if that matters
const actionLocks = new Map<string, Promise<unknown>>();

export function recordAction(
  t: KnowledgeTarget,
  actor: string,
  input: RecordActionInput,
): Promise<ActionRow> {
  const i = recordActionSchema.parse(input);
  const key = `${t.teamId}\u0000${i.incidentId}`;
  const run = (actionLocks.get(key) ?? Promise.resolve()).then(() =>
    insertAction(t, actor, i),
  );
  const tail = run.catch(() => undefined);
  actionLocks.set(key, tail);
  void tail.then(() => {
    if (actionLocks.get(key) === tail) actionLocks.delete(key);
  });
  return run;
}

async function insertAction(
  t: KnowledgeTarget,
  actor: string,
  i: ReturnType<typeof recordActionSchema.parse>,
): Promise<ActionRow> {
  const incident = await requireIncident(t, i.incidentId);
  if (incident.status === 'resolved') {
    throw new KnowledgeError('already_resolved', 'Incident already resolved');
  }
  const [{ max_seq }] = await select<{ max_seq: number }>(
    t,
    `SELECT max(seq) AS max_seq FROM ${table(t, KG_TABLES.actions)} FINAL
     WHERE team_id = {teamId:String} AND incident_id = {incidentId:String}`,
    { incidentId: i.incidentId },
  );
  const row: ActionRow = {
    incident_id: i.incidentId,
    seq: Number(max_seq) + 1,
    ts: fmt(new Date()),
    actor,
    action_type: i.actionType,
    tool: i.tool ?? '',
    args: JSON.stringify(i.args ?? {}),
    reason: i.reason ?? '',
    outcome: 'unknown',
    summary: i.summary,
  };
  await insertRows(t, KG_TABLES.actions, [{ team_id: t.teamId, ...row }]);
  return row;
}

export async function resolveIncident(
  t: KnowledgeTarget,
  actor: string,
  input: ResolveIncidentInput,
): Promise<IncidentRow> {
  const i = resolveIncidentSchema.parse(input);
  const current = await requireIncident(t, i.incidentId);
  if (current.status === 'resolved')
    throw new KnowledgeError('already_resolved', 'Incident already resolved');
  const actions = await listActions(t, i.incidentId);
  const labelled = i.outcomes.map(o => {
    const action = actions.find(a => a.seq === o.seq);
    if (!action)
      throw new KnowledgeError('unknown_seq', `Unknown action seq ${o.seq}`);
    return { ...action, outcome: o.outcome };
  });

  const now = new Date();
  const rootCauseNode = toNodeKey(i.rootCauseNode);
  const dsts: Array<[string, string]> = [
    ['ALERTED_ON', current.alerting_node],
    ['ROOT_CAUSE_AT', rootCauseNode],
    ...[...new Set(i.affectedNodes.map(toNodeKey))].map(
      (n): [string, string] => ['AFFECTED', n],
    ),
  ];
  await insertRows(
    t,
    KG_TABLES.edges,
    dsts.map(([rel, dst]) => ({
      team_id: t.teamId,
      source_id: t.sourceId,
      src: `incident:${i.incidentId}`,
      rel,
      dst,
      request_count: 0,
      error_count: 0,
      p95_ms: 0,
      observed_at: fmt(now),
    })),
  );
  if (labelled.length > 0) {
    // No version column: ReplacingMergeTree keeps the last inserted row, which is this one.
    await insertRows(
      t,
      KG_TABLES.actions,
      labelled.map(a => ({ team_id: t.teamId, ...a })),
    );
  }
  return writeIncident(t, {
    ...current,
    status: 'resolved',
    resolved_at: fmt(now),
    root_cause: i.rootCause,
    root_cause_node: rootCauseNode,
    resolution: i.resolution,
    summary: i.summary ?? current.summary,
    version: current.version + 1,
    path: await snapshotPath(t, current.alerting_node, rootCauseNode),
  });
}

// Topology is only kept as current traffic, so the path is captured now; a failure must not block resolving.
async function snapshotPath(t: KnowledgeTarget, from: string, to: string) {
  try {
    const path = findCalleePath(await loadGraph(t), from, to);
    return path ? JSON.stringify(path) : '';
  } catch (err) {
    logger.warn(
      { err, teamId: t.teamId },
      'incident path snapshot failed, resolving without one',
    );
    return '';
  }
}

export async function confirmIncident(
  t: KnowledgeTarget,
  confirmedBy: string,
  incidentId: string,
): Promise<IncidentRow> {
  if (!confirmedBy.trim())
    throw new KnowledgeError('invalid', 'confirmedBy must not be empty');
  const current = await requireIncident(t, incidentId);
  if (current.status !== 'resolved')
    throw new KnowledgeError('not_resolved', 'Incident is not resolved');
  let embedding: number[] = [];
  try {
    embedding = (await embedText(incidentEmbeddingText(current))) ?? [];
  } catch (err) {
    logger.warn(
      { err, teamId: t.teamId, incidentId },
      'incident embedding failed, confirming without one',
    );
  }
  return writeIncident(t, {
    ...current,
    embedding,
    confirmed_by: confirmedBy,
    version: current.version + 1,
  });
}
