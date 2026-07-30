import type { FilterState } from '@hyperdx/common-utils/dist/filters';
import {
  type DashboardFilter,
  MetricsDataType,
} from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DashboardFilters, { groupFiltersForDisplay } from '@/DashboardFilters';
import { useDashboardFilterValues } from '@/hooks/useDashboardFilterValues';

// Mock only the hook — `filtersLink` stays real, since the chain icons are
// supposed to agree with the actual linking rule.
jest.mock('@/hooks/useDashboardFilterValues', () => ({
  ...jest.requireActual('@/hooks/useDashboardFilterValues'),
  __esModule: true,
  useDashboardFilterValues: jest.fn(),
}));

const mockedUseDashboardFilterValues = jest.mocked(useDashboardFilterValues);

const LINKED_STORAGE_KEY = 'hdx-dashboard-filters-linked';

const makeFilter = (
  overrides: Pick<DashboardFilter, 'id' | 'name' | 'expression' | 'source'> &
    Partial<DashboardFilter>,
): DashboardFilter => ({
  type: 'QUERY_EXPRESSION',
  ...overrides,
});

const DATE_RANGE: [Date, Date] = [
  new Date('2026-01-01T00:00:00Z'),
  new Date('2026-01-02T00:00:00Z'),
];

// VirtualMultiSelect virtualizes its options, and jsdom reports zero-height
// scroll containers, so no option ever renders. Stub it down to the surface
// these tests care about: the testid, and a way to fire onChange.
jest.mock('@/components/VirtualMultiSelect/VirtualMultiSelect', () => ({
  __esModule: true,
  VirtualMultiSelect: ({
    data,
    onChange,
    'data-testid': dataTestId,
  }: {
    data: string[];
    onChange: (values: string[]) => void;
    'data-testid'?: string;
  }) => (
    <div data-testid={dataTestId}>
      {data.map(value => (
        <button key={value} type="button" onClick={() => onChange([value])}>
          {value}
        </button>
      ))}
    </div>
  ),
}));

function renderFilters({
  filters,
  filterValues = {},
}: {
  filters: DashboardFilter[];
  filterValues?: FilterState;
}) {
  const onSetFilterValue = jest.fn();
  const element = (nextFilters: DashboardFilter[]) => (
    <DashboardFilters
      filters={nextFilters}
      filterValues={filterValues}
      onSetFilterValue={onSetFilterValue}
      dateRange={DATE_RANGE}
    />
  );
  const utils = renderWithMantine(element(filters));
  // RTL's rerender drops the render wrapper, so re-supply it. The tree must
  // match renderWithMantine's exactly, or React remounts everything and the
  // node-identity assertions below would pass/fail for the wrong reason.
  const rerenderFilters = (nextFilters: DashboardFilter[]) =>
    utils.rerender(
      <MantineProvider>
        <Notifications />
        {element(nextFilters)}
      </MantineProvider>,
    );
  return { ...utils, onSetFilterValue, rerenderFilters };
}

