import { DEFAULT_DATABASE, DEFAULT_TRACES_TABLE, getServer } from '@/fixtures';
import { kgClient } from '@/knowledge/__tests__/kgFixtures';
import { KG_TABLES } from '@/knowledge/tables';
import { UNKNOWN_START_HINT } from '@/knowledge/topology/rootCause';

import {
  baseline,
  endTime,
  failingDb,
  json,
  now,
  setupKnowledgeClient,
  startTime,
  topologyTrace,
} from './knowledgeFixtures';
import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('knowledge graph MCP topology tools', () => {
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

  const setup = async (
    spans: Parameters<typeof setupKnowledgeClient>[1],
    sources?: 0 | 1 | 2,
  ) => (await setupKnowledgeClient(server, spans, sources)).client;
  const rootCause = (c: Awaited<ReturnType<typeof setup>>, extra = {}) =>
    callTool(c, 'clickstack_trace_root_cause', {
      service: 'edge-gateway',
      startTime,
      endTime,
      ...extra,
    });

  it('registers no knowledge tools when the flag is off', async () => {
    const c = await createTestClient({ teamId: 't', userId: 'u' });
    const names = (await c.listTools()).tools.map(t => t.name);
    expect(names).not.toContain('clickstack_trace_root_cause');
    expect(names).not.toContain('clickstack_blast_radius');
  });

  it('ranks the failing datastore as the root cause', async () => {
    const c = await setup([...topologyTrace(), ...baseline(), ...failingDb()]);
    const out = json(await rootCause(c));
    expect(out.status).toBe('ok');
    expect(out.candidates[0].node).toBe('datastore:postgresql:orders-db');
    expect(out.hint).toBeUndefined();
  });

  it('builds the graph for a past window in memory without writing it', async () => {
    const at = now - 3 * 3_600_000;
    const { client: c, team } = await setupKnowledgeClient(server, [
      ...topologyTrace(at),
      ...baseline(at - 15 * 60_000),
      ...failingDb(at),
    ]);
    const out = json(
      await rootCause(c, {
        startTime: new Date(at - 10 * 60_000).toISOString(),
        endTime: new Date(at + 60_000).toISOString(),
      }),
    );
    expect(out.candidates[0]).toMatchObject({
      node: 'datastore:postgresql:orders-db',
      depth: 2,
    });
    const res = await client.query({
      query: `SELECT count() AS n FROM ${DEFAULT_DATABASE}.${KG_TABLES.edges} WHERE team_id = {t:String}`,
      query_params: { t: team._id.toString() },
      format: 'JSON',
    });
    expect((await res.json<{ n: string }>()).data[0].n).toBe('0');
  });

  it('says there is no data for an empty window', async () => {
    const c = await setup(topologyTrace());
    const out = json(
      await rootCause(c, {
        startTime: new Date(now - 48 * 3_600_000).toISOString(),
        endTime: new Date(now - 47 * 3_600_000).toISOString(),
      }),
    );
    expect(out.status).toBe('no_data');
    expect(out.hint).toMatch(/No spans in this window/);
  });

  it('says when the service is not in the topology', async () => {
    const c = await setup([...topologyTrace(), ...baseline()]);
    const out = json(await rootCause(c, { service: 'edge-gatewy' }));
    expect(out).toMatchObject({ status: 'ok', candidates: [] });
    expect(out.hint).toBe(UNKNOWN_START_HINT);
  });

  it('points at the service itself when nothing downstream is anomalous', async () => {
    const c = await setup([...topologyTrace(), ...baseline()]);
    const out = json(await rootCause(c, { service: 'service:edge-gateway' }));
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]).toMatchObject({
      node: 'service:edge-gateway',
      depth: 0,
    });
    expect(out.hint).toMatch(/Nothing downstream is anomalous/);
  });

  it('lists the callers of a datastore with their hop counts', async () => {
    const c = await setup([...topologyTrace(), ...baseline()]);
    const res = await callTool(c, 'clickstack_blast_radius', {
      node: 'datastore:postgresql:orders-db',
      startTime,
      endTime,
    });
    const hits: Array<{ node: string; depth: number }> = JSON.parse(
      getFirstText(res),
    );
    expect(hits.map(h => [h.node, h.depth])).toEqual([
      ['service:checkout', 1],
      ['service:edge-gateway', 2],
    ]);
  });

  it('returns a user error when the team has no trace source', async () => {
    const res = await rootCause(await setup([], 0));
    expect(res.isError).toBe(true);
    expect(getFirstText(res)).toMatch(/No trace source found/);
  });

  it('returns a user error naming the settings endpoint for several trace sources', async () => {
    const res = await rootCause(await setup([], 2));
    expect(res.isError).toBe(true);
    expect(getFirstText(res)).toMatch(
      /Several trace sources.*PUT \/api\/v2\/knowledge\/settings/,
    );
  });
});
