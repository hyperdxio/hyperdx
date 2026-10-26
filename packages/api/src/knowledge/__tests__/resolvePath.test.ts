import { resolveIncident } from '@/knowledge/incidents/store';
import type { IncidentRow } from '@/knowledge/incidents/types';
import { KG_TABLES } from '@/knowledge/tables';
import type { KnowledgeTarget } from '@/knowledge/target';
import { buildGraph } from '@/knowledge/topology/graph';

const mockSelect = jest.fn();
const mockInsertRows = jest.fn();
const mockLoadGraph = jest.fn();

jest.mock('@/knowledge/incidents/db', () => ({
  ...jest.requireActual('@/knowledge/incidents/db'),
  select: (...a: unknown[]) => mockSelect(...a),
}));
jest.mock('@/knowledge/tables', () => ({
  ...jest.requireActual('@/knowledge/tables'),
  insertRows: (...a: unknown[]) => mockInsertRows(...a),
}));
jest.mock('@/knowledge/topology/graph', () => ({
  ...jest.requireActual('@/knowledge/topology/graph'),
  loadGraph: (...a: unknown[]) => mockLoadGraph(...a),
}));

const ID = '11111111-1111-4111-8111-111111111111';
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const target = { teamId: 'team1', database: 'db' } as KnowledgeTarget;
const open: IncidentRow = {
  incident_id: ID,
  title: 'Checkout errors',
  status: 'open',
  opened_at: '2026-10-26 01:00:00.000',
  resolved_at: null,
  alerting_node: 'service:frontend',
  root_cause_node: '',
  root_cause: '',
  resolution: '',
  symptom_keys: [],
  summary: '',
  embedding: [],
  confirmed_by: '',
  version: 1,
  path: '',
};
const edge = (src: string, dst: string, errorCount = 0) => ({
  src,
  dst,
  requestCount: 100,
  errorCount,
  p95Ms: 50,
});

const resolve = (rootCauseNode: string) =>
  resolveIncident(target, 'agent', {
    incidentId: ID,
    rootCause: 'Pool exhausted',
    rootCauseNode,
    resolution: 'Raised the pool size',
  });

const storedPath = () => {
  const call = mockInsertRows.mock.calls.find(
    c => c[1] === KG_TABLES.incidents,
  );
  return call?.[2][0].path;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSelect.mockImplementation((_t, query: string) =>
    query.includes(KG_TABLES.actions) ? [] : [open],
  );
  mockLoadGraph.mockResolvedValue(
    buildGraph([
      edge('service:frontend', 'service:checkout'),
      edge('service:checkout', 'service:frontend'),
      edge('service:checkout', 'datastore:postgresql:db', 7),
      edge('service:other', 'service:frontend'),
    ]),
  );
});

describe('resolveIncident path snapshot', () => {
  it('stores the callee path from the alerting node with each edge', async () => {
    const row = await resolve('datastore:postgresql:db');
    const expected = {
      nodes: [
        'service:frontend',
        'service:checkout',
        'datastore:postgresql:db',
      ],
      edges: [
        edge('service:frontend', 'service:checkout'),
        edge('service:checkout', 'datastore:postgresql:db', 7),
      ],
    };
    expect(JSON.parse(row.path)).toEqual(expected);
    expect(JSON.parse(storedPath())).toEqual(expected);
  });

  it('stores an empty path when the root cause is not downstream', async () => {
    expect((await resolve('service:other')).path).toBe('');
  });

  it('still resolves when the graph cannot be loaded', async () => {
    mockLoadGraph.mockRejectedValue(new Error('clickhouse down'));
    const row = await resolve('service:checkout');
    expect(row).toMatchObject({ status: 'resolved', path: '' });
  });
});
