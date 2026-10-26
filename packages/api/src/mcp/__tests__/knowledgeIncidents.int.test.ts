import { DEFAULT_DATABASE, DEFAULT_TRACES_TABLE, getServer } from '@/fixtures';
import { kgClient } from '@/knowledge/__tests__/kgFixtures';
import { confirmIncident } from '@/knowledge/incidents/store';
import { resolveKnowledgeTarget } from '@/knowledge/target';
import Team from '@/models/team';

import {
  baseline,
  endTime,
  failingDb,
  json,
  setupKnowledgeClient,
  startTime,
  topologyTrace,
} from './knowledgeFixtures';
import { callTool, getFirstText } from './mcpTestUtils';

describe('knowledge graph MCP incident tools', () => {
  const server = getServer();
  const client = kgClient();

  beforeAll(async () => {
    await server.start();
  });
  afterEach(async () => {
    await client.command({
      query: `TRUNCATE TABLE ${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`,
    });
    await server.clearDBs();
  });
  afterAll(async () => {
    await server.stop();
  });

  const setup = async (spans: Parameters<typeof setupKnowledgeClient>[1]) =>
    (await setupKnowledgeClient(server, spans)).client;
  type Client = Awaited<ReturnType<typeof setup>>;

  async function resolved(c: Client) {
    const opened = json(
      await callTool(c, 'clickstack_open_incident', {
        title: 'Checkout 5xx',
        alertingService: 'checkout',
        symptomKeys: ['service:checkout'],
      }),
    );
    const rec = json(
      await callTool(c, 'clickstack_record_incident_action', {
        incidentId: opened.incidentId,
        actionType: 'remediation',
        tool: 'clickstack_search',
        args: { service: 'checkout' },
        summary: 'Rolled back the pool change',
      }),
    );
    const res = await callTool(c, 'clickstack_resolve_incident', {
      incidentId: opened.incidentId,
      rootCause: 'Pool exhausted',
      rootCauseNode: 'datastore:postgresql:orders-db',
      resolution: 'Raised the pool size',
      outcomes: [{ seq: rec.seq, outcome: 'led_to_fix' }],
    });
    return { id: String(opened.incidentId), seq: Number(rec.seq), res };
  }

  const confirm = async (id: string) => {
    const team = await Team.findOne();
    await confirmIncident(
      await resolveKnowledgeTarget(team!._id.toString()),
      'jordan',
      id,
    );
  };

  it('opens, records and resolves an incident', async () => {
    const c = await setup(topologyTrace());
    const { id, seq, res } = await resolved(c);
    expect(seq).toBe(1);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(res.content)).toMatch(
      /not used for retrieval until a person confirms/,
    );
    expect(getFirstText(res)).toMatch(/"status": "resolved"/);
  });

  it('returns user errors for unknown or already resolved incidents', async () => {
    const c = await setup(topologyTrace());
    const missing = await callTool(c, 'clickstack_record_incident_action', {
      incidentId: '00000000-0000-4000-8000-000000000000',
      actionType: 'note',
      summary: 'x',
    });
    expect(missing.isError).toBe(true);
    expect(getFirstText(missing)).toMatch(/Incident not found/);

    const { id } = await resolved(c);
    const again = await callTool(c, 'clickstack_resolve_incident', {
      incidentId: id,
      rootCause: 'x',
      rootCauseNode: 'service:checkout',
      resolution: 'x',
    });
    expect(again.isError).toBe(true);
    expect(getFirstText(again)).toMatch(/already resolved/);
    const late = await callTool(c, 'clickstack_record_incident_action', {
      incidentId: id,
      actionType: 'note',
      summary: 'after the fact',
    });
    expect(late.isError).toBe(true);
    expect(getFirstText(late)).toMatch(/already resolved/);

    const open = json(
      await callTool(c, 'clickstack_open_incident', {
        title: 't',
        alertingService: 'checkout',
      }),
    );
    const badSeq = await callTool(c, 'clickstack_resolve_incident', {
      incidentId: open.incidentId,
      rootCause: 'x',
      rootCauseNode: 'service:checkout',
      resolution: 'x',
      outcomes: [{ seq: 9, outcome: 'useful' }],
    });
    expect(badSeq.isError).toBe(true);
    expect(getFirstText(badSeq)).toMatch(/Unknown action seq 9/);
  });

  it('finds unconfirmed incidents only when the team setting is on', async () => {
    const c = await setup(topologyTrace());
    const { id } = await resolved(c);
    const tool = (await c.listTools()).tools.find(
      t => t.name === 'clickstack_find_similar_incidents',
    );
    expect(tool?.inputSchema.properties).not.toHaveProperty(
      'includeUnconfirmed',
    );
    const find = () =>
      callTool(c, 'clickstack_find_similar_incidents', {
        service: 'checkout',
        symptomKeys: ['service:checkout'],
      });
    expect(json(await find())).toEqual([]);
    await Team.updateOne({}, { knowledgeGraphIncludeUnconfirmed: true });
    expect(json(await find())[0]).toMatchObject({
      incidentId: id,
      rootCause: 'Pool exhausted',
      rootCauseNode: 'datastore:postgresql:orders-db',
      resolution: 'Raised the pool size',
    });
    await Team.updateOne({}, { knowledgeGraphIncludeUnconfirmed: false });
    await confirm(id);
    const found = json(await find());
    expect(found.map((f: { incidentId: string }) => f.incidentId)).toEqual([
      id,
    ]);
    expect(found[0].terms.jaccard).toBeGreaterThan(0);
  });

  it('returns the playbook with parsed args', async () => {
    const c = await setup(topologyTrace());
    const { id, seq } = await resolved(c);
    const book = json(
      await callTool(c, 'clickstack_get_incident_playbook', { incidentId: id }),
    );
    expect(book.steps).toMatchObject([
      { seq, outcome: 'led_to_fix', args: { service: 'checkout' } },
    ]);
    const missing = await callTool(c, 'clickstack_get_incident_playbook', {
      incidentId: '00000000-0000-4000-8000-000000000000',
    });
    expect(missing.isError).toBe(true);
    expect(getFirstText(missing)).toMatch(/Incident not found/);
  });

  it('returns root cause, blast radius from the top candidate and confirmed incidents in one call', async () => {
    const c = await setup([...topologyTrace(), ...baseline(), ...failingDb()]);
    const { id } = await resolved(c);
    await confirm(id);
    const out = json(
      await callTool(c, 'clickstack_incident_context', {
        service: 'checkout',
        startTime,
        endTime,
        symptomKeys: ['service:checkout'],
      }),
    );
    expect(out.rootCause.candidates[0].node).toBe(
      'datastore:postgresql:orders-db',
    );
    expect(out.blastRadiusFrom).toBe('datastore:postgresql:orders-db');
    expect(out.blastRadius.map((h: { node: string }) => h.node)).toEqual([
      'service:checkout',
      'service:edge-gateway',
    ]);
    expect(out.similar[0].incidentId).toBe(id);
    expect(out.similar[0].playbook.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('returns no similar incidents until one is confirmed', async () => {
    const c = await setup(topologyTrace());
    await resolved(c);
    const out = json(
      await callTool(c, 'clickstack_incident_context', {
        service: 'edge-gateway',
        startTime,
        endTime,
      }),
    );
    expect(out.similar).toEqual([]);
  });
});
