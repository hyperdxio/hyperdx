import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { metricTableConnections } from '@/utils/metricTableConnections';

const metricSource = {
  id: 'metrics',
  kind: SourceKind.Metric,
  name: 'Metrics',
  connection: 'conn',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  metricTables: {
    gauge: 'otel_metrics_gauge',
    sum: 'otel_metrics_sum',
  },
  resourceAttributesExpression: 'ResourceAttributes',
} as unknown as TSource;

const logSource = {
  id: 'logs',
  kind: SourceKind.Log,
  name: 'Logs',
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
} as unknown as TSource;

describe('metricTableConnections', () => {
  it('resolves one connection per series, carrying the metric name', () => {
    expect(
      metricTableConnections(metricSource, [
        { metricType: 'gauge', metricName: 'k8s.pod.cpu' },
        { metricType: 'sum', metricName: 'http.requests' },
      ]),
    ).toEqual([
      {
        databaseName: 'default',
        tableName: 'otel_metrics_gauge',
        connectionId: 'conn',
        metricName: 'k8s.pod.cpu',
      },
      {
        databaseName: 'default',
        tableName: 'otel_metrics_sum',
        connectionId: 'conn',
        metricName: 'http.requests',
      },
    ]);
  });

  it('dedupes series that resolve to the same table and metric', () => {
    const connections = metricTableConnections(metricSource, [
      { metricType: 'gauge', metricName: 'k8s.pod.cpu' },
      { metricType: 'gauge', metricName: 'k8s.pod.cpu' },
    ]);

    expect(connections).toHaveLength(1);
  });

  it('skips series with no metric picked yet', () => {
    expect(
      metricTableConnections(metricSource, [
        { metricType: 'gauge' },
        { metricName: 'k8s.pod.cpu' },
        {},
      ]),
    ).toEqual([]);
  });

  it('skips a metric type the source has no table for', () => {
    expect(
      metricTableConnections(metricSource, [
        { metricType: 'histogram', metricName: 'http.duration' },
      ]),
    ).toEqual([]);
  });

  it('returns nothing for a non-metric source, so callers fall back', () => {
    expect(
      metricTableConnections(logSource, [
        { metricType: 'gauge', metricName: 'k8s.pod.cpu' },
      ]),
    ).toEqual([]);
  });

  it('returns nothing when there is no source or no series', () => {
    expect(metricTableConnections(undefined, [])).toEqual([]);
    expect(metricTableConnections(metricSource, undefined)).toEqual([]);
  });
});
