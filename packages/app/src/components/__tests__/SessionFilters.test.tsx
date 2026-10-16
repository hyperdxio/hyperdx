import { ComponentProps } from 'react';
import { render } from '@testing-library/react';

import { SessionFilters } from '@/components/SessionFilters';

// Capture the props the wrapper hands to the (heavy) underlying component
// without rendering its facet machinery.
const dbSearchPageFilters = jest.fn((_props: Record<string, unknown>) => null);
jest.mock('@/components/DBSearchPageFilters', () => ({
  __esModule: true,
  DBSearchPageFilters: (props: Record<string, unknown>) =>
    dbSearchPageFilters(props),
}));

function getForwardedProps() {
  expect(dbSearchPageFilters).toHaveBeenCalledTimes(1);
  return dbSearchPageFilters.mock.calls[0][0];
}

describe('SessionFilters', () => {
  beforeEach(() => {
    dbSearchPageFilters.mockClear();
  });

  const baseProps: ComponentProps<typeof SessionFilters> = {
    chartConfig: {
      from: { databaseName: 'otel', tableName: 'otel_traces' },
      connection: 'conn',
      select: '',
      where: '',
      timestampValueExpression: 'Timestamp',
      dateRange: [new Date(0), new Date(1000)],
    },
    sourceId: 'trace-source',
    filters: {},
    setFilters: jest.fn(),
    setFilterValue: jest.fn(),
    setOnlyFilters: jest.fn(),
    replaceFilterValue: jest.fn(),
    setFilterRange: jest.fn(),
    clearFilter: jest.fn(),
    clearAllFilters: jest.fn(),
    retainFiltersByColumns: jest.fn(() => []),
  };

  it('forces exact facet mode so the sessions RUM scope is not stripped', () => {
    // "all" mode clears the chartConfig where/filters and samples the entire
    // trace table, which times out and leaves the sidebar empty; the sessions
    // sidebar must always fetch facet values in exact mode.
    render(<SessionFilters {...baseProps} />);
    expect(getForwardedProps().forceExactFacetMode).toBe(true);
  });

  it('hides analysis mode and disables live tail (not applicable to sessions)', () => {
    render(<SessionFilters {...baseProps} />);
    const props = getForwardedProps();
    expect(props.hideAnalysisMode).toBe(true);
    expect(props.isLive).toBe(false);
  });

  it('overrides the sessions-specific flags even if a caller passes them', () => {
    const callerFlags = { isLive: true, hideAnalysisMode: false };
    render(<SessionFilters {...baseProps} {...callerFlags} />);
    const props = getForwardedProps();
    expect(props.isLive).toBe(false);
    expect(props.hideAnalysisMode).toBe(true);
    expect(props.forceExactFacetMode).toBe(true);
  });

  it('forwards caller props (chartConfig, sourceId, filter state) through', () => {
    render(<SessionFilters {...baseProps} />);
    const props = getForwardedProps();
    expect(props.chartConfig).toBe(baseProps.chartConfig);
    expect(props.sourceId).toBe('trace-source');
    expect(props.filters).toBe(baseProps.filters);
  });
});
