import { DEFAULT_DATABASE, getServer } from '@/fixtures';
import { KnowledgeError } from '@/knowledge/errors';
import * as embeddingModule from '@/knowledge/incidents/embedding';
import {
  listIncidents,
  listIncidentsForReview,
} from '@/knowledge/incidents/listing';
import {
  confirmIncident,
  listActions,
  openIncident,
  recordAction,
  resolveIncident,
} from '@/knowledge/incidents/store';
import { KG_TABLES } from '@/knowledge/tables';
import type { KnowledgeTarget } from '@/knowledge/target';

import {
  createIncidentTarget,
  kgClient,
  truncateKnowledgeTables,
} from './kgFixtures';

describe('incident store rules', () => {
  const server = getServer();
  const client = kgClient();

  beforeAll(async () => {
    await server.start();
  });
  afterEach(async () => {
    await truncateKnowledgeTables(client);
    await server.clearDBs();
  });
  afterAll(async () => {
    await server.stop();
  });

  const setup = () => createIncidentTarget(server, client);

  const open = (t: KnowledgeTarget, title = 'checkout 500s') =>
    openIncident(t, 'agent', {
      title,
      alertingService: 'checkout',
      symptomKeys: ['error_class:timeout', 'service:checkout'],
    });

  const openResolved = async (t: KnowledgeTarget, title = 'checkout 500s') => {
    const row = await open(t, title);
    await resolveIncident(t, 'agent', {
      incidentId: row.incident_id,
      rootCause: 'x',
      rootCauseNode: 'service:x',
      resolution: 'y',
    });
    return row;
  };

  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'resolved',
      (e: unknown) => (e instanceof KnowledgeError ? e.code : String(e)),
    );

  it('refuses actions on resolved incidents and reports typed error codes', async () => {
    const t = await setup();
    const { incident_id } = await openResolved(t);
    const note = { incidentId: incident_id, actionType: 'note' as const };
    expect(await code(recordAction(t, 'a', { ...note, summary: 'late' }))).toBe(
      'already_resolved',
    );
    expect(await listActions(t, incident_id)).toEqual([]);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(await code(confirmIncident(t, 'me', missing))).toBe('not_found');
    expect(await code(confirmIncident(t, ' ', incident_id))).toBe('invalid');
    const open = await openIncident(t, 'a', {
      title: 'o',
      alertingService: 'x',
    });
    expect(await code(confirmIncident(t, 'me', open.incident_id))).toBe(
      'not_resolved',
    );
  });

  it('normalises node keys without double prefixes', async () => {
    const t = await setup();
    const row = await openIncident(t, 'a', {
      title: 'n',
      alertingService: 'service:checkout',
    });
    expect(row.alerting_node).toBe('service:checkout');
    expect(row.symptom_keys).toEqual(['service:checkout']);
    const resolved = await resolveIncident(t, 'a', {
      incidentId: row.incident_id,
      rootCause: 'x',
      rootCauseNode: 'payments',
      resolution: 'y',
      affectedNodes: ['cart', 'service:cart', 'datastore:redis:c'],
    });
    expect(resolved.root_cause_node).toBe('service:payments');
    const res = await client.query({
      query: `SELECT dst FROM ${DEFAULT_DATABASE}.${KG_TABLES.edges} FINAL WHERE team_id = {t:String} AND rel = 'AFFECTED' ORDER BY dst`,
      query_params: { t: t.teamId },
      format: 'JSON',
    });
    expect((await res.json<{ dst: string }>()).data).toEqual([
      { dst: 'datastore:redis:c' },
      { dst: 'service:cart' },
    ]);
  });

  it('lists incidents for review by status and confirmation, without embeddings', async () => {
    const t = await setup();
    const a = await openResolved(t, 'a');
    await openResolved(t, 'b');
    await open(t, 'c');
    jest.spyOn(embeddingModule, 'embedText').mockResolvedValueOnce([1, 2]);
    await confirmIncident(t, 'me', a.incident_id);
    const titles = async (o: Parameters<typeof listIncidentsForReview>[1]) =>
      (await listIncidentsForReview(t, o)).map(i => i.title).sort();
    expect(await titles({})).toEqual(['a', 'b', 'c']);
    expect(await titles({ status: 'open' })).toEqual(['c']);
    expect(await titles({ confirmed: true })).toEqual(['a']);
    expect(await titles({ status: 'resolved', confirmed: false })).toEqual([
      'b',
    ]);
    const [confirmed] = await listIncidentsForReview(t, { confirmed: true });
    expect(confirmed.embedding).toEqual([]);
    expect(
      (await listIncidents(t, { withEmbedding: true }))[0].embedding,
    ).toEqual([1, 2]);
  });
});
