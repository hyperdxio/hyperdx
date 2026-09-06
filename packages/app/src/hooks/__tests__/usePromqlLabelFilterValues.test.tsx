import React from 'react';
import {
  ChartVariable,
  PromqlLabelDashboardFilter,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { usePromqlLabelFilterValues } from '@/hooks/usePromqlLabelFilterValues';

const mockLabelValues = jest.fn();
let mockSourcesData: Partial<TSource>[];

jest.mock('@/api', () => ({
  prometheusApi: {
    labelValues: (...args: unknown[]) => mockLabelValues(...args),
  },
}));
jest.mock('@/source', () => ({
  useSources: () => ({ data: mockSourcesData, isLoading: false }),
}));

const filter = (
  overrides: Partial<PromqlLabelDashboardFilter> = {},
): PromqlLabelDashboardFilter => ({
  id: 'promql1',
  type: 'PROMETHEUS_LABEL',
  name: 'Job',
  source: 'promql-source',
  label: 'job',
  isBroadcastEnabled: false,
  isVariableEnabled: true,
  ...overrides,
});

// 2024-01-01T00:00:00Z .. 2024-01-02T00:00:00Z
const DATE_RANGE: [Date, Date] = [
  new Date('2024-01-01T00:00:00Z'),
  new Date('2024-01-02T00:00:00Z'),
];

describe('usePromqlLabelFilterValues', () => {
  let wrapper: React.ComponentType<{ children: React.ReactNode }>;

  const renderFilters = (
    filters: PromqlLabelDashboardFilter[],
    variables?: ChartVariable[],
  ) =>
    renderHook(
      () =>
        usePromqlLabelFilterValues({
          filters,
          dateRange: DATE_RANGE,
          variables,
        }),
      { wrapper },
    );

  beforeEach(() => {
    mockSourcesData = [
      {
        id: 'promql-source',
        kind: SourceKind.Promql,
        name: 'Prometheus',
        connection: 'clickhouse-conn',
        from: { databaseName: 'telemetry', tableName: 'metrics' },
      },
      {
        id: 'logs-source',
        kind: SourceKind.Log,
        name: 'Logs',
        connection: 'clickhouse-conn',
        from: { databaseName: 'telemetry', tableName: 'logs' },
      },
    ];
    mockLabelValues.mockReset();
    mockLabelValues.mockResolvedValue({
      status: 'success',
      data: ['api', 'web'],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  });

  it('queries the filter source with the date range in whole seconds', async () => {
    const { result } = renderFilters([filter()]);

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockLabelValues).toHaveBeenCalledTimes(1);
    expect(mockLabelValues).toHaveBeenCalledWith({
      label: 'job',
      connectionId: 'clickhouse-conn',
      database: 'telemetry',
      table: 'metrics',
      start: 1704067200,
      end: 1704153600,
    });
    expect(result.current.data.get('promql1')).toEqual({
      values: ['api', 'web'],
      isLoading: false,
    });
    expect(result.current.isError).toBe(false);
  });

  it('resolves two filters over the same source and label in one call', async () => {
    const { result } = renderFilters([
      filter(),
      filter({ id: 'promql2', name: 'Job copy' }),
    ]);

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockLabelValues).toHaveBeenCalledTimes(1);
    expect(result.current.data.get('promql2')).toEqual({
      values: ['api', 'web'],
      isLoading: false,
    });
  });

  it('queries separately for a different label on the same source', async () => {
    const { result } = renderFilters([
      filter(),
      filter({ id: 'promql2', label: 'instance' }),
    ]);

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockLabelValues).toHaveBeenCalledTimes(2);
    expect(mockLabelValues).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'instance' }),
    );
  });

  it('marks a filter errored, but interactive, when the lookup fails', async () => {
    mockLabelValues.mockRejectedValue(new Error('connection refused'));

    const { result } = renderFilters([filter()]);

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.erroredFilterIds).toEqual(new Set(['promql1']));
    expect(result.current.filterErrorMessages.get('promql1')).toBe(
      'connection refused',
    );
    expect(result.current.data.get('promql1')).toEqual({
      values: [],
      isLoading: false,
    });
  });

  it('surfaces an error response body as the filter error', async () => {
    mockLabelValues.mockResolvedValue({
      status: 'error',
      error: 'bad_data: invalid label',
    });

    const { result } = renderFilters([filter()]);

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.filterErrorMessages.get('promql1')).toBe(
      'bad_data: invalid label',
    );
  });

  it('errors a filter whose source is missing or is not a PromQL source', async () => {
    const { result } = renderFilters([
      filter({ id: 'missing', source: 'gone' }),
      filter({ id: 'wrong-kind', source: 'logs-source' }),
    ]);

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockLabelValues).not.toHaveBeenCalled();
    expect(result.current.erroredFilterIds).toEqual(
      new Set(['missing', 'wrong-kind']),
    );
    expect(result.current.data.get('missing')).toEqual({
      values: [],
      isLoading: false,
    });
  });

  it('sends the selector under match', async () => {
    const { result } = renderFilters([filter({ match: 'up{job="api"}' })]);

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockLabelValues).toHaveBeenCalledWith(
      expect.objectContaining({ match: 'up{job="api"}' }),
    );
  });

  it('expands the dashboard variables a selector references', async () => {
    const { result } = renderFilters(
      [filter({ match: 'up{service=~"$svc"}' })],
      [{ name: 'svc', expression: 'ServiceName', values: ['api', 'web'] }],
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockLabelValues).toHaveBeenCalledWith(
      expect.objectContaining({ match: 'up{service=~"(api|web)"}' }),
    );
  });

  it('queries separately for two filters differing only in their selector', async () => {
    const { result } = renderFilters([
      filter({ match: 'up{job="api"}' }),
      filter({ id: 'promql2', match: 'up{job="web"}' }),
    ]);

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockLabelValues).toHaveBeenCalledTimes(2);
  });

  it('errors a filter whose selector cannot be expanded, without querying', async () => {
    const { result } = renderFilters(
      [filter({ match: 'up{service=~"${svc:bogus}"}' })],
      [{ name: 'svc', expression: 'ServiceName', values: ['api'] }],
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockLabelValues).not.toHaveBeenCalled();
    expect(result.current.erroredFilterIds).toEqual(new Set(['promql1']));
    expect(result.current.filterErrorMessages.get('promql1')).toMatch(
      /Unknown variable format 'bogus'/,
    );
    expect(result.current.data.get('promql1')).toEqual({
      values: [],
      isLoading: false,
    });
  });

  it('reuses the last values as placeholders when the date range moves', async () => {
    const { result, rerender } = renderHook(
      ({ dateRange }: { dateRange: [Date, Date] }) =>
        usePromqlLabelFilterValues({ filters: [filter()], dateRange }),
      { wrapper, initialProps: { dateRange: DATE_RANGE } },
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    mockLabelValues.mockResolvedValue({ status: 'success', data: ['api'] });
    rerender({
      dateRange: [
        new Date('2024-01-01T06:00:00Z'),
        new Date('2024-01-02T06:00:00Z'),
      ],
    });

    expect(result.current.data.get('promql1')?.values).toEqual(['api', 'web']);

    await waitFor(() =>
      expect(result.current.data.get('promql1')?.values).toEqual(['api']),
    );
  });
});
