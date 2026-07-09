import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ActiveFilterPills } from '@/components/ActiveFilterPills';
import { useGetKeyValues } from '@/hooks/useMetadata';
import type { FilterStateHook } from '@/searchFilters';
import { copyTextToClipboard } from '@/utils/clipboard';

jest.mock('@/utils/clipboard', () => ({
  __esModule: true,
  CLIPBOARD_ERROR_MESSAGE: 'clipboard error',
  copyTextToClipboard: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/hooks/useMetadata', () => ({
  __esModule: true,
  useGetKeyValues: jest.fn(() => ({ data: [], isFetching: false })),
}));

// Deterministic stand-in for the locale/timezone-aware formatter so assertions
// don't depend on the test runner's timezone or clock preference.
jest.mock('@/useFormatTime', () => ({
  __esModule: true,
  useFormatTime: () => (value: unknown) => `formatted(${String(value)})`,
}));

const mockedUseGetKeyValues = useGetKeyValues as jest.Mock;

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks
// it. jsdom also has no layout, so portaled options compute as "hidden" and
// must be queried with { hidden: true }.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// useGetKeyValues is mocked, so this only needs to satisfy the prop type.
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
    replaceFilterValue: jest.fn(),
    setFilterRange: jest.fn(),
    clearFilter: jest.fn(),
    clearAllFilters: jest.fn(),
    retainFiltersByColumns: jest.fn(() => []),
  };
}

function renderPills(searchFilters: FilterStateHook) {
  return renderWithMantine(
    <ActiveFilterPills
      searchFilters={searchFilters}
      chartConfig={CHART_CONFIG}
    />,
  );
}

