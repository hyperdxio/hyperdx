import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FilterExpression } from '@/components/Explore/FilterExpression';
import { useGetKeyValues } from '@/hooks/useMetadata';
import type { FilterStateHook } from '@/searchFilters';

jest.mock('@/hooks/useMetadata', () => ({
  __esModule: true,
  useGetKeyValues: jest.fn(() => ({ data: [], isFetching: false })),
}));

jest.mock('@/useFormatTime', () => ({
  __esModule: true,
  useFormatTime: () => (value: unknown) => `formatted(${String(value)})`,
}));

const mockedUseGetKeyValues = useGetKeyValues as jest.Mock;

const CHART_CONFIG = {
  from: { databaseName: 'db', tableName: 'logs' },
  connection: 'conn',
  select: '',
  where: '',
  whereLanguage: 'lucene',
  timestampValueExpression: 'Timestamp',
  dateRange: [new Date(0), new Date()],
} as BuilderChartConfigWithDateRange;

function makeSearchFilters(
  filters: FilterStateHook['filters'],
): FilterStateHook {
  return {
    filters,
    setFilters: jest.fn(),
    setFilterValue: jest.fn(),
    setOnlyFilters: jest.fn(),
    setIncludedValues: jest.fn(),
    mergeFilterValues: jest.fn(),
    replaceFilterValue: jest.fn(),
    setFilterRange: jest.fn(),
    clearFilter: jest.fn(),
    clearAllFilters: jest.fn(),
    retainFiltersByColumns: jest.fn(() => []),
  };
}

function renderExpression(
  searchFilters: FilterStateHook,
  language: 'lucene' | 'sql' = 'lucene',
) {
  return renderWithMantine(
    <FilterExpression
      searchFilters={searchFilters}
      chartConfig={CHART_CONFIG}
      language={language}
    />,
  );
}

describe('FilterExpression', () => {
  beforeEach(() => {
    mockedUseGetKeyValues.mockReturnValue({ data: [], isFetching: false });
  });

  it('renders nothing when there are no filters', () => {
    renderExpression(makeSearchFilters({}));
    expect(screen.queryByTestId('filter-expression')).not.toBeInTheDocument();
  });

  it('hides AND between different-field clauses and uses lucene labels', () => {
    renderExpression(
      makeSearchFilters({
        Level: {
          included: new Set(['error']),
          excluded: new Set(),
        },
        ServiceName: {
          included: new Set(['frontend-proxy']),
          excluded: new Set(),
        },
      }),
    );
    expect(screen.queryByText('AND')).not.toBeInTheDocument();
    expect(screen.queryByText('OR')).not.toBeInTheDocument();
    expect(screen.getByText('Level')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('ServiceName')).toBeInTheDocument();
    expect(screen.getByText('frontend-proxy')).toBeInTheDocument();
    expect(screen.getAllByText(':')).toHaveLength(2);
  });

  it('wraps same-field values in an OR group with parens', () => {
    renderExpression(
      makeSearchFilters({
        Level: {
          included: new Set(['error']),
          excluded: new Set(),
        },
        Body: {
          included: new Set(['*timeout*', '*crash*']),
          excluded: new Set(),
        },
      }),
    );
    expect(screen.getByTestId('filter-or-group')).toBeInTheDocument();
    expect(screen.getByText('AND')).toBeInTheDocument();
    expect(screen.getByText('OR')).toBeInTheDocument();
    expect(screen.getByText('(')).toBeInTheDocument();
    expect(screen.getByText(')')).toBeInTheDocument();
    expect(screen.getByText('*timeout*')).toBeInTheDocument();
    expect(screen.getByText('*crash*')).toBeInTheDocument();
  });

  it('formats sql labels with quoted values', () => {
    renderExpression(
      makeSearchFilters({
        Level: {
          included: new Set(['error']),
          excluded: new Set(),
        },
      }),
      'sql',
    );
    expect(screen.getByText('Level')).toBeInTheDocument();
    expect(screen.getByText("'error'")).toBeInTheDocument();
    expect(
      screen.getByTestId('active-filter-pill-Level').textContent,
    ).toContain("Level = 'error'");
  });

  it('renders Slow spans as a one-sided range pill', () => {
    renderExpression(
      makeSearchFilters({
        Duration: {
          included: new Set(),
          excluded: new Set(),
          range: { min: 1_000_000_000, minOp: '>' },
        },
      }),
    );
    expect(
      screen.getByTestId('active-filter-pill-Duration').textContent,
    ).toContain('Duration:>1s');
  });

  it('removes a clause via the pill', async () => {
    const user = userEvent.setup();
    const searchFilters = makeSearchFilters({
      Level: {
        included: new Set(['error']),
        excluded: new Set(),
      },
    });
    renderExpression(searchFilters);
    await user.click(screen.getByLabelText('Remove filter'));
    expect(searchFilters.setFilterValue).toHaveBeenCalledWith(
      'Level',
      'error',
      undefined,
    );
  });
});
