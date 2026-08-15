import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import {
  getActiveInfraCorrelations,
  INFRA_CORRELATIONS,
} from '@/components/infraCorrelations';

describe('getActiveInfraCorrelations', () => {
  it('returns the Pod group when only k8s.pod.uid is present', () => {
    const active = getActiveInfraCorrelations({ 'k8s.pod.uid': 'pod-abc' });
    expect(active.map(c => c.title)).toEqual(['Pod']);
  });

  it('returns the Node and GPU groups when only k8s.node.name is present', () => {
    const active = getActiveInfraCorrelations({ 'k8s.node.name': 'node-1' });
    expect(active.map(c => c.title)).toEqual(['Node', 'GPU']);
  });

  it('returns Pod, Node, and GPU when both attributes are present', () => {
    const active = getActiveInfraCorrelations({
      'k8s.pod.uid': 'pod-abc',
      'k8s.node.name': 'node-1',
    });
    expect(active.map(c => c.title)).toEqual(['Pod', 'Node', 'GPU']);
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
      {
        title: 'GPU',
        detectAttribute: 'k8s.node.name',
        correlateAttribute: 'k8s.node.name',
        fieldPrefix: 'hw.gpu.',
        requiresMetricAvailability: true,
      },
    ]);
  });

  it('gates only the GPU group on metric availability', () => {
    for (const correlation of INFRA_CORRELATIONS) {
      expect(!!correlation.requiresMetricAvailability).toBe(
        correlation.title === 'GPU',
      );
    }
  });

  it('keeps the Pod Timeline only on the Pod group', () => {
    expect(
      INFRA_CORRELATIONS.filter(c => c.timeline != null).map(c => c.title),
    ).toEqual(['Pod']);
  });

  it('keeps the three k8s metric fields on Pod and Node groups', () => {
    for (const correlation of INFRA_CORRELATIONS.filter(
      c => c.title === 'Pod' || c.title === 'Node',
    )) {
      expect(correlation.charts.map(c => [c.cardTestId, c.field])).toEqual([
        ['cpu-usage-card', 'cpu.utilization'],
        ['memory-usage-card', 'memory.usage'],
        ['disk-usage-card', 'filesystem.available'],
      ]);
    }
  });

  it('produces the expected fully-qualified metric names per group', () => {
    const names = INFRA_CORRELATIONS.map(c => ({
      title: c.title,
      metrics: c.charts.map(chart => `${c.fieldPrefix}${chart.field}`),
    }));
    expect(names).toEqual([
      {
        title: 'Pod',
        metrics: [
          'k8s.pod.cpu.utilization',
          'k8s.pod.memory.usage',
          'k8s.pod.filesystem.available',
        ],
      },
      {
        title: 'Node',
        metrics: [
          'k8s.node.cpu.utilization',
          'k8s.node.memory.usage',
          'k8s.node.filesystem.available',
        ],
      },
      {
        title: 'GPU',
        metrics: ['hw.gpu.utilization', 'hw.gpu.memory.utilization'],
      },
    ]);
  });
});

describe('GPU chart specs', () => {
  const gpuCorrelation = INFRA_CORRELATIONS.find(c => c.title === 'GPU')!;

  it('defines utilization and memory utilization charts', () => {
    expect(gpuCorrelation.charts.map(c => c.cardTestId)).toEqual([
      'gpu-utilization-card',
      'gpu-memory-utilization-card',
    ]);
  });

  it('uses field:* for the task existence check, not _exists_', () => {
    const utilizationChart = gpuCorrelation.charts.find(
      c => c.cardTestId === 'gpu-utilization-card',
    );
    expect(utilizationChart?.where).toBe(
      'hw.gpu.task:"general" OR NOT hw.gpu.task:*',
    );
  });

  it('does not filter the memory chart on hw.gpu.task', () => {
    const memChart = gpuCorrelation.charts.find(
      c => c.cardTestId === 'gpu-memory-utilization-card',
    );
    expect(memChart?.where).toBeUndefined();
  });

  it('includes hw.id/hw.name/hw.model in the groupBy expression', () => {
    for (const chart of gpuCorrelation.charts) {
      expect(chart.groupBy).toHaveLength(1);
      const expr = chart.groupBy![0];
      expect(expr).toContain("Attributes['hw.id']");
      expect(expr).toContain("Attributes['hw.name']");
      expect(expr).toContain("Attributes['hw.model']");
    }
  });

  it('reads GPU metrics from the gauge table', () => {
    for (const chart of gpuCorrelation.charts) {
      expect(chart.metricType ?? MetricsDataType.Gauge).toBe(
        MetricsDataType.Gauge,
      );
    }
  });
});
