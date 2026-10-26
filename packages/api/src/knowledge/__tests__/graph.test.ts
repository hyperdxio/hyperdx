import type { KnowledgeTarget } from '@/knowledge/target';
import {
  buildGraph,
  type GraphEdge,
  loadGraph,
  nearby,
  walkCallees,
  walkCallers,
} from '@/knowledge/topology/graph';

const e = (src: string, dst: string): GraphEdge => ({
  src,
  dst,
  requestCount: 1,
  errorCount: 0,
  p95Ms: 1,
});

describe('graph walks', () => {
  const chain = buildGraph([e('A', 'B'), e('B', 'C'), e('C', 'D')]);

  it('walks a chain with depths and paths from the start', () => {
    expect(walkCallees(chain, 'A')).toEqual([
      { node: 'B', depth: 1, path: ['A', 'B'] },
      { node: 'C', depth: 2, path: ['A', 'B', 'C'] },
      { node: 'D', depth: 3, path: ['A', 'B', 'C', 'D'] },
    ]);
  });

  it('walks callers outward from the start', () => {
    expect(walkCallers(chain, 'C')).toEqual([
      { node: 'B', depth: 1, path: ['C', 'B'] },
      { node: 'A', depth: 2, path: ['C', 'B', 'A'] },
    ]);
  });

  it('terminates on a cycle and lists each node once', () => {
    const g = buildGraph([e('A', 'B'), e('B', 'A')]);
    expect(walkCallees(g, 'A')).toEqual([
      { node: 'B', depth: 1, path: ['A', 'B'] },
    ]);
  });

  it('respects maxDepth', () => {
    expect(walkCallees(chain, 'A', 2).map(h => h.node)).toEqual(['B', 'C']);
  });

  it('returns nothing for an unknown start', () => {
    expect(walkCallees(chain, 'Z')).toEqual([]);
    expect(walkCallers(chain, 'Z')).toEqual([]);
  });

  it('maps nodes within the depth, ignoring direction, to their hop count', () => {
    const g = buildGraph([e('A', 'B'), e('C', 'B'), e('C', 'D'), e('X', 'Y')]);
    expect(nearby(g, 'A', 2)).toEqual(
      new Map([
        ['A', 0],
        ['B', 1],
        ['C', 2],
      ]),
    );
    expect(nearby(g, 'missing', 2)).toEqual(new Map());
  });
});

describe('loadGraph', () => {
  it('queries edges for the team with FINAL and a limit', async () => {
    const query = jest.fn().mockResolvedValue({
      json: async () => ({
        data: [
          {
            src: 'service:a',
            dst: 'service:b',
            request_count: '10',
            error_count: '2',
            p95_ms: 12.5,
          },
        ],
      }),
    });
    // Only the fields loadGraph reads.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const target = {
      client: { query },
      database: 'db`x',
      teamId: 't1',
      sourceId: 'src1',
    } as unknown as KnowledgeTarget;

    const g = await loadGraph(target);

    const arg = query.mock.calls[0][0];
    expect(arg.query).toContain('FROM `db``x`.`hdx_kg_edges` FINAL');
    expect(arg.query).toContain(
      'team_id = {teamId:String} AND source_id = {sourceId:String}',
    );
    expect(arg.query).toContain("rel = 'CALLS'");
    expect(arg.query).toContain('LIMIT 50000');
    expect(arg.query).toContain(
      "observed_at >= (SELECT max(observed_at) FROM `db``x`.`hdx_kg_edges` WHERE team_id = {teamId:String} AND source_id = {sourceId:String} AND rel = 'CALLS') - INTERVAL 24 HOUR",
    );
    expect(arg.query_params).toEqual({ teamId: 't1', sourceId: 'src1' });
    expect(g.out.get('service:a')).toEqual([
      {
        src: 'service:a',
        dst: 'service:b',
        requestCount: 10,
        errorCount: 2,
        p95Ms: 12.5,
      },
    ]);
    expect(g.nodes).toEqual(new Set(['service:a', 'service:b']));
  });
});
