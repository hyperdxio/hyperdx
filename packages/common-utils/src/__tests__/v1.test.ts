import { AggFnV1, convertV1GroupByToV2, mapV1AggFnToV2 } from '@/core/v1';
import { AggregateFunction, TSource } from '@/types';

describe('mapV1AggFnToV2', () => {
  it.each([
    [AggFnV1.avg_rate, 'avg'],
    [AggFnV1.avg, 'avg'],
    [AggFnV1.count_distinct, 'count_distinct'],
    [AggFnV1.count, 'count'],
    [AggFnV1.count_per_sec, 'count'],
    [AggFnV1.count_per_min, 'count'],
    [AggFnV1.count_per_hour, 'count'],
    [AggFnV1.last_value, 'last_value'],
    [AggFnV1.max_rate, 'max'],
    [AggFnV1.max, 'max'],
    [AggFnV1.min_rate, 'min'],
    [AggFnV1.min, 'min'],
    [AggFnV1.p50_rate, 'quantile'],
    [AggFnV1.p50, 'quantile'],
    [AggFnV1.p90_rate, 'quantile'],
    [AggFnV1.p90, 'quantile'],
    [AggFnV1.p95_rate, 'quantile'],
    [AggFnV1.p95, 'quantile'],
    [AggFnV1.p99_rate, 'quantile'],
    [AggFnV1.p99, 'quantile'],
    [AggFnV1.sum_rate, 'sum'],
    [AggFnV1.sum, 'sum'],
  ] satisfies [AggFnV1, AggregateFunction][])(
    'should map %s to %s',
    (input, expected) => {
      expect(mapV1AggFnToV2(input)).toBe(expected);
    },
  );
});

describe('convertV1GroupByToV2', () => {
  const source = {
    resourceAttributesExpression: 'ResourceAttributes',
  } as TSource;

  it('should map k8s group by fields correctly', () => {
    const v1GroupBy = [
      'k8s.cluster.name',
      'k8s.namespace.name',
      'k8s.pod.name',
      'k8s.container.name',
    ];

    const expectedV2GroupBy =
      "ResourceAttributes['k8s.cluster.name'],ResourceAttributes['k8s.namespace.name'],ResourceAttributes['k8s.pod.name'],ResourceAttributes['k8s.container.name']";

    const v2GroupBy = convertV1GroupByToV2(source, v1GroupBy);
    expect(v2GroupBy).toEqual(expectedV2GroupBy);
  });

  it('should not modify non-k8s group by fields', () => {
    const v1GroupBy = ['ServiceName', 'StatusCode'];
    const expectedV2GroupBy = 'ServiceName,StatusCode';
    const v2GroupBy = convertV1GroupByToV2(source, v1GroupBy);
    expect(v2GroupBy).toEqual(expectedV2GroupBy);
  });
});
