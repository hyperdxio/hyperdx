import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { translateMetricGroupFilters } from '@/utils/metricPivot';

const metricSource = {
  id: 'metrics',
  kind: SourceKind.Metric,
  name: 'Metrics',
  connection: 'conn',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  metricTables: { gauge: 'otel_metrics_gauge' },
  resourceAttributesExpression: 'ResourceAttributes',
} as unknown as TSource;

const logSource = {
  id: 'logs',
  kind: SourceKind.Log,
  name: 'Logs',
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  resourceAttributesExpression: 'ResourceAttributes',
} as unknown as TSource;

describe('translateMetricGroupFilters', () => {
  it('carries a resource attribute across to the target source', () => {
    const { filters, droppedColumns } = translateMetricGroupFilters({
      groupFilters: [
        {
          column: "ResourceAttributes['k8s.pod.name']",
          value: 'payment-7d9f4',
        },
      ],
      metricSource,
      targetSource: logSource,
    });

    expect(filters).toEqual([
      { column: "ResourceAttributes['k8s.pod.name']", value: 'payment-7d9f4' },
    ]);
    expect(droppedColumns).toEqual([]);
  });

  it('rewrites the map expression when the two sources name it differently', () => {
    const { filters } = translateMetricGroupFilters({
      groupFilters: [
        { column: "ResourceAttributes['service.name']", value: 'checkout' },
      ],
      metricSource,
      targetSource: {
        ...logSource,
        resourceAttributesExpression: 'resource_attributes',
      } as TSource,
    });

    expect(filters).toEqual([
      { column: "resource_attributes['service.name']", value: 'checkout' },
    ]);
  });

  it('drops a metric data-point attribute rather than guessing a counterpart', () => {
    const { filters, droppedColumns } = translateMetricGroupFilters({
      groupFilters: [
        { column: "Attributes['http.route']", value: '/checkout' },
        { column: "ResourceAttributes['service.name']", value: 'checkout' },
      ],
      metricSource,
      targetSource: logSource,
    });

    expect(filters).toEqual([
      { column: "ResourceAttributes['service.name']", value: 'checkout' },
    ]);
    expect(droppedColumns).toEqual(["Attributes['http.route']"]);
  });

  it('drops a bare column, which has no key to re-address', () => {
    const { filters, droppedColumns } = translateMetricGroupFilters({
      groupFilters: [{ column: 'ServiceName', value: 'checkout' }],
      metricSource,
      targetSource: logSource,
    });

    expect(filters).toEqual([]);
    expect(droppedColumns).toEqual(['ServiceName']);
  });

  it('drops everything when the target declares no resource attributes', () => {
    const { filters, droppedColumns } = translateMetricGroupFilters({
      groupFilters: [
        { column: "ResourceAttributes['service.name']", value: 'checkout' },
      ],
      metricSource,
      targetSource: {
        ...logSource,
        resourceAttributesExpression: undefined,
      } as TSource,
    });

    expect(filters).toEqual([]);
    expect(droppedColumns).toEqual(["ResourceAttributes['service.name']"]);
  });

  it('drops everything when there is no target source at all', () => {
    const { filters, droppedColumns } = translateMetricGroupFilters({
      groupFilters: [
        { column: "ResourceAttributes['service.name']", value: 'checkout' },
      ],
      metricSource,
      targetSource: undefined,
    });

    expect(filters).toEqual([]);
    expect(droppedColumns).toEqual(["ResourceAttributes['service.name']"]);
  });

  it('skips a series whose group value is null', () => {
    const { filters, droppedColumns } = translateMetricGroupFilters({
      groupFilters: [
        { column: "ResourceAttributes['service.name']", value: null },
      ],
      metricSource,
      targetSource: logSource,
    });

    expect(filters).toEqual([]);
    expect(droppedColumns).toEqual([]);
  });

  it('tolerates whitespace and double-quoted keys', () => {
    const { filters } = translateMetricGroupFilters({
      groupFilters: [
        { column: '  ResourceAttributes [ "host.name" ] ', value: 'node-1' },
      ],
      metricSource,
      targetSource: logSource,
    });

    expect(filters).toEqual([
      { column: 'ResourceAttributes["host.name"]', value: 'node-1' },
    ]);
  });

  it('returns empty for no group filters', () => {
    expect(
      translateMetricGroupFilters({
        groupFilters: undefined,
        metricSource,
        targetSource: logSource,
      }),
    ).toEqual({ filters: [], droppedColumns: [] });
  });
});
