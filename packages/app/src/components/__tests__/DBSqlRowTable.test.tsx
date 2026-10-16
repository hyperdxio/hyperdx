import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';

import { DBSqlRowTable } from '@/components/DBRowTable';

const mockUseOffsetPaginatedQuery = jest.fn();
jest.mock('@/hooks/useOffsetPaginatedQuery', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseOffsetPaginatedQuery(...args),
}));

jest.mock('@/api', () => ({
  __esModule: true,
  default: { useMe: () => ({ data: { team: {} } }) },
}));

jest.mock('@/hooks/useMetadata', () => ({
  ...jest.requireActual('@/hooks/useMetadata'),
  useColumns: () => ({ data: undefined }),
  useTableMetadata: () => ({
    data: { primary_key: 'Timestamp', partition_key: 'toDate(Timestamp)' },
  }),
}));

jest.mock('@/hooks/usePatterns', () => ({
  ...jest.requireActual('@/hooks/usePatterns'),
  useGroupedPatterns: () => ({ data: {}, isLoading: false, miner: null }),
}));

jest.mock('@/source', () => ({
  ...jest.requireActual('@/source'),
  useSource: () => ({ data: undefined }),
}));

jest.mock('@/hooks/useChartConfig', () => ({
  ...jest.requireActual('@/hooks/useChartConfig'),
  useAliasMapFromChartConfig: () => ({ data: {}, isLoading: false }),
  useRenderedSqlChartConfig: () => ({ data: '', isLoading: false }),
}));

const config: React.ComponentProps<typeof DBSqlRowTable>['config'] = {
  select: 'Body',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  where: '',
  timestampValueExpression: 'Timestamp',
  connection: 'test-connection',
  dateRange: [
    new Date('2026-07-06T00:00:00Z'),
    new Date('2026-07-06T01:00:00Z'),
  ],
};

function mockQueryResult({
  isPlaceholderData,
}: {
  isPlaceholderData: boolean;
}) {
  mockUseOffsetPaginatedQuery.mockReturnValue({
    data: {
      data: [{ Body: 'previous row' }],
      meta: [{ name: 'Body', type: 'String' }],
      window: undefined,
    },
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetching: isPlaceholderData,
    isError: false,
    error: null,
    isPlaceholderData,
  });
}

function renderTable(
  props: Partial<React.ComponentProps<typeof DBSqlRowTable>>,
) {
  return renderWithMantine(
    <QueryClientProvider client={new QueryClient()}>
      <DBSqlRowTable config={config} sourceId="source-id" {...props} />
    </QueryClientProvider>,
  );
}

describe('DBSqlRowTable refresh', () => {
  beforeEach(() => {
    mockUseOffsetPaginatedQuery.mockReset();
  });

  it('asks the query to keep the previous rows when keepPreviousData is set', () => {
    mockQueryResult({ isPlaceholderData: false });

    renderTable({ keepPreviousData: true });

    expect(mockUseOffsetPaginatedQuery.mock.calls[0][1]).toEqual(
      expect.objectContaining({ keepPreviousData: true }),
    );
  });

  it('pulses the previous rows while a refresh loads', () => {
    mockQueryResult({ isPlaceholderData: true });

    renderTable({ keepPreviousData: true });

    expect(screen.getByTestId('search-results-table')).toHaveClass(
      'effect-pulse',
    );
  });

  it('does not pulse once fresh rows have loaded', () => {
    mockQueryResult({ isPlaceholderData: false });

    renderTable({ keepPreviousData: true });

    expect(screen.getByTestId('search-results-table')).not.toHaveClass(
      'effect-pulse',
    );
  });

  it('does not pulse without keepPreviousData (e.g. live tail on the search page)', () => {
    mockQueryResult({ isPlaceholderData: true });

    renderTable({ isLive: true });

    expect(screen.getByTestId('search-results-table')).not.toHaveClass(
      'effect-pulse',
    );
  });
});
