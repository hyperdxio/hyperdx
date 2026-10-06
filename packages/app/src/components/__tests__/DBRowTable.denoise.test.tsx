import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

import { DBSqlRowTable } from '@/components/DBRowTable';

const mockUseGroupedPatterns = jest.fn();
const mockUseAliasMap = jest.fn();

jest.mock('@/hooks/usePatterns', () => ({
  ...jest.requireActual('@/hooks/usePatterns'),
  useGroupedPatterns: (...args: unknown[]) => mockUseGroupedPatterns(...args),
}));

jest.mock('@/hooks/useChartConfig', () => ({
  ...jest.requireActual('@/hooks/useChartConfig'),
  useAliasMapFromChartConfig: (...args: unknown[]) => mockUseAliasMap(...args),
}));

jest.mock('@/hooks/useOffsetPaginatedQuery', () => ({
  __esModule: true,
  default: () => ({
    data: undefined,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetching: false,
    isError: false,
    error: null,
  }),
}));

jest.mock('@/hooks/useMetadata', () => ({
  ...jest.requireActual('@/hooks/useMetadata'),
  useTableMetadata: () => ({ data: undefined }),
  useColumns: () => ({ data: undefined }),
}));

jest.mock('@/source', () => ({
  ...jest.requireActual('@/source'),
  useSource: () => ({ data: undefined }),
}));

jest.mock('@/api', () => {
  const actual = jest.requireActual('@/api');
  return {
    __esModule: true,
    ...actual,
    default: { ...actual.default, useMe: () => ({ data: undefined }) },
  };
});

const config: BuilderChartConfigWithDateRange = {
  displayType: DisplayType.Search,
  connection: 'test-connection',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  select: 'Timestamp, ServiceName as service, Body',
  where: "service = 'api'",
  whereLanguage: 'sql',
  timestampValueExpression: 'Timestamp',
  dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
};

function renderTable({ denoiseResults }: { denoiseResults: boolean }) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TestProviders>
        <DBSqlRowTable
          config={config}
          sourceId="source-id"
          denoiseResults={denoiseResults}
        />
      </TestProviders>
    </QueryClientProvider>,
  );
}

const lastPatternArgs = () => mockUseGroupedPatterns.mock.lastCall?.[0];

describe('DBSqlRowTable denoise', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGroupedPatterns.mockReturnValue({
      data: {},
      isLoading: false,
      error: null,
      miner: undefined,
      sampledRowCount: 0,
    });
    mockUseAliasMap.mockReturnValue({
      data: { service: 'ServiceName' },
      isLoading: false,
    });
  });

  it('mines patterns with the select aliases the filters rely on', () => {
    renderTable({ denoiseResults: true });

    expect(lastPatternArgs()).toMatchObject({
      enabled: true,
      config: {
        where: "service = 'api'",
        with: [
          {
            name: 'service',
            sql: { sql: 'ServiceName', params: {} },
            isSubquery: false,
          },
        ],
      },
    });
  });

  it('holds the pattern query until the aliases are known', () => {
    mockUseAliasMap.mockReturnValue({ data: undefined, isLoading: true });

    renderTable({ denoiseResults: true });

    expect(lastPatternArgs()).toMatchObject({ enabled: false });
  });

  it('does not mine patterns when denoise is off', () => {
    renderTable({ denoiseResults: false });

    expect(lastPatternArgs()).toMatchObject({ enabled: false });
  });
});
