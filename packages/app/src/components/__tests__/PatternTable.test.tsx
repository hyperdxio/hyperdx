import { screen } from '@testing-library/react';

import PatternTable from '@/components/PatternTable';

const mockUseGroupedPatterns = jest.fn();
jest.mock('@/hooks/usePatterns', () => ({
  ...jest.requireActual('@/hooks/usePatterns'),
  useGroupedPatterns: (args: unknown) => mockUseGroupedPatterns(args),
}));

jest.mock('@/components/SearchTotalCountChart', () => ({
  ...jest.requireActual('@/components/SearchTotalCountChart'),
  useSearchTotalCount: () => ({
    isLoading: false,
    isTotalCountComplete: true,
    totalCount: 5,
    error: null,
  }),
}));

jest.mock('@/hooks/useChartConfig', () => ({
  ...jest.requireActual('@/hooks/useChartConfig'),
  useAliasMapFromChartConfig: () => ({ data: {}, isLoading: false }),
}));

const config: React.ComponentProps<typeof PatternTable>['config'] = {
  select: '',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  where: '',
  timestampValueExpression: 'Timestamp',
  connection: 'test-connection',
  dateRange: [
    new Date('2026-07-06T00:00:00Z'),
    new Date('2026-07-06T01:00:00Z'),
  ],
};

function mockPatterns({ isPlaceholderData }: { isPlaceholderData: boolean }) {
  mockUseGroupedPatterns.mockReturnValue({
    data: {
      '1': {
        id: '1',
        pattern: 'GET <*> 200',
        count: 5,
        countStr: '~5',
        samples: [],
      },
    },
    isLoading: false,
    isPlaceholderData,
    error: null,
    patternQueryConfig: undefined,
  });
}

function renderTable(props: { keepPreviousData?: boolean }) {
  return renderWithMantine(
    <PatternTable
      config={config}
      totalCountConfig={config}
      bodyValueExpression="Body"
      totalCountQueryKeyPrefix="test-patterns"
      {...props}
    />,
  );
}

describe('PatternTable refresh', () => {
  beforeEach(() => {
    mockUseGroupedPatterns.mockReset();
  });

  it('asks for the previous patterns to be kept when keepPreviousData is set', () => {
    mockPatterns({ isPlaceholderData: false });

    renderTable({ keepPreviousData: true });

    expect(mockUseGroupedPatterns.mock.calls[0][0]).toEqual(
      expect.objectContaining({ keepPreviousData: true }),
    );
  });

  it('pulses the previous patterns while a refresh loads', () => {
    mockPatterns({ isPlaceholderData: true });

    renderTable({ keepPreviousData: true });

    expect(screen.getByTestId('search-results-table')).toHaveClass(
      'effect-pulse',
    );
  });

  it('does not pulse once fresh patterns have loaded', () => {
    mockPatterns({ isPlaceholderData: false });

    renderTable({ keepPreviousData: true });

    expect(screen.getByTestId('search-results-table')).not.toHaveClass(
      'effect-pulse',
    );
  });

  it('does not pulse without keepPreviousData (e.g. the search page)', () => {
    mockPatterns({ isPlaceholderData: true });

    renderTable({});

    expect(screen.getByTestId('search-results-table')).not.toHaveClass(
      'effect-pulse',
    );
  });
});
