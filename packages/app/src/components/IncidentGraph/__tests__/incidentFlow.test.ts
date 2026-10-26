import {
  filterIncidents,
  stepNodes,
  toIncidentFlow,
} from '@/components/IncidentGraph/incidentFlow';
import type {
  IncidentDetail,
  KgIncident,
  KgPath,
} from '@/components/IncidentGraph/types';

const incident = (o: Partial<KgIncident> = {}): KgIncident => ({
  incidentId: 'a',
  title: 'Checkout errors',
  status: 'resolved',
  confirmed: true,
  confirmedBy: 'jordan',
  alertingNode: 'service:frontend',
  rootCauseNode: 'datastore:postgresql:db',
  rootCause: 'Pool exhausted',
  resolution: 'Raised the pool size',
  openedAt: '2026-10-26 01:00:00.000',
  resolvedAt: '2026-10-26 02:00:00.000',
  ...o,
});

const hop = (src: string, dst: string) => ({
  src,
  dst,
  requestCount: 1000,
  errorCount: 50,
  p95Ms: 340.4,
});
const viaCheckout: KgPath = {
  nodes: ['service:frontend', 'service:checkout', 'datastore:postgresql:db'],
  edges: [
    hop('service:frontend', 'service:checkout'),
    hop('service:checkout', 'datastore:postgresql:db'),
  ],
};
const direct: KgPath = {
  nodes: ['service:frontend', 'datastore:postgresql:db'],
  edges: [hop('service:frontend', 'datastore:postgresql:db')],
};

const nodes = [
  { key: 'service:frontend', kind: 'service' as const, label: 'frontend' },
  { key: 'service:checkout', kind: 'service' as const, label: 'checkout' },
  { key: 'service:cart', kind: 'service' as const, label: 'cart' },
  {
    key: 'datastore:postgresql:db',
    kind: 'datastore' as const,
    label: 'postgresql:db',
  },
];

const detail = (o: Partial<IncidentDetail> = {}): IncidentDetail => ({
  incident: incident(),
  actions: [],
  playbook: {
    incidentId: 'a',
    rootCause: '',
    rootCauseNode: '',
    resolution: '',
    steps: [],
    ruledOut: [],
  },
  path: null,
  currentPath: null,
  affectedNodes: [],
  affectedEdges: [],
  nodes,
  ...o,
});

const flow = (d: IncidentDetail, highlighted = new Set<string>()) =>
  toIncidentFlow(d, highlighted);

describe('toIncidentFlow', () => {
  it('prefers the path stored at resolve time over current traffic', () => {
    const {
      source,
      nodes: n,
      edges,
    } = flow(detail({ path: viaCheckout, currentPath: direct }));
    expect(source).toBe('resolve');
    expect(n.map(x => x.id)).toEqual(viaCheckout.nodes);
    expect(edges.map(e => e.label)).toEqual([
      '1,000 req, 5.0% errors, p95 340 ms',
      '1,000 req, 5.0% errors, p95 340 ms',
    ]);
    expect(n.map(x => x.data.role)).toEqual(['start', undefined, 'target']);
  });

  it('falls back to the current traffic path', () => {
    const { source, nodes: n } = flow(detail({ currentPath: direct }));
    expect(source).toBe('current');
    expect(n.map(x => x.id)).toEqual(direct.nodes);
  });

  it('joins alerting and root cause with a dashed edge when no path is found', () => {
    const { source, nodes: n, edges } = flow(detail());
    expect(source).toBe('not_found');
    expect(n.map(x => x.id)).toEqual([
      'service:frontend',
      'datastore:postgresql:db',
    ]);
    expect(edges).toEqual([
      expect.objectContaining({
        source: 'service:frontend',
        target: 'datastore:postgresql:db',
        label: 'Path not found',
        style: expect.objectContaining({ strokeDasharray: '6 4' }),
      }),
    ]);
  });

  it('shows only the alerting node for an open incident', () => {
    const {
      source,
      nodes: n,
      edges,
    } = flow(
      detail({ incident: incident({ status: 'open', rootCauseNode: '' }) }),
    );
    expect(source).toBe('open');
    expect(n.map(x => x.id)).toEqual(['service:frontend']);
    expect(edges).toEqual([]);
  });

  it('adds affected nodes and the traffic that links them', () => {
    const { nodes: n, edges } = flow(
      detail({
        path: viaCheckout,
        affectedNodes: ['service:cart'],
        affectedEdges: [
          hop('service:cart', 'service:checkout'),
          hop('service:cart', 'service:elsewhere'),
        ],
      }),
    );
    expect(n.find(x => x.id === 'service:cart')?.data.role).toBe('affected');
    expect(edges.map(e => e.id)).toContain(
      'context:service:cart->service:checkout',
    );
    expect(edges.map(e => e.id)).not.toContain(
      'context:service:cart->service:elsewhere',
    );
  });

  it('marks highlighted nodes', () => {
    const { nodes: n } = flow(
      detail({ path: viaCheckout }),
      new Set(['service:checkout']),
    );
    expect(n.filter(x => x.data.highlighted).map(x => x.id)).toEqual([
      'service:checkout',
    ]);
  });
});

describe('stepNodes', () => {
  it('matches node keys and whole service names anywhere in the args', () => {
    expect(
      stepNodes(
        {
          where: 'ServiceName:checkout AND level:error',
          targets: [{ node: 'datastore:postgresql:db' }],
        },
        nodes,
      ),
    ).toEqual(new Set(['service:checkout', 'datastore:postgresql:db']));
  });

  it('does not match a name inside a longer word', () => {
    expect(stepNodes({ q: 'cartography-svc frontends' }, nodes)).toEqual(
      new Set(),
    );
  });

  it('returns nothing for args without strings', () => {
    expect(stepNodes({ limit: 10 }, nodes)).toEqual(new Set());
  });
});

describe('filterIncidents', () => {
  const list = [
    incident({ incidentId: 'a', title: 'Checkout errors' }),
    incident({
      incidentId: 'b',
      title: 'Slow search',
      alertingNode: 'service:search',
      rootCauseNode: 'datastore:redis:cache',
    }),
  ];
  it('matches title or service, case insensitively', () => {
    expect(filterIncidents(list, 'CHECKOUT').map(i => i.incidentId)).toEqual([
      'a',
    ]);
    expect(filterIncidents(list, 'redis').map(i => i.incidentId)).toEqual([
      'b',
    ]);
    expect(filterIncidents(list, ' ')).toHaveLength(2);
  });
});

describe('node fill', () => {
  it('fills a node from its callers in the topology, else from the calls it makes', () => {
    const { nodes: n } = flow(detail({ path: viaCheckout }));
    // edge-gateway style entry point: no callers, so the 5% on its outgoing call.
    expect(n.find(x => x.id === 'service:frontend')?.data.errorRate).toBe(5);
    const withTopology = toIncidentFlow(
      detail({ path: viaCheckout }),
      new Set(),
      [
        {
          src: 'service:cart',
          dst: 'service:frontend',
          rel: 'CALLS',
          requestCount: 10,
          errorCount: 5,
          p95Ms: 1,
        },
      ],
    );
    expect(
      withTopology.nodes.find(x => x.id === 'service:frontend')?.data.errorRate,
    ).toBe(50);
  });

  it('puts a background pill behind path edge labels', () => {
    const { edges } = flow(detail({ path: direct }));
    expect(edges[0]).toMatchObject({ labelShowBg: true });
  });
});