describe('groupFiltersForDisplay', () => {
  const a1 = makeFilter({
    id: 'a1',
    name: 'A1',
    expression: 'env',
    source: 'src-a',
  });
  const a2 = makeFilter({
    id: 'a2',
    name: 'A2',
    expression: 'service',
    source: 'src-a',
  });
  const b1 = makeFilter({
    id: 'b1',
    name: 'B1',
    expression: 'pod',
    source: 'src-b',
  });
  const b2 = makeFilter({
    id: 'b2',
    name: 'B2',
    expression: 'node',
    source: 'src-b',
  });

  it('returns an empty array for no filters', () => {
    expect(groupFiltersForDisplay([])).toEqual([]);
  });

  it('returns a single group for a single filter', () => {
    expect(groupFiltersForDisplay([a1])).toEqual([[a1]]);
  });

  it('groups interleaved sources stably: within-group order preserved, groups by first appearance', () => {
    expect(groupFiltersForDisplay([a1, b1, a2, b2])).toEqual([
      [a1, a2],
      [b1, b2],
    ]);
  });

  it('splits same-source filters with different metric types', () => {
    const gauge = makeFilter({
      id: 'g',
      name: 'Gauge',
      expression: 'cpu',
      source: 'metrics',
      sourceMetricType: MetricsDataType.Gauge,
    });
    const sum = makeFilter({
      id: 's',
      name: 'Sum',
      expression: 'requests',
      source: 'metrics',
      sourceMetricType: MetricsDataType.Sum,
    });
    expect(groupFiltersForDisplay([gauge, sum])).toEqual([[gauge], [sum]]);
  });

  it('groups filters with undefined metric types together', () => {
    expect(groupFiltersForDisplay([a1, a2])).toEqual([[a1, a2]]);
  });

  it('keeps same-source filters with different where clauses in one group (linking ignores where)', () => {
    // The linking rule (constraintByFilterId in useDashboardFilterValues) only
    // keys on source + sourceMetricType; `where` only affects fetch batching.
    const withWhere = makeFilter({
      id: 'w1',
      name: 'W1',
      expression: 'env',
      source: 'src-a',
      where: "service = 'api'",
      whereLanguage: 'sql',
    });
    const withOtherWhere = makeFilter({
      id: 'w2',
      name: 'W2',
      expression: 'status',
      source: 'src-a',
      where: "service = 'worker'",
      whereLanguage: 'sql',
    });
    expect(groupFiltersForDisplay([withWhere, withOtherWhere])).toEqual([
      [withWhere, withOtherWhere],
    ]);
  });
});

