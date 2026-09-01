import React from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

// Mock the clickhouse client
jest.mock('@/clickhouse', () => ({
  useClickhouseClient: jest.fn(),
}));

// Mock useMetadataWithSettings
jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: jest.fn(),
}));

// Mock useSource
jest.mock('@/source', () => ({
  useSource: jest.fn(),
  getDisplayedTimestampValueExpression: jest.fn(() => 'Timestamp'),
  getDurationMsExpression: jest.fn(() => '(Duration)/1e6'),
}));

// Mock the renderChartConfig function
jest.mock('@hyperdx/common-utils/dist/core/renderChartConfig', () => ({
  renderChartConfig: jest.fn(),
}));

import { useClickhouseClient } from '@/clickhouse';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { useSource } from '@/source';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';

import { useTraceTotalDuration } from '@/hooks/useTraceTotalDuration';

const mockTraceSource = {
  id: 'trace-source-1',
  kind: SourceKind.Trace,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  traceIdExpression: 'TraceId',
  durationExpression: 'Duration',
  durationPrecision: 9,
  querySettings: undefined,
};

describe('useTraceTotalDuration', () => {
  let queryClient: QueryClient;
  let wrapper: React.ComponentType<{ children: any }>;
  let mockClickhouseClient: any;
  let mockStream: any;
  let mockReader: any;

  beforeEach(() => {
    jest.clearAllMocks();

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    mockReader = { read: jest.fn() };
    mockStream = { getReader: jest.fn(() => mockReader) };
    mockClickhouseClient = {
      query: jest.fn(() =>
        Promise.resolve({
          json: jest.fn(),
          stream: () => mockStream,
        }),
      ),
    };

    jest
      .mocked(useClickhouseClient)
      .mockReturnValue(mockClickhouseClient as any);
    jest
      .mocked(useMetadataWithSettings)
      .mockReturnValue({ getSetting: jest.fn() } as any);
    jest.mocked(useSource).mockReturnValue({
      data: mockTraceSource,
      isLoading: false,
    } as any);
    jest.mocked(renderChartConfig).mockResolvedValue({
      sql: 'SELECT MIN(Timestamp) AS minTs, MAX(...) AS maxTs, COUNT(*) AS spanCount FROM otel_traces WHERE TraceId = \'abc\'',
      params: {},
    });
  });

  it('returns 0/0 when traceId is undefined (disabled query)', async () => {
    const { result } = renderHook(
      () =>
        useTraceTotalDuration(
          { source: 'trace-source-1' } as any,
          undefined,
          { enabled: true },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(renderChartConfig).not.toHaveBeenCalled();
    expect(mockClickhouseClient.query).not.toHaveBeenCalled();
  });

  it('returns 0/0 when the resolved source is not a trace source', async () => {
    jest.mocked(useSource).mockReturnValue({
      data: { ...mockTraceSource, kind: SourceKind.Log },
      isLoading: false,
    } as any);

    const { result } = renderHook(
      () =>
        useTraceTotalDuration(
          { source: 'trace-source-1' } as any,
          'abc123',
          { enabled: true },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ totalDurationMs: 0, spanCount: 0 });
  });

  it('computes wall-clock span from min(start) to max(start+duration) and passes the escaped traceId in the where clause', async () => {
    mockClickhouseClient.query.mockResolvedValue({
      json: jest.fn().mockResolvedValue([
        {
          minTs: '2024-01-01T00:00:00.000Z',
          maxTs: '2024-01-01T00:00:02.280Z',
          spanCount: '14',
        },
      ]),
    });

    const { result } = renderHook(
      () =>
        useTraceTotalDuration(
          { source: 'trace-source-1', connection: 'conn-1' } as any,
          'abc123',
          { enabled: true },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual({
      totalDurationMs: 2280,
      spanCount: 14,
    });

    expect(renderChartConfig).toHaveBeenCalledTimes(1);
    const [aggConfig] = jest.mocked(renderChartConfig).mock.calls[0];
    expect(aggConfig.where).toBe("TraceId = 'abc123'");
    expect(aggConfig.whereLanguage).toBe('sql');
  });

  it('escapes a traceId containing a single quote before embedding it in the where clause', async () => {
    mockClickhouseClient.query.mockResolvedValue({
      json: jest
        .fn()
        .mockResolvedValue([
          { minTs: '2024-01-01T00:00:00.000Z', maxTs: '2024-01-01T00:00:01.000Z', spanCount: '1' },
        ]),
    });

    renderHook(
      () =>
        useTraceTotalDuration(
          { source: 'trace-source-1' } as any,
          "abc'123",
          { enabled: true },
        ),
      { wrapper },
    );

    await waitFor(() =>
      expect(renderChartConfig).toHaveBeenCalledTimes(1),
    );
    const [aggConfig] = jest.mocked(renderChartConfig).mock.calls[0];
    expect(aggConfig.where).toBe("TraceId = 'abc\\'123'");
  });

  it('returns 0/0 when the query returns no rows', async () => {
    mockClickhouseClient.query.mockResolvedValue({
      json: jest.fn().mockResolvedValue([]),
    });

    const { result } = renderHook(
      () =>
        useTraceTotalDuration(
          { source: 'trace-source-1' } as any,
          'abc123',
          { enabled: true },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ totalDurationMs: 0, spanCount: 0 });
  });

  it('does not query while enabled is false', async () => {
    const { result } = renderHook(
      () =>
        useTraceTotalDuration(
          { source: 'trace-source-1' } as any,
          'abc123',
          { enabled: false },
        ),
      { wrapper },
    );

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(result.current.isLoading).toBe(false);
    expect(mockClickhouseClient.query).not.toHaveBeenCalled();
  });
});