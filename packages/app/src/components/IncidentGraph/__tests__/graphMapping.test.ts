import { toFlowElements } from '@/components/IncidentGraph/graphMapping';
import type {
  IncidentGraphResponse,
  KgIncident,
} from '@/components/IncidentGraph/types';

const incident = (id: string, o: Partial<KgIncident> = {}): KgIncident => ({
  incidentId: id,
  title: `Incident ${id}`,
  status: 'resolved',
  confirmed: true,
  confirmedBy: 'jordan',
  alertingNode: 'service:checkout',
  rootCauseNode: 'datastore:postgresql:db',
  rootCause: 'Pool exhausted',
  resolution: 'Raised the pool size',
  openedAt: '2026-10-26 01:00:00.000',
  resolvedAt: '2026-10-26 02:00:00.000',
  ...o,
});

const data: IncidentGraphResponse = {
  nodes: [
    { key: 'service:frontend', kind: 'service', label: 'frontend' },
    { key: 'service:checkout', kind: 'service', label: 'checkout' },
    {
      key: 'datastore:postgresql:db',
      kind: 'datastore',
      label: 'postgresql:db',
    },
    { key: 'incident:a', kind: 'incident', label: 'Incident a' },
    { key: 'incident:b', kind: 'incident', label: 'Incident b' },
  ],
  edges: [
    {
      src: 'service:frontend',
      dst: 'service:checkout',
      rel: 'CALLS',
      requestCount: 100,
      errorCount: 10,
      p95Ms: 50,
    },
    {
      src: 'service:checkout',
      dst: 'datastore:postgresql:db',
      rel: 'CALLS',
      requestCount: 50,
      errorCount: 0,
      p95Ms: 5,
    },
    { src: 'incident:a', dst: 'service:checkout', rel: 'ALERTED_ON' },
    { src: 'incident:a', dst: 'datastore:postgresql:db', rel: 'ROOT_CAUSE_AT' },
    { src: 'incident:b', dst: 'service:checkout', rel: 'ALERTED_ON' },
  ],
  incidents: [
    incident('a'),
    incident('b', { status: 'open', confirmed: false, rootCauseNode: '' }),
  ],
};

const all = { showIncidents: true, confirmedOnly: false };

describe('toFlowElements', () => {
  it('maps topology and incident nodes with incoming error rates', () => {
    const { nodes } = toFlowElements(data, all);
    expect(nodes.map(n => [n.id, n.type])).toEqual([
      ['service:frontend', 'topology'],
      ['service:checkout', 'topology'],
      ['datastore:postgresql:db', 'topology'],
      ['incident:a', 'incident'],
      ['incident:b', 'incident'],
    ]);
    const rates = Object.fromEntries(
      nodes
        .filter(n => n.type === 'topology')
        .map(n => [n.id, n.data.errorRate]),
    );
    expect(rates).toEqual({
      'service:frontend': null,
      'service:checkout': 10,
      'datastore:postgresql:db': 0,
    });
  });

  it('draws a dashed alerting edge and a highlighted root cause edge', () => {
    const { edges } = toFlowElements(data, all);
    const alerted = edges.find(
      e => e.id === 'incident:a-ALERTED_ON->service:checkout',
    );
    const rootCause = edges.find(
      e => e.id === 'incident:a-ROOT_CAUSE_AT->datastore:postgresql:db',
    );
    expect(alerted?.style?.strokeDasharray).toBeDefined();
    expect(rootCause?.style?.strokeDasharray).toBeUndefined();
    expect(rootCause?.label).toBe('Root cause');
    expect(edges.filter(e => e.animated)).toHaveLength(2);
  });

  it('drops unconfirmed incidents and their edges when confirmed only', () => {
    const { nodes, edges } = toFlowElements(data, {
      ...all,
      confirmedOnly: true,
    });
    expect(nodes.some(n => n.id === 'incident:b')).toBe(false);
    expect(edges.some(e => e.source === 'incident:b')).toBe(false);
    expect(edges.some(e => e.source === 'incident:a')).toBe(true);
  });

  it('hides every incident when incidents are off', () => {
    const { nodes, edges } = toFlowElements(data, {
      ...all,
      showIncidents: false,
    });
    expect(nodes.every(n => n.type === 'topology')).toBe(true);
    expect(edges.every(e => !e.source.startsWith('incident:'))).toBe(true);
  });

  it('highlights the incidents touching the selected node', () => {
    const { nodes } = toFlowElements(data, {
      ...all,
      selectedService: 'datastore:postgresql:db',
    });
    const highlighted = nodes.filter(n => n.data.highlighted).map(n => n.id);
    expect(highlighted).toEqual(['datastore:postgresql:db', 'incident:a']);
  });
});
