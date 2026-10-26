import express from 'express';
import request from 'supertest';

import { KnowledgeTargetError } from '@/knowledge/errors';
import type { IncidentRow } from '@/knowledge/incidents/types';
import { buildGraph } from '@/knowledge/topology/graph';
import router from '@/routers/api/incidentGraph';

const mockTeam = jest.fn();
const mockRefresh = jest.fn();
const mockListAffected = jest.fn();
const mockResolveTarget = jest.fn();
const mockLoadGraph = jest.fn();
const mockListIncidents = jest.fn();
const mockGetIncident = jest.fn();
const mockListActions = jest.fn();

jest.mock('@/models/team', () => ({
  __esModule: true,
  default: {
    modelName: 'Team',
    findById: () => ({ select: () => mockTeam() }),
  },
}));
jest.mock('@/knowledge/topology/refresh', () => ({
  refreshTopologyIfStale: (...a: unknown[]) => mockRefresh(...a),
}));
jest.mock('@/knowledge/target', () => ({
  resolveKnowledgeTarget: (...a: unknown[]) => mockResolveTarget(...a),
}));
jest.mock('@/knowledge/topology/graph', () => ({
  ...jest.requireActual('@/knowledge/topology/graph'),
  loadGraph: (...a: unknown[]) => mockLoadGraph(...a),
}));
jest.mock('@/knowledge/incidents/listing', () => ({
  listIncidents: (...a: unknown[]) => mockListIncidents(...a),
  listAffectedNodes: (...a: unknown[]) => mockListAffected(...a),
}));
jest.mock('@/knowledge/incidents/store', () => ({
  getIncident: (...a: unknown[]) => mockGetIncident(...a),
  listActions: (...a: unknown[]) => mockListActions(...a),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const incident = (o: Partial<IncidentRow> = {}): IncidentRow => ({
  incident_id: ID,
  title: 'Checkout errors',
  status: 'resolved',
  opened_at: '2026-10-26 01:00:00.000',
  resolved_at: '2026-10-26 02:00:00.000',
  alerting_node: 'service:checkout',
  root_cause_node: 'datastore:postgresql:db',
  root_cause: 'Pool exhausted',
  resolution: 'Raised the pool size',
  symptom_keys: [],
  summary: '',
  embedding: [0.1, 0.2],
  confirmed_by: '',
  version: 2,
  path: '',
  ...o,
});

const app = express();
app.use((req, _res, next) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  req.user = { _id: 'user1', team: 'team1' } as unknown as Express.User;
  next();
});
app.use('/knowledge', router);

beforeEach(() => {
  jest.clearAllMocks();
  mockTeam.mockResolvedValue({ isKnowledgeGraphEnabled: true });
  mockListAffected.mockResolvedValue([]);
  mockResolveTarget.mockResolvedValue({ teamId: 'team1' });
  mockLoadGraph.mockResolvedValue(
    buildGraph([
      {
        src: 'service:frontend',
        dst: 'service:checkout',
        requestCount: 100,
        errorCount: 5,
        p95Ms: 120,
      },
    ]),
  );
  mockListIncidents.mockResolvedValue([incident()]);
});

describe('GET /knowledge/graph', () => {
  it('returns topology, incident nodes and edges without embeddings', async () => {
    const res = await request(app).get('/knowledge/graph').expect(200);

    expect(mockRefresh).toHaveBeenCalled();
    expect(mockListIncidents).toHaveBeenCalledWith(expect.anything(), {
      includeUnconfirmed: true,
      limit: 200,
    });
    expect(res.body.nodes).toEqual(
      expect.arrayContaining([
        { key: 'service:frontend', kind: 'service', label: 'frontend' },
        {
          key: 'datastore:postgresql:db',
          kind: 'datastore',
          label: 'postgresql:db',
        },
        { key: `incident:${ID}`, kind: 'incident', label: 'Checkout errors' },
      ]),
    );
    expect(res.body.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: 'CALLS', errorCount: 5 }),
        { src: `incident:${ID}`, dst: 'service:checkout', rel: 'ALERTED_ON' },
        {
          src: `incident:${ID}`,
          dst: 'datastore:postgresql:db',
          rel: 'ROOT_CAUSE_AT',
        },
      ]),
    );
    expect(res.body.incidents[0]).toMatchObject({
      incidentId: ID,
      confirmed: false,
      rootCause: 'Pool exhausted',
    });
    expect(JSON.stringify(res.body)).not.toContain('embedding');
  });

  it('skips the root cause edge on an open incident', async () => {
    mockListIncidents.mockResolvedValue([
      incident({ status: 'open', root_cause_node: '', confirmed_by: 'a' }),
    ]);
    const res = await request(app).get('/knowledge/graph').expect(200);
    expect(
      res.body.edges.filter((e: { rel: string }) => e.rel !== 'CALLS'),
    ).toEqual([
      { src: `incident:${ID}`, dst: 'service:checkout', rel: 'ALERTED_ON' },
    ]);
    expect(res.body.incidents[0].confirmed).toBe(true);
  });

  it('returns 404 when the knowledge graph is off', async () => {
    mockTeam.mockResolvedValue({ isKnowledgeGraphEnabled: false });
    const res = await request(app).get('/knowledge/graph').expect(404);
    expect(res.body.message).toBeTruthy();
    expect(mockResolveTarget).not.toHaveBeenCalled();
  });

  it('returns 412 when the target cannot be resolved', async () => {
    mockResolveTarget.mockRejectedValue(
      new KnowledgeTargetError('No trace source found.'),
    );
    const res = await request(app).get('/knowledge/graph').expect(412);
    expect(res.body).toEqual({ message: 'No trace source found.' });
  });
});

