import {
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import { useAvailableMetricNames } from '@/hooks/useAvailableMetricNames';
import { useGetKeyValues } from '@/hooks/useMetadata';

jest.mock('@/hooks/useMetadata');

const mockUseGetKeyValues = useGetKeyValues as jest.MockedFunction<
  typeof useGetKeyValues
>;

const METRIC_SOURCE = {
  id: 'metric-source-1',
  kind: 'metric',
  name: 'Metrics',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: { [MetricsDataType.Gauge]: 'otel_metrics_gauge' },
} as unknown as TMetricSource;

const DATE_RANGE: [Date, Date] = [
  new Date('2024-01-01T00:00:00Z'),
  new Date('2024-01-03T00:00:00Z'),
];

const METRIC_NAMES = ['hw.gpu.utilization', 'hw.gpu.memory.utilization'];

function mockQuery(overrides: Record<string, unknown>) {
  mockUseGetKeyValues.mockReturnValue({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
    ...overrides,
  } as unknown as ReturnType<typeof useGetKeyValues>);
}

function render() {
  return renderHook(() =>
    useAvailableMetricNames({
      metricSource: METRIC_SOURCE,
      correlationWhere: 'ResourceAttributes.k8s.node.name:"node-1"',
      metricNames: METRIC_NAMES,
      dateRange: DATE_RANGE,
    }),
  );
}

describe('useAvailableMetricNames', () => {
  afterEach(() => jest.resetAllMocks());

  it('reports the metric names the query returned', () => {
    mockQuery({ data: [{ key: 'MetricName', value: METRIC_NAMES }] });
    const { result } = render();
    expect([...result.current.availableMetrics].sort()).toEqual(
      [...METRIC_NAMES].sort(),
    );
    expect(result.current.isLoading).toBe(false);
  });

  it('reports loading while the first query is in flight', () => {
    mockQuery({ isLoading: true });
    expect(render().result.current.isLoading).toBe(true);
  });

  // useGetKeyValues sets `placeholderData: keepPreviousData`, so switching to a
  // different correlated resource keeps the previous one's answer readable with
  // `isLoading` false. Reporting that as settled would leak one host's chart
  // set onto the next.
  it('reports loading while showing another resource placeholder data', () => {
    mockQuery({
      data: [{ key: 'MetricName', value: METRIC_NAMES }],
      isLoading: false,
      isPlaceholderData: true,
    });
    const { result } = render();
    expect(result.current.isLoading).toBe(true);
  });

  it('returns an empty set when the query has no data', () => {
    mockQuery({ data: undefined });
    expect(render().result.current.availableMetrics.size).toBe(0);
  });
});
