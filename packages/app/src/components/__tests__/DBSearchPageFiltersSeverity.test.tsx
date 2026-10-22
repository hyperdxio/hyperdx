import { buildSeverityClassExpressionV1 } from '@hyperdx/common-utils/dist/core/severity';
import type { FilterState } from '@hyperdx/common-utils/dist/filters';
import {
  type BuilderChartConfigWithDateRange,
  SourceKind,
  type TLogSource,
} from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DBSearchPageFilters } from '@/components/DBSearchPageFilters';

const logSource: TLogSource = {
  id: 'source-id',
  kind: SourceKind.Log,
  name: 'logs',
  connection: 'conn',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
  severityTextExpression: 'SeverityText',
  severityNumberExpression: 'SeverityNumber',
};

const CLASS_KEY = buildSeverityClassExpressionV1({
  numberExpr: 'SeverityNumber',
  textExpr: 'SeverityText',
});
// Built before the source's text expression was edited.
const STALE_CLASS_KEY = buildSeverityClassExpressionV1({
  numberExpr: 'SeverityNumber',
  textExpr: "LogAttributes['level']",
});

jest.mock('@/source', () => ({
  ...jest.requireActual('@/source'),
  useSource: () => ({ data: logSource }),
}));

jest.mock('@/pinnedFilters', () => ({
  ...jest.requireActual('@/pinnedFilters'),
  usePinnedFiltersApi: () => ({ data: undefined }),
  useUpdatePinnedFilters: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/hooks/useMetadata', () => ({
  ...jest.requireActual('@/hooks/useMetadata'),
  useColumns: () => ({ data: undefined }),
  useJsonColumns: () => ({ data: undefined }),
  useTableMetadata: () => ({ data: undefined }),
  useGetValuesDistribution: () => ({
    data: undefined,
    isFetching: false,
    error: undefined,
  }),
}));

jest.mock('@/components/DBSearchPageFilters/hooks', () => ({
  ...jest.requireActual('@/components/DBSearchPageFilters/hooks'),
  useFetchFacets: () => ({
    data: {
      keyValues: [
        { key: 'ServiceName', value: ['api'] },
        { key: 'SeverityText', value: ['error'] },
      ],
      pendingKeys: new Set(),
    },
    isLoading: false,
    isFetching: false,
    error: null,
    loadMoreFacetsForKey: jest.fn(),
    loadMoreLoadingKeys: new Set(),
    extraFacetKeys: new Set(),
  }),
}));

const chartConfig: BuilderChartConfigWithDateRange = {
  connection: 'conn',
  from: logSource.from,
  select: '',
  where: '',
  timestampValueExpression: 'Timestamp',
  dateRange: [new Date('2026-01-01'), new Date('2026-01-02')],
};

function renderFilters({
  filters = {},
  clearFilter = jest.fn(),
}: { filters?: FilterState; clearFilter?: jest.Mock } = {}) {
  renderWithMantine(
    <DBSearchPageFilters
      filters={filters}
      setFilters={jest.fn()}
      setFilterValue={jest.fn()}
      setOnlyFilters={jest.fn()}
      replaceFilterValue={jest.fn()}
      setFilterRange={jest.fn()}
      clearFilter={clearFilter}
      clearAllFilters={jest.fn()}
      retainFiltersByColumns={jest.fn()}
      isLive={false}
      chartConfig={chartConfig}
      analysisMode="results"
      setAnalysisMode={jest.fn()}
      sourceId={logSource.id}
      showDelta={false}
      denoiseResults={false}
      setDenoiseResults={jest.fn()}
    />,
  );
}

const groupNames = () =>
  screen
    .getAllByTestId('filter-group-control')
    .map(el => el.textContent?.match(/^\w+/)?.[0]);

describe('DBSearchPageFilters Severity facet', () => {
  it('keeps class keys out of the raw facets, and clears them', async () => {
    const user = userEvent.setup();
    const clearFilter = jest.fn();
    renderFilters({
      clearFilter,
      filters: {
        [CLASS_KEY]: { included: new Set(['ERROR']), excluded: new Set() },
        [STALE_CLASS_KEY]: {
          included: new Set(['WARN']),
          excluded: new Set(),
        },
      },
    });

    expect(groupNames()).toEqual(['Severity', 'ServiceName', 'SeverityText']);

    await user.click(screen.getByRole('button', { name: 'Clear Filters' }));
    expect(clearFilter).toHaveBeenCalledWith(CLASS_KEY);
    expect(clearFilter).toHaveBeenCalledWith(STALE_CLASS_KEY);
  });
});