describe('DashboardFilters', () => {
  const filterA1 = makeFilter({
    id: 'a1',
    name: 'Env',
    expression: 'env',
    source: 'src-a',
  });
  const filterA2 = makeFilter({
    id: 'a2',
    name: 'Service',
    expression: 'service',
    source: 'src-a',
  });
  const filterB1 = makeFilter({
    id: 'b1',
    name: 'Pod',
    expression: 'pod',
    source: 'src-b',
  });

  beforeEach(() => {
    window.localStorage.clear();
    mockedUseDashboardFilterValues.mockClear();
    mockedUseDashboardFilterValues.mockReturnValue({
      data: new Map(),
      erroredFilterIds: new Set<string>(),
      isLoading: false,
      isFetching: false,
      isError: false,
    });
  });

  it('reads a persisted linked preference and narrows values by sibling selections', () => {
    window.localStorage.setItem(LINKED_STORAGE_KEY, JSON.stringify(true));
    const filterValues: FilterState = {
      env: { included: new Set(['prod']), excluded: new Set() },
    };

    renderFilters({ filters: [filterA1, filterA2], filterValues });

    expect(screen.getByTestId('dashboard-filters-link-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Assert the FIRST call: the point of persisting is that a returning user's
    // very first query is already the faceted one, with no extra unconstrained
    // fetch beforehand.
    expect(mockedUseDashboardFilterValues.mock.calls[0][0]).toMatchObject({
      filterValues,
    });
  });

  it('does not narrow values by sibling selections when unlinked', () => {
    const filterValues: FilterState = {
      env: { included: new Set(['prod']), excluded: new Set() },
    };

    renderFilters({ filters: [filterA1, filterA2], filterValues });

    expect(screen.getByTestId('dashboard-filters-link-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(mockedUseDashboardFilterValues).toHaveBeenCalledWith(
      expect.objectContaining({ filterValues: {} }),
    );
  });

  it('persists toggle changes to localStorage', async () => {
    renderFilters({ filters: [filterA1, filterA2] });

    await userEvent.click(screen.getByTestId('dashboard-filters-link-toggle'));
    expect(window.localStorage.getItem(LINKED_STORAGE_KEY)).toBe('true');

    await userEvent.click(screen.getByTestId('dashboard-filters-link-toggle'));
    expect(window.localStorage.getItem(LINKED_STORAGE_KEY)).toBe('false');
  });

  it('shows chain icons between same-source filters only while linked', async () => {
    renderFilters({ filters: [filterA1, filterB1, filterA2] });

    expect(screen.queryAllByTestId('dashboard-filter-chain-icon')).toHaveLength(
      0,
    );

    await userEvent.click(screen.getByTestId('dashboard-filters-link-toggle'));

    // One chain between the two src-a filters; none across the source boundary.
    expect(screen.queryAllByTestId('dashboard-filter-chain-icon')).toHaveLength(
      1,
    );
  });

  it('does not chain same-source filters that share an expression', async () => {
    // Filters sharing an expression don't narrow each other (FilterState is
    // keyed by expression), so the chain icon must not claim they do.
    const prodService = makeFilter({
      id: 'p',
      name: 'Prod Service',
      expression: 'ServiceName',
      source: 'src-a',
      where: "env = 'prod'",
      whereLanguage: 'sql',
    });
    const stagingService = makeFilter({
      id: 's',
      name: 'Staging Service',
      expression: 'ServiceName',
      source: 'src-a',
      where: "env = 'staging'",
      whereLanguage: 'sql',
    });

    renderFilters({ filters: [prodService, stagingService] });
    await userEvent.click(screen.getByTestId('dashboard-filters-link-toggle'));

    expect(screen.queryAllByTestId('dashboard-filter-chain-icon')).toHaveLength(
      0,
    );
  });

  it('keeps surviving filters mounted when another filter is removed', () => {
    // Grouping must not make a filter's React key group-index-relative, or
    // removing one filter would remount the others and drop their dropdown and
    // search state.
    const { rerenderFilters } = renderFilters({
      filters: [filterA1, filterB1, filterA2],
    });
    const before = screen.getByTestId('dashboard-filter-select-Pod');

    rerenderFilters([filterB1, filterA2]);

    expect(screen.getByTestId('dashboard-filter-select-Pod')).toBe(before);
  });

  it('dispatches the correct expression for a regrouped filter', async () => {
    // Grouping moved this filter's position, so verify its onChange still
    // carries its own expression rather than a neighbor's.
    mockedUseDashboardFilterValues.mockReturnValue({
      data: new Map([['b1', { values: ['pod-1'], isLoading: false }]]),
      erroredFilterIds: new Set<string>(),
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    const { onSetFilterValue } = renderFilters({
      filters: [filterA1, filterB1, filterA2],
    });

    await userEvent.click(await screen.findByRole('button', { name: 'pod-1' }));

    expect(onSetFilterValue).toHaveBeenCalledWith('pod', ['pod-1']);
  });

  it('orders filters grouped by source, identically whether linked or not', async () => {
    renderFilters({ filters: [filterA1, filterB1, filterA2] });

    const getSelectOrder = () =>
      screen
        .getAllByTestId(/^dashboard-filter-select-/)
        .map(el => el.getAttribute('data-testid'));

    const groupedOrder = [
      'dashboard-filter-select-Env',
      'dashboard-filter-select-Service',
      'dashboard-filter-select-Pod',
    ];
    expect(getSelectOrder()).toEqual(groupedOrder);

    await userEvent.click(screen.getByTestId('dashboard-filters-link-toggle'));
    expect(getSelectOrder()).toEqual(groupedOrder);
  });

  it('renders a single filter with a stored linked preference without the toggle or chains', () => {
    window.localStorage.setItem(LINKED_STORAGE_KEY, JSON.stringify(true));

    renderFilters({ filters: [filterA1] });

    expect(
      screen.queryByTestId('dashboard-filters-link-toggle'),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('dashboard-filter-chain-icon')).toHaveLength(
      0,
    );
    expect(screen.getByTestId('dashboard-filter-select-Env')).toBeVisible();
  });
});
