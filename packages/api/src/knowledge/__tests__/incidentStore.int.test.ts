import { DEFAULT_DATABASE, getServer } from '@/fixtures';
import * as embeddingModule from '@/knowledge/incidents/embedding';
import {
  deleteIncidentsByTitlePrefix,
  listIncidents,
} from '@/knowledge/incidents/listing';
import {
  confirmIncident,
  getIncident,
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

describe('incident store', () => {
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

  it('opens an incident with the alerting service symptom and no duplicates', async () => {
    const t = await setup();
    const row = await open(t);
    expect(row).toMatchObject({
      status: 'open',
      version: 1,
      alerting_node: 'service:checkout',
      resolved_at: null,
      confirmed_by: '',
      embedding: [],
    });
    expect([...row.symptom_keys].sort()).toEqual([
      'error_class:timeout',
      'service:checkout',
    ]);
    expect(await getIncident(t, row.incident_id)).toEqual(row);
  });

  it('records actions, resolves with labels and writes topology edges', async () => {
    const t = await setup();
    const { incident_id } = await open(t);
    const a1 = await recordAction(t, 'agent', {
      incidentId: incident_id,
      actionType: 'query',
      tool: 'clickstack_search',
      args: { q: 'level:error' },
      summary: 'looked at errors',
    });
    const a2 = await recordAction(t, 'agent', {
      incidentId: incident_id,
      actionType: 'remediation',
      summary: 'rolled back',
    });
    expect([a1.seq, a2.seq]).toEqual([1, 2]);

    const resolved = await resolveIncident(t, 'agent', {
      incidentId: incident_id,
      rootCause: 'bad deploy',
      rootCauseNode: 'service:payments',
      resolution: 'rollback',
      affectedNodes: ['service:cart', 'service:cart'],
      outcomes: [{ seq: 2, outcome: 'led_to_fix' }],
    });
    expect(resolved).toMatchObject({ status: 'resolved', version: 2 });
    expect(resolved.resolved_at).not.toBeNull();

    const actions = await listActions(t, incident_id);
    expect(actions.map(a => [a.seq, a.outcome])).toEqual([
      [1, 'unknown'],
      [2, 'led_to_fix'],
    ]);
    expect(JSON.parse(actions[0].args)).toEqual({ q: 'level:error' });

    const res = await client.query({
      query: `SELECT rel, dst FROM ${DEFAULT_DATABASE}.${KG_TABLES.edges} FINAL WHERE team_id = {t:String} AND source_id = {src:String} AND src = {s:String} ORDER BY rel, dst`,
      query_params: {
        t: t.teamId,
        src: t.sourceId,
        s: `incident:${incident_id}`,
      },
      format: 'JSON',
    });
    expect((await res.json<{ rel: string; dst: string }>()).data).toEqual([
      { rel: 'AFFECTED', dst: 'service:cart' },
      { rel: 'ALERTED_ON', dst: 'service:checkout' },
      { rel: 'ROOT_CAUSE_AT', dst: 'service:payments' },
    ]);
  });

  it('throws on unknown incidents and unknown outcome seqs', async () => {
    const t = await setup();
    const id = '00000000-0000-4000-8000-000000000000';
    await expect(
      recordAction(t, 'a', {
        incidentId: id,
        actionType: 'note',
        summary: 's',
      }),
    ).rejects.toThrow('Incident not found');
    await expect(confirmIncident(t, 'me', id)).rejects.toThrow(
      'Incident not found',
    );
    const { incident_id } = await open(t);
    await expect(
      resolveIncident(t, 'a', {
        incidentId: incident_id,
        rootCause: 'x',
        rootCauseNode: 'service:x',
        resolution: 'y',
        outcomes: [{ seq: 9, outcome: 'useful' }],
      }),
    ).rejects.toThrow('Unknown action seq 9');
    expect((await getIncident(t, incident_id))?.status).toBe('open');
  });

  it('confirms and filters the list by confirmation and status', async () => {
    const t = await setup();
    const a = await openResolved(t, 'a');
    await openResolved(t, 'b');
    expect(await listIncidents(t, {})).toEqual([]);
    const confirmed = await confirmIncident(t, 'jordan', a.incident_id);
    expect(confirmed).toMatchObject({ confirmed_by: 'jordan', version: 3 });
    expect((await listIncidents(t, {})).map(i => i.title)).toEqual(['a']);
    expect(await listIncidents(t, { includeUnconfirmed: true })).toHaveLength(
      2,
    );
    expect(
      await listIncidents(t, { includeUnconfirmed: true, status: 'open' }),
    ).toEqual([]);
  });

  it('refuses to confirm an open incident', async () => {
    const t = await setup();
    const { incident_id } = await open(t);
    await expect(confirmIncident(t, 'me', incident_id)).rejects.toThrow(
      'Incident is not resolved',
    );
    expect((await getIncident(t, incident_id))?.version).toBe(1);
  });

  it('confirms without an embedding when the provider fails', async () => {
    const t = await setup();
    const { incident_id } = await openResolved(t);
    const spy = jest
      .spyOn(embeddingModule, 'embedText')
      .mockRejectedValue(new Error('provider down'));
    try {
      const row = await confirmIncident(t, 'me', incident_id);
      expect(row).toMatchObject({ embedding: [], confirmed_by: 'me' });
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps another team out of reads and writes', async () => {
    const t = await setup();
    const other = { ...t, teamId: 'another-team' };
    const mine = await openResolved(t);
    const theirs = await openResolved(other, 'theirs');
    await confirmIncident(t, 'me', mine.incident_id);
    await confirmIncident(other, 'them', theirs.incident_id);

    expect(await getIncident(other, mine.incident_id)).toBeNull();
    expect((await listIncidents(other, {})).map(i => i.title)).toEqual([
      'theirs',
    ]);
    await expect(confirmIncident(other, 'x', mine.incident_id)).rejects.toThrow(
      'Incident not found',
    );
    await expect(
      resolveIncident(other, 'x', {
        incidentId: mine.incident_id,
        rootCause: 'x',
        rootCauseNode: 'service:x',
        resolution: 'y',
      }),
    ).rejects.toThrow('Incident not found');
    expect(await listActions(other, mine.incident_id)).toEqual([]);
    expect(await deleteIncidentsByTitlePrefix(other, 'checkout')).toBe(0);
    expect(await getIncident(t, mine.incident_id)).not.toBeNull();
  });

  it('deletes only incidents matching the title prefix, with actions and edges', async () => {
    const t = await setup();
    const gone = await open(t, '[eval:x] one');
    const kept = await open(t, 'real incident');
    for (const i of [gone, kept]) {
      await recordAction(t, 'a', {
        incidentId: i.incident_id,
        actionType: 'note',
        summary: 'n',
      });
      await resolveIncident(t, 'a', {
        incidentId: i.incident_id,
        rootCause: 'x',
        rootCauseNode: 'service:x',
        resolution: 'y',
      });
    }
    expect(await deleteIncidentsByTitlePrefix(t, '[eval:x]')).toBe(1);
    expect(await getIncident(t, gone.incident_id)).toBeNull();
    expect(await listActions(t, gone.incident_id)).toEqual([]);
    expect(await getIncident(t, kept.incident_id)).not.toBeNull();
    expect(await listActions(t, kept.incident_id)).toHaveLength(1);

    const res = await client.query({
      query: `SELECT DISTINCT src FROM ${DEFAULT_DATABASE}.${KG_TABLES.edges} FINAL WHERE team_id = {t:String}`,
      query_params: { t: t.teamId },
      format: 'JSON',
    });
    expect((await res.json<{ src: string }>()).data).toEqual([
      { src: `incident:${kept.incident_id}` },
    ]);
    expect(await deleteIncidentsByTitlePrefix(t, '[eval:x]')).toBe(0);
  });

  it('rejects short delete prefixes, empty confirmers and double resolves', async () => {
    const t = await setup();
    const { incident_id } = await open(t);
    await expect(deleteIncidentsByTitlePrefix(t, ' a ')).rejects.toThrow(
      'titlePrefix must be at least 3 characters',
    );
    expect(await getIncident(t, incident_id)).not.toBeNull();
    await expect(confirmIncident(t, '  ', incident_id)).rejects.toThrow(
      'confirmedBy must not be empty',
    );
    const resolve = {
      incidentId: incident_id,
      rootCause: 'x',
      rootCauseNode: 'service:x',
      resolution: 'y',
    };
    await resolveIncident(t, 'a', resolve);
    await expect(resolveIncident(t, 'a', resolve)).rejects.toThrow(
      'Incident already resolved',
    );
  });

  it('gives concurrent actions distinct seqs and keeps both rows', async () => {
    const t = await setup();
    const { incident_id } = await open(t);
    const rec = (summary: string) =>
      recordAction(t, 'a', {
        incidentId: incident_id,
        actionType: 'note',
        summary,
      });
    const rows = await Promise.all([rec('one'), rec('two')]);
    expect(rows.map(r => r.seq).sort()).toEqual([1, 2]);
    expect(await listActions(t, incident_id)).toHaveLength(2);
  });
});