describe('GET /knowledge/incidents/:id/playbook', () => {
  it('returns the playbook', async () => {
    mockGetIncident.mockResolvedValue(incident());
    mockListActions.mockResolvedValue([
      {
        incident_id: ID,
        seq: 1,
        ts: '',
        actor: 'a',
        action_type: 'query',
        tool: 'clickstack_search',
        args: '{}',
        reason: 'Look for errors',
        outcome: 'led_to_fix',
        summary: 'Found pool timeouts',
      },
    ]);
    const res = await request(app)
      .get(`/knowledge/incidents/${ID}/playbook`)
      .expect(200);
    expect(res.body).toMatchObject({
      incidentId: ID,
      steps: [{ seq: 1, tool: 'clickstack_search' }],
      ruledOut: [],
    });
  });

  it('returns 404 for a missing or malformed id', async () => {
    mockGetIncident.mockResolvedValue(null);
    await request(app).get(`/knowledge/incidents/${ID}/playbook`).expect(404);
    await request(app).get('/knowledge/incidents/nope/playbook').expect(404);
  });
});

describe('GET /knowledge/incidents/:id', () => {
  const storedPath = {
    nodes: ['service:checkout', 'datastore:postgresql:db'],
    edges: [
      {
        src: 'service:checkout',
        dst: 'datastore:postgresql:db',
        requestCount: 9,
        errorCount: 3,
        p95Ms: 800,
      },
    ],
  };

  it('returns the stored path, the current path and affected traffic', async () => {
    mockGetIncident.mockResolvedValue(
      incident({ path: JSON.stringify(storedPath) }),
    );
    mockListActions.mockResolvedValue([]);
    mockListAffected.mockResolvedValue(['service:frontend']);
    const res = await request(app)
      .get(`/knowledge/incidents/${ID}`)
      .expect(200);

    expect(res.body.path).toEqual(storedPath);
    // The checkout to db edge is not in the current topology.
    expect(res.body.currentPath).toBeNull();
    expect(res.body.affectedEdges).toEqual([
      expect.objectContaining({
        src: 'service:frontend',
        dst: 'service:checkout',
      }),
    ]);
    expect(res.body.nodes).toEqual(
      expect.arrayContaining([
        { key: 'service:frontend', kind: 'service', label: 'frontend' },
      ]),
    );
    expect(JSON.stringify(res.body)).not.toContain('embedding');
  });

  it('treats a missing or corrupt stored path as none', async () => {
    mockGetIncident.mockResolvedValue(incident({ path: '{"nodes":1}' }));
    mockListActions.mockResolvedValue([]);
    const res = await request(app)
      .get(`/knowledge/incidents/${ID}`)
      .expect(200);
    expect(res.body.path).toBeNull();
  });

  it('returns 404 for a malformed id', async () => {
    await request(app).get('/knowledge/incidents/nope').expect(404);
    expect(mockGetIncident).not.toHaveBeenCalled();
  });
});
