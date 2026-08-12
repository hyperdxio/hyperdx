import type { TMetricSource } from '@hyperdx/common-utils/dist/types';

import {
  getActiveInfraCorrelations,
  getGpuCorrelationWhere,
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

describe('getGpuCorrelationWhere', () => {
  const metricSource = {
    resourceAttributesExpression: 'ResourceAttributes',
  } as unknown as TMetricSource;

  it('returns where clause using k8s.node.name when present', () => {
    const result = getGpuCorrelationWhere(metricSource, {
      'k8s.node.name': 'gpu-node-1',
      'host.name': 'host-1',
    });
    expect(result).toBe('ResourceAttributes.k8s.node.name:"gpu-node-1"');
  });

  it('falls back to host.name when k8s.node.name is absent', () => {
    const result = getGpuCorrelationWhere(metricSource, {
      'host.name': 'gpu-host-1',
    });
    expect(result).toBe('ResourceAttributes.host.name:"gpu-host-1"');
  });

  it('returns undefined when no correlatable attribute is present', () => {
    const result = getGpuCorrelationWhere(metricSource, {
      'service.name': 'api',
      'k8s.pod.uid': 'pod-123',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for null resource attributes', () => {
    expect(getGpuCorrelationWhere(metricSource, null)).toBeUndefined();
    expect(getGpuCorrelationWhere(metricSource, undefined)).toBeUndefined();
  });

  it('skips empty string attribute values', () => {
    const result = getGpuCorrelationWhere(metricSource, {
      'k8s.node.name': '',
      'host.name': 'fallback-host',
    });
    expect(result).toBe('ResourceAttributes.host.name:"fallback-host"');
  });

  it('returns undefined when all correlatable attributes are empty', () => {
    const result = getGpuCorrelationWhere(metricSource, {
      'k8s.node.name': '',
      'host.name': '',
    });
    expect(result).toBeUndefined();
  });
});