describe('ActiveFilterPills', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedUseGetKeyValues.mockReturnValue({ data: [], isFetching: false });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing when there are no filters', () => {
    const searchFilters = makeSearchFilters({});
    renderPills(searchFilters);
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
    expect(screen.queryByText(' = ')).not.toBeInTheDocument();
  });

  it('renders included filter pills', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200', '404']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getAllByText('status')).toHaveLength(2);
  });

  it('renders excluded filter pills', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(['500']),
      },
    });
    renderPills(searchFilters);
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('status')).toBeInTheDocument();
  });

  it('styles the excluded pill with a soft red-light background and the included pill with neutral hover', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
      level: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(['error']),
      },
    });
    renderPills(searchFilters);

    const included = screen.getByTestId('active-filter-pill-status');
    const excluded = screen.getByTestId('active-filter-pill-level');

    // Assert on the raw inline-style string so the token check can't silently
    // no-op on a jsdom that drops unresolved CSS custom properties.
    expect(included.getAttribute('style')).toContain('var(--color-bg-hover)');
    expect(excluded.getAttribute('style')).toContain(
      'var(--mantine-color-red-light)',
    );
    expect(
      excluded
        .querySelector('button[aria-label="Remove filter"]')
        ?.getAttribute('style'),
    ).toContain('var(--mantine-color-red-light-color)');
  });

  it('renders range filter pills', () => {
    const searchFilters = makeSearchFilters({
      duration: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(),
        range: { min: 100, max: 500 },
      },
    });
    renderPills(searchFilters);
    expect(screen.getByText('duration')).toBeInTheDocument();
    expect(screen.getByText('100 – 500')).toBeInTheDocument();
  });

  it('calls setFilterValue when removing an included pill', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);
    // Click the x button (the svg icon's parent ActionIcon)
    const removeButtons = screen.getAllByRole('button');
    fireEvent.click(removeButtons[0]);
    expect(searchFilters.setFilterValue).toHaveBeenCalledWith(
      'status',
      '200',
      undefined,
    );
  });

  it('calls setFilterValue with exclude action when removing an excluded pill', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(['500']),
      },
    });
    renderPills(searchFilters);
    const removeButtons = screen.getAllByRole('button');
    fireEvent.click(removeButtons[0]);
    expect(searchFilters.setFilterValue).toHaveBeenCalledWith(
      'status',
      '500',
      'exclude',
    );
  });

  it('calls clearFilter when removing a range pill', () => {
    const searchFilters = makeSearchFilters({
      duration: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(),
        range: { min: 0, max: 100 },
      },
    });
    renderPills(searchFilters);
    const removeButtons = screen.getAllByRole('button');
    fireEvent.click(removeButtons[0]);
    expect(searchFilters.clearFilter).toHaveBeenCalledWith('duration');
  });

  it('does not show "Clear all" when there is only one pill', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
  });

  it('shows "Clear all" when there are 2+ pills', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200', '404']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);
    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  it('requires double click to clear all filters', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200', '404']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    // First click shows confirmation
    fireEvent.click(screen.getByText('Clear all'));
    expect(searchFilters.clearAllFilters).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm clear all?')).toBeInTheDocument();

    // Second click actually clears
    fireEvent.click(screen.getByText('Confirm clear all?'));
    expect(searchFilters.clearAllFilters).toHaveBeenCalledTimes(1);
  });

  it('resets confirm state after 2s timeout', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200', '404']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    fireEvent.click(screen.getByText('Clear all'));
    expect(screen.getByText('Confirm clear all?')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByText('Clear all')).toBeInTheDocument();
    expect(screen.queryByText('Confirm clear all?')).not.toBeInTheDocument();
  });

  it('resets confirm state on mouse leave', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200', '404']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    fireEvent.click(screen.getByText('Clear all'));
    expect(screen.getByText('Confirm clear all?')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByText('Confirm clear all?'));
    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  it('collapses pills beyond MAX_VISIBLE_PILLS and shows "+N more"', () => {
    // Create 10 included values to exceed the limit of 8
    const values = new Set<string | boolean>(
      Array.from({ length: 10 }, (_, i) => `val${i}`),
    );
    const searchFilters = makeSearchFilters({
      field: {
        included: values,
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    expect(screen.getByText('+2 more')).toBeInTheDocument();
    // Only 8 value pills should be visible
    expect(screen.queryByText('val8')).not.toBeInTheDocument();
    expect(screen.queryByText('val9')).not.toBeInTheDocument();
  });

  it('expands to show all pills when clicking "+N more"', () => {
    const values = new Set<string | boolean>(
      Array.from({ length: 10 }, (_, i) => `val${i}`),
    );
    const searchFilters = makeSearchFilters({
      field: {
        included: values,
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    fireEvent.click(screen.getByText('+2 more'));

    // All values should now be visible
    for (let i = 0; i < 10; i++) {
      expect(screen.getByText(`val${i}`)).toBeInTheDocument();
    }
    expect(screen.getByText('Show less')).toBeInTheDocument();
    expect(screen.queryByText('+2 more')).not.toBeInTheDocument();
  });

  it('collapses back when clicking "Show less"', () => {
    const values = new Set<string | boolean>(
      Array.from({ length: 10 }, (_, i) => `val${i}`),
    );
    const searchFilters = makeSearchFilters({
      field: {
        included: values,
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    fireEvent.click(screen.getByText('+2 more'));
    fireEvent.click(screen.getByText('Show less'));

    expect(screen.getByText('+2 more')).toBeInTheDocument();
    expect(screen.queryByText('val8')).not.toBeInTheDocument();
  });

  it('renders mixed included, excluded, and range filters together', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(['500']),
      },
      duration: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(),
        range: { min: 10, max: 200 },
      },
    });
    renderPills(searchFilters);

    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('10 – 200')).toBeInTheDocument();
  });

  // The popover dropdown mounts via floating-ui on a frame and Mantine guards
  // the opening click through a real pointer sequence, so these tests run on
  // real timers with userEvent, unlike the synchronous suite above.
  it('opens the action menu when an editable pill is clicked', async () => {
    jest.useRealTimers();
    const user = userEvent.setup();
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    await user.click(screen.getByTestId('active-filter-pill-status'));

    const [copyButton, excludeButton] = await Promise.all([
      screen.findByRole('button', { name: 'Copy value', hidden: true }),
      screen.findByRole('button', { name: 'Exclude', hidden: true }),
    ]);
    expect(copyButton).toBeInTheDocument();
    expect(excludeButton).toBeInTheDocument();
  });

  it('excludes an included value from the menu', async () => {
    jest.useRealTimers();
    const user = userEvent.setup();
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    await user.click(screen.getByTestId('active-filter-pill-status'));
    await user.click(
      await screen.findByRole('button', { name: 'Exclude', hidden: true }),
    );

    expect(searchFilters.setFilterValue).toHaveBeenCalledWith(
      'status',
      '200',
      'exclude',
    );
  });

  it('includes an excluded value from the menu', async () => {
    jest.useRealTimers();
    const user = userEvent.setup();
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(['500']),
      },
    });
    renderPills(searchFilters);

    await user.click(screen.getByTestId('active-filter-pill-status'));
    await user.click(
      await screen.findByRole('button', { name: 'Include', hidden: true }),
    );

    expect(searchFilters.setFilterValue).toHaveBeenCalledWith(
      'status',
      '500',
      'include',
    );
  });

  it('copies the value from the menu', async () => {
    jest.useRealTimers();
    const user = userEvent.setup();
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    await user.click(screen.getByTestId('active-filter-pill-status'));
    await user.click(
      await screen.findByRole('button', { name: 'Copy value', hidden: true }),
    );

    expect(copyTextToClipboard).toHaveBeenCalledWith('200');
  });

  it('removes via the x without opening the menu', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    fireEvent.click(screen.getByRole('button', { name: 'Remove filter' }));

    expect(searchFilters.setFilterValue).toHaveBeenCalledWith(
      'status',
      '200',
      undefined,
    );
    expect(
      screen.queryByRole('button', { name: 'Exclude' }),
    ).not.toBeInTheDocument();
  });

  it('does not open the menu for range pills', () => {
    const searchFilters = makeSearchFilters({
      duration: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(),
        range: { min: 100, max: 500 },
      },
    });
    renderPills(searchFilters);

    fireEvent.click(screen.getByTestId('active-filter-pill-duration'));

    expect(
      screen.queryByRole('button', { name: 'Copy value' }),
    ).not.toBeInTheDocument();
  });

  it('fetches picker values with the active query and filters stripped', () => {
    // A picker scoped to the current query would only list values already
    // matching it, so an included pill could never switch to another value.
    const scopedConfig = {
      ...CHART_CONFIG,
      where: "status = '200'",
      filters: [{ type: 'sql', condition: "status = '200'" }],
    } as BuilderChartConfigWithDateRange;
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderWithMantine(
      <ActiveFilterPills
        searchFilters={searchFilters}
        chartConfig={scopedConfig}
      />,
    );

    expect(mockedUseGetKeyValues).toHaveBeenCalled();
    const { chartConfig: passedConfig } =
      mockedUseGetKeyValues.mock.calls[0][0];
    expect(passedConfig.where).toBe('');
    expect(passedConfig.filters).toEqual([]);
  });

  it('shows a value picker populated from useGetKeyValues', async () => {
    jest.useRealTimers();
    mockedUseGetKeyValues.mockReturnValue({
      data: [{ key: 'status', value: ['200', '404', '500'] }],
      isFetching: false,
    });
    const user = userEvent.setup();
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    await user.click(screen.getByTestId('active-filter-pill-status'));
    await user.click(await screen.findByLabelText('Change filter value'));

    expect(
      await screen.findByRole('option', { name: '404', hidden: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: '500', hidden: true }),
    ).toBeInTheDocument();
  });

  it('replaces the value from the menu, preserving include polarity', async () => {
    jest.useRealTimers();
    mockedUseGetKeyValues.mockReturnValue({
      data: [{ key: 'status', value: ['200', '404', '500'] }],
      isFetching: false,
    });
    const user = userEvent.setup();
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderPills(searchFilters);

    await user.click(screen.getByTestId('active-filter-pill-status'));
    await user.click(await screen.findByLabelText('Change filter value'));
    fireEvent.click(
      await screen.findByRole('option', { name: '404', hidden: true }),
    );

    expect(searchFilters.replaceFilterValue).toHaveBeenCalledWith(
      'status',
      '200',
      '404',
      'include',
    );
  });

  it('replaces the value from the menu, preserving exclude polarity', async () => {
    jest.useRealTimers();
    mockedUseGetKeyValues.mockReturnValue({
      data: [{ key: 'status', value: ['500', '502', '503'] }],
      isFetching: false,
    });
    const user = userEvent.setup();
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(['500']),
      },
    });
    renderPills(searchFilters);

    await user.click(screen.getByTestId('active-filter-pill-status'));
    await user.click(await screen.findByLabelText('Change filter value'));
    fireEvent.click(
      await screen.findByRole('option', { name: '502', hidden: true }),
    );

    expect(searchFilters.replaceFilterValue).toHaveBeenCalledWith(
      'status',
      '500',
      '502',
      'exclude',
    );
  });

  describe('DateTime value formatting', () => {
    const TS = '2026-06-16T15:35:16.731000000Z';

    function renderWithDateTime(
      searchFilters: FilterStateHook,
      dateTimeColumns: Map<string, string>,
    ) {
      return renderWithMantine(
        <ActiveFilterPills
          searchFilters={searchFilters}
          chartConfig={CHART_CONFIG}
          dateTimeColumns={dateTimeColumns}
        />,
      );
    }

    it('formats a DateTime column pill value for display', () => {
      const searchFilters = makeSearchFilters({
        Timestamp: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>([TS]),
        },
      });
      renderWithDateTime(
        searchFilters,
        new Map([['Timestamp', 'DateTime64(9)']]),
      );

      expect(screen.getByText(`formatted(${TS})`)).toBeInTheDocument();
      // The raw, unformatted value is not shown.
      expect(screen.queryByText(TS)).not.toBeInTheDocument();
    });

    it('does not format pill values for non-DateTime columns', () => {
      const searchFilters = makeSearchFilters({
        status: {
          included: new Set<string | boolean>([TS]),
          excluded: new Set<string | boolean>(),
        },
      });
      renderWithDateTime(
        searchFilters,
        new Map([['Timestamp', 'DateTime64(9)']]),
      );

      expect(screen.getByText(TS)).toBeInTheDocument();
      expect(screen.queryByText(`formatted(${TS})`)).not.toBeInTheDocument();
    });

    it('preserves the raw value for filter operations despite the formatted label', () => {
      const searchFilters = makeSearchFilters({
        Timestamp: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>([TS]),
        },
      });
      renderWithDateTime(
        searchFilters,
        new Map([['Timestamp', 'DateTime64(9)']]),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Remove filter' }));
      expect(searchFilters.setFilterValue).toHaveBeenCalledWith(
        'Timestamp',
        TS,
        'exclude',
      );
    });
  });
});
