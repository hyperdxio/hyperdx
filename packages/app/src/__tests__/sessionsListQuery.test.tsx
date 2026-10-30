import { ReactNode } from 'react';
import {
  SourceKind,
  TSessionSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useSessions } from '@/sessions';

jest.mock('@hyperdx/common-utils/dist/core/renderChartConfig', () => ({
  renderChartConfig: jest.fn(async (config: unknown) => ({
    sql: JSON.stringify(config),
    params: {},
  })),
}));

const mockQuery = jest.fn(
  async ({ format }: { query: string; format?: string }) => ({
    json: async () => ({
      data: format === 'JSON' ? [{ serviceName: 'web' }] : [],
    }),
  }),
);

jest.mock('@/clickhouse', () => ({
  useClickhouseClient: () => ({ query: mockQuery }),
  getClickhouseClient: jest.fn(),
}));

jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => ({
    getColumns: async () => [{ name: 'ServiceName' }],
  }),
}));

jest.mock('@/hooks/useFieldExpressionGenerator', () => ({
  __esModule: true,
  default: () => ({
    isLoading: false,
    getFieldExpression: (column: string, key: string) => `${column}['${key}']`,
  }),
}));

const traceSource: TTraceSource = {
  id: 'traces',
  name: 'Traces',
  kind: SourceKind.Trace,
  from: { databaseName: 'default', tableName: 'otel_traces' },
  connection: 'conn',
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp',
  durationExpression: 'Duration',
  durationPrecision: 9,
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  serviceNameExpression: 'ServiceName',
};

const sessionSource: TSessionSource = {
  id: 'sessions',
  name: 'Sessions',
  kind: SourceKind.Session,
  from: { databaseName: 'default', tableName: 'hyperdx_sessions' },
  connection: 'conn',
  timestampValueExpression: 'TimestampTime',
  traceSourceId: 'traces',
};

const COMBINED_TRACE_KEY =
  "if(ResourceAttributes['rum.sessionId'] != '', ResourceAttributes['rum.sessionId'], SpanAttributes['session.id'])";

async function renderListSql({
  where,
  sessionConnection = 'conn',
}: {
  where?: string;
  sessionConnection?: string;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () =>
      useSessions({
        traceSource,
        sessionSource: { ...sessionSource, connection: sessionConnection },
        dateRange: [new Date(0), new Date(1000)],
        where,
        whereLanguage: 'lucene',
      }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const listCall = mockQuery.mock.calls.find(([arg]) => arg.format == null);
  return listCall?.[0].query;
}

describe('useSessions list query', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('merges replay rows into the list when there is no search', async () => {
    const sql = await renderListSql({});

    expect(sql).toContain('_recordings AS (');
    expect(sql).toContain('"tableName":"hyperdx_sessions"');
    expect(sql).toContain(COMBINED_TRACE_KEY);
    expect(sql).toContain(
      'ResourceAttributes.rum.sessionId:* OR SpanAttributes.session.id:*',
    );
    expect(sql).toContain(
      'HAVING max(fromReplay) = 1 OR interactionCount > 0 OR recordingCount > 0',
    );
    expect(sql).toContain('LIMIT 500');
  });

  it('checks replay membership on both keys when searching', async () => {
    const sql = await renderListSql({ where: 'ServiceName:web' });

    expect(sql).toContain('UNION DISTINCT');
    expect(sql).toContain("DISTINCT LogAttributes['session.id']");
    expect(sql).not.toContain('_recordings');
    expect(sql).not.toContain('HAVING');
  });

  it('keeps the legacy span-only list when the sources use different connections', async () => {
    const sql = await renderListSql({ sessionConnection: 'other' });

    expect(sql).not.toMatch(/Attributes(\['session\.id'\]|\.session\.id)/);
    expect(sql).not.toContain('_recordings');
    expect(sql).toContain('HAVING interactionCount > 0 OR recordingCount > 0');
  });
});
