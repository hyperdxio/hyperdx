import {
  getActiveInfraCorrelations,
  INFRA_CORRELATIONS,
} from '@/components/infraCorrelations';
import type { GpuMetricsAvailability } from '@/hooks/useGpuMetricsAvailability';
import { resolveChartAvailability } from '@/hooks/useGpuMetricsAvailability';

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

  it('keeps the Pod Timeline only on the Pod group', () => {
    const node = INFRA_CORRELATIONS.find(c => c.title === 'Node');
    expect(node?.timeline).toBeUndefined();
    const gpu = INFRA_CORRELATIONS.find(c => c.title === 'GPU');
    expect(gpu?.timeline).toBeUndefined();
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
});

describe('GPU chart specs', () => {
  const gpuCorrelation = INFRA_CORRELATIONS.find(c => c.title === 'GPU')!;

  it('defines utilization and memory utilization charts', () => {
    expect(gpuCorrelation.charts.map(c => c.cardTestId)).toEqual([
      'gpu-utilization-card',
      'gpu-memory-utilization-card',
    ]);
  });

  it('uses correct where clause for utilization (no _exists_ syntax)', () => {
    const utilizationChart = gpuCorrelation.charts.find(
      c => c.cardTestId === 'gpu-utilization-card',
    );
    expect(utilizationChart?.where).toBe(
      'hw.gpu.task:"general" OR NOT hw.gpu.task:*',
    );
  });

  it('provides a fallback for memory utilization from sum table', () => {
    const memChart = gpuCorrelation.charts.find(
      c => c.cardTestId === 'gpu-memory-utilization-card',
    );
    expect(memChart?.fallback).toEqual({
      fields: ['memory.usage', 'memory.limit'],
      metricType: 'Sum',
      numberFormat: expect.objectContaining({ output: 'percent' }),
    });
  });

  it('includes hw.id/hw.name/hw.model in groupBy expression', () => {
    for (const chart of gpuCorrelation.charts) {
      expect(chart.groupBy).toHaveLength(1);
      const expr = chart.groupBy![0];
      expect(expr).toContain("Attributes['hw.id']");
      expect(expr).toContain("Attributes['hw.name']");
      expect(expr).toContain("Attributes['hw.model']");
    }
  });
});

describe('resolveChartAvailability', () => {
  const fieldPrefix = 'hw.gpu.';

  const makeAvailability = (
    gauge: string[] = [],
    sum: string[] = [],
  ): GpuMetricsAvailability => ({
    gaugeMetrics: new Set(gauge),
    sumMetrics: new Set(sum),
    hasAny: gauge.length > 0 || sum.length > 0,
    isLoading: false,
  });

  it('returns primary when gauge metric exists', () => {
    const chart = { field: 'utilization' };
    const availability = makeAvailability(['hw.gpu.utilization']);
    expect(resolveChartAvailability(fieldPrefix, chart, availability)).toBe(
      'primary',
    );
  });

  it('returns none when neither primary nor fallback exists', () => {
    const chart = { field: 'utilization' };
    const availability = makeAvailability();
    expect(resolveChartAvailability(fieldPrefix, chart, availability)).toBe(
      'none',
    );
  });

  it('returns fallback when primary is absent but fallback fields exist in sum', () => {
    const chart = {
      field: 'memory.utilization',
      fallback: {
        fields: ['memory.usage', 'memory.limit'] as [string, string],
        metricType: 'Sum' as const,
        numberFormat: { output: 'percent' as const },
      },
    };
    const availability = makeAvailability(
      [],
      ['hw.gpu.memory.usage', 'hw.gpu.memory.limit'],
    );
    expect(resolveChartAvailability(fieldPrefix, chart, availability)).toBe(
      'fallback',
    );
  });

  it('prefers primary over fallback even if both exist', () => {
    const chart = {
      field: 'memory.utilization',
      fallback: {
        fields: ['memory.usage', 'memory.limit'] as [string, string],
        metricType: 'Sum' as const,
        numberFormat: { output: 'percent' as const },
      },
    };
    const availability = makeAvailability(
      ['hw.gpu.memory.utilization'],
      ['hw.gpu.memory.usage', 'hw.gpu.memory.limit'],
    );
    expect(resolveChartAvailability(fieldPrefix, chart, availability)).toBe(
      'primary',
    );
  });

  it('returns none when only one fallback field exists', () => {
    const chart = {
      field: 'memory.utilization',
      fallback: {
        fields: ['memory.usage', 'memory.limit'] as [string, string],
        metricType: 'Sum' as const,
        numberFormat: { output: 'percent' as const },
      },
    };
    const availability = makeAvailability([], ['hw.gpu.memory.usage']);
    expect(resolveChartAvailability(fieldPrefix, chart, availability)).toBe(
      'none',
    );
  });

  it('handles Sum primary metric type', () => {
    const chart = { field: 'some.counter', metricType: 'Sum' as const };
    const availability = makeAvailability([], ['hw.gpu.some.counter']);
    expect(resolveChartAvailability(fieldPrefix, chart, availability)).toBe(
      'primary',
    );
  });
});
