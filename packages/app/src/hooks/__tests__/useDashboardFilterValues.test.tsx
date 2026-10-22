import React from 'react';
import {
  DashboardFilter,
  PromqlLabelDashboardFilter,
  SourceKind,
  StaticListDashboardFilter,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useDashboardFilterValues } from '@/hooks/useDashboardFilterValues';

const mockGetKeyValues = jest.fn();
const mockLabelValues = jest.fn();
let mockSourcesData: Partial<TSource>[];

// Only the PromQL client is stubbed; the rest of the module stays real,
// since the ClickHouse client below reads `api.useMe` from it.
jest.mock('@/api', () => ({
  __esModule: true,
  ...jest.requireActual('@/api'),
  prometheusApi: {
    labelValues: (...args: unknown[]) => mockLabelValues(...args),
  },
}));

// Untyped factories, so partial mocks need no unsafe type assertions.
jest.mock('@/source', () => ({
  useSources: () => ({ data: mockSourcesData, isLoading: false }),
}));
jest.mock('../useMetadata', () => ({
  useMetadataWithSettings: () => ({ getKeyValues: mockGetKeyValues }),
}));
jest.mock('@hyperdx/common-utils/dist/core/materializedViews', () => ({
  optimizeGetKeyValuesCalls: jest
    .fn()
    .mockImplementation(async ({ keys, chartConfig }) => [
      { keys, chartConfig },
    ]),
  optimizeFacetedKeyValuesConfig: jest
    .fn()
    .mockImplementation(async ({ chartConfig }) => chartConfig),
}));

describe('useDashboardFilterValues', () => {
  let queryClient: QueryClient;
  let wrapper: React.ComponentType<{ children: React.ReactNode }>;

  // Deliberately not alphabetical: options must keep definition order.
  const staticFilter: StaticListDashboardFilter = {
    id: 'static1',
    type: 'STATIC_LIST',
    name: 'Tier',
    options: ['low', 'medium', 'high'],
    isBroadcastEnabled: false,
    isVariableEnabled: true,
    variableName: 'tier',
  };

  const promqlFilter: PromqlLabelDashboardFilter = {
    id: 'promql1',
    type: 'PROMETHEUS_LABEL',
    name: 'Job',
    source: 'promql-source',
    label: 'job',
    isBroadcastEnabled: false,
    isVariableEnabled: true,
    variableName: 'job',
  };

  const queriedFilter: DashboardFilter = {
    id: 'queried1',
    type: 'QUERY_EXPRESSION',
    name: 'Environment',
    expression: 'environment',
    source: 'logs-source',
  };

  const mockDateRange: [Date, Date] = [
    new Date('2024-01-01'),
    new Date('2024-01-02'),
  ];

  beforeEach(() => {
    mockSourcesData = [
      {
        id: 'logs-source',
        kind: SourceKind.Log,
        name: 'Logs',
        timestampValueExpression: 'timestamp',
        connection: 'clickhouse-conn',
        from: {
          databaseName: 'telemetry',
          tableName: 'logs',
        },
      },
      {
        id: 'promql-source',
        kind: SourceKind.Promql,
        name: 'Prometheus',
        connection: 'clickhouse-conn',
        from: { databaseName: 'telemetry', tableName: 'metrics' },
      },
    ];
    mockLabelValues.mockReset();
    mockLabelValues.mockResolvedValue({ status: 'success', data: ['api'] });
    mockGetKeyValues.mockReset();
    mockGetKeyValues.mockImplementation(({ keys }: { keys: string[] }) =>
      Promise.resolve(
        keys.map(key => ({ key, value: ['production', 'staging'] })),
      ),
    );

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  });

  it('returns static options in definition order without loading or fetching', () => {
    const { result } = renderHook(
      () =>
        useDashboardFilterValues({
          filters: [staticFilter],
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Static values resolve synchronously, and the queried hook's perpetual
    // "loading" for an empty filter list must not leak through.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual(
      new Map([
        ['static1', { values: ['low', 'medium', 'high'], isLoading: false }],
      ]),
    );
    expect(mockGetKeyValues).not.toHaveBeenCalled();
  });

  it('merges static and queried values keyed by filter id', async () => {
    const { result } = renderHook(
      () =>
        useDashboardFilterValues({
          filters: [staticFilter, queriedFilter],
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.data).toEqual(
      new Map([
        ['queried1', { values: ['production', 'staging'], isLoading: false }],
        ['static1', { values: ['low', 'medium', 'high'], isLoading: false }],
      ]),
    );
  });

  it('merges PromQL label values into the same map', async () => {
    const { result } = renderHook(
      () =>
        useDashboardFilterValues({
          filters: [staticFilter, queriedFilter, promqlFilter],
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.data.get('promql1')).toEqual({
      values: ['api'],
      isLoading: false,
    });
    expect(result.current.isError).toBe(false);
  });

  it('surfaces a PromQL label error without implicating the other filters', async () => {
    mockLabelValues.mockRejectedValue(new Error('connection refused'));

    const { result } = renderHook(
      () =>
        useDashboardFilterValues({
          filters: [staticFilter, queriedFilter, promqlFilter],
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.erroredFilterIds).toEqual(new Set(['promql1']));
    expect(result.current.filterErrorMessages.get('promql1')).toBe(
      'connection refused',
    );
  });

  it('surfaces queried errors without implicating static filters', async () => {
    mockGetKeyValues.mockRejectedValue(new Error('query failed'));

    const { result } = renderHook(
      () =>
        useDashboardFilterValues({
          filters: [staticFilter, queriedFilter],
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.erroredFilterIds).toEqual(new Set(['queried1']));
    expect(result.current.data.get('static1')).toEqual({
      values: ['low', 'medium', 'high'],
      isLoading: false,
    });
  });
});
