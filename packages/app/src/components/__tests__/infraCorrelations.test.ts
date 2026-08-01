import {
  getActiveInfraCorrelations,
  INFRA_CORRELATIONS,
} from '@/components/infraCorrelations';

describe('getActiveInfraCorrelations', () => {
  it('returns the Pod group when only k8s.pod.uid is present', () => {
    const active = getActiveInfraCorrelations({ 'k8s.pod.uid': 'pod-abc' });
    expect(active.map(c => c.title)).toEqual(['Pod']);
  });

  it('returns the Node group when only k8s.node.name is present', () => {
    const active = getActiveInfraCorrelations({ 'k8s.node.name': 'node-1' });
    expect(active.map(c => c.title)).toEqual(['Node']);
  });

  it('returns both groups in render order when both attributes are present', () => {
    const active = getActiveInfraCorrelations({
      'k8s.pod.uid': 'pod-abc',
      'k8s.node.name': 'node-1',
    });
    expect(active.map(c => c.title)).toEqual(['Pod', 'Node']);
  });

  it('returns no groups when no detect attribute is present', () => {
    expect(getActiveInfraCorrelations({})).toEqual([]);
  });

  it('returns no groups for unrelated resource attributes', () => {
    expect(
      getActiveInfraCorrelations({
        'host.name': 'web-1',
        'service.name': 'api',
      }),
    ).toEqual([]);
  });

  it('returns no groups when resource attributes are null or undefined', () => {
    expect(getActiveInfraCorrelations(undefined)).toEqual([]);
    expect(getActiveInfraCorrelations(null)).toEqual([]);
  });

  // The gate uses != null, not truthiness, matching the prior hardcoded gate.
  it('treats a detect attribute explicitly set to null as absent', () => {
    expect(getActiveInfraCorrelations({ 'k8s.pod.uid': null })).toEqual([]);
  });
});

describe('INFRA_CORRELATIONS built-ins', () => {
  it('preserves the Kubernetes Pod and Node correlation identity', () => {
    expect(INFRA_CORRELATIONS).toMatchObject([
      {
        title: 'Pod',
        detectAttribute: 'k8s.pod.uid',
        correlateAttribute: 'k8s.pod.uid',
        fieldPrefix: 'k8s.pod.',
        timeline: { queryAttribute: 'k8s.pod.uid' },
      },
      {
        title: 'Node',
        detectAttribute: 'k8s.node.name',
        correlateAttribute: 'k8s.node.name',
        fieldPrefix: 'k8s.node.',
      },
    ]);
  });

  it('keeps the Pod Timeline only on the Pod group', () => {
    const node = INFRA_CORRELATIONS.find(c => c.title === 'Node');
    expect(node?.timeline).toBeUndefined();
  });

  it('keeps the three k8s metric fields and card test ids on every group', () => {
    for (const correlation of INFRA_CORRELATIONS) {
      expect(correlation.charts.map(c => [c.cardTestId, c.field])).toEqual([
        ['cpu-usage-card', 'cpu.utilization'],
        ['memory-usage-card', 'memory.usage'],
        ['disk-usage-card', 'filesystem.available'],
      ]);
    }
  });
});
