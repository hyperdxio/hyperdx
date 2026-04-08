import { act, fireEvent, screen } from '@testing-library/react';

import type { FilterStateHook } from '@/searchFilters';

import { ActiveFilterPills } from '../ActiveFilterPills';

function makeSearchFilters(
  filters: FilterStateHook['filters'],
): FilterStateHook {
  return {
    filters,
    setFilters: jest.fn(),
    setFilterValue: jest.fn(),
    setFilterRange: jest.fn(),
    clearFilter: jest.fn(),
    clearAllFilters: jest.fn(),
  };
}

describe('ActiveFilterPills', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing when there are no filters', () => {
    const searchFilters = makeSearchFilters({});
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);
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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);
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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('status')).toBeInTheDocument();
  });

  it('renders range filter pills', () => {
    const searchFilters = makeSearchFilters({
      duration: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(),
        range: { min: 100, max: 500 },
      },
    });
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);
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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);
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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);
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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);
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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
  });

  it('shows "Clear all" when there are 2+ pills', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200', '404']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);
    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  it('requires double click to clear all filters', () => {
    const searchFilters = makeSearchFilters({
      status: {
        included: new Set<string | boolean>(['200', '404']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);

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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);

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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);

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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);

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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);

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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);

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
    renderWithMantine(<ActiveFilterPills searchFilters={searchFilters} />);

    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('10 – 200')).toBeInTheDocument();
  });
});
