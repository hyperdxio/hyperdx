import React from 'react';
import { fireEvent, screen } from '@testing-library/react';

import { ChartSeriesTooltip } from '@/components/charts/ChartSeriesTooltip';
import type { ActiveClickSeries } from '@/HDXMultiSeriesTimeChart';

const multiSeriesPayload: ActiveClickSeries[] = [
  { dataKey: 'error', name: 'error', value: 90, color: '#f00' },
  { dataKey: 'warn', name: 'warn', value: 10, color: '#ff0' },
];

const singleSeriesPayload: ActiveClickSeries[] = [
  { dataKey: 'count', name: 'count', value: 42, color: '#0f0' },
];

const baseProps = {
  activeLabel: '1704067200',
  numberFormatByKey: new Map(),
  buildSearchUrl: () => null,
};

describe('ChartSeriesTooltip', () => {
  it('renders one Focus button per series when there is more than one series', () => {
    renderWithMantine(
      <ChartSeriesTooltip {...baseProps} activePayload={multiSeriesPayload} />,
    );

    // One Focus button per series row.
    expect(
      screen.getAllByRole('button', {
        name: /Focus/i,
      }),
    ).toHaveLength(2);
  });

  it('hides per-series actions when there is only one series', () => {
    renderWithMantine(
      <ChartSeriesTooltip {...baseProps} activePayload={singleSeriesPayload} />,
    );

    // A single series is covered by the header/footer; no per-series actions.
    expect(
      screen.queryByRole('button', {
        name: /Focus/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('focuses a series and dismisses the tooltip when Focus is clicked', () => {
    const onFocusSeries = jest.fn();
    const onDismiss = jest.fn();

    renderWithMantine(
      <ChartSeriesTooltip
        {...baseProps}
        activePayload={multiSeriesPayload}
        onFocusSeries={onFocusSeries}
        onDismiss={onDismiss}
      />,
    );

    const focusButtons = screen.getAllByRole('button', {
      name: /Focus/i,
    });
    // Rows are sorted by value desc, so the first Focus button is "error".
    fireEvent.click(focusButtons[0]);

    expect(onFocusSeries).toHaveBeenCalledWith({
      dataKey: 'error',
      name: 'error',
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows the "Show All Series" footer action only when onShowAllSeries is provided', () => {
    const { unmount } = renderWithMantine(
      <ChartSeriesTooltip {...baseProps} activePayload={multiSeriesPayload} />,
    );

    // Without a focus active (no handler), the reset action is not rendered.
    expect(
      screen.queryByTestId('chart-show-all-series'),
    ).not.toBeInTheDocument();
    unmount();

    renderWithMantine(
      <ChartSeriesTooltip
        {...baseProps}
        activePayload={multiSeriesPayload}
        onShowAllSeries={() => {}}
      />,
    );
    expect(screen.getByTestId('chart-show-all-series')).toBeInTheDocument();
  });

  it('clears the focus and dismisses when "Show All Series" is clicked', () => {
    const onShowAllSeries = jest.fn();
    const onDismiss = jest.fn();

    renderWithMantine(
      <ChartSeriesTooltip
        {...baseProps}
        activePayload={multiSeriesPayload}
        onShowAllSeries={onShowAllSeries}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByTestId('chart-show-all-series'));

    expect(onShowAllSeries).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders no tooltip content when every series value is non-finite', () => {
    renderWithMantine(
      <ChartSeriesTooltip
        {...baseProps}
        activePayload={[{ dataKey: 'x', name: 'x', value: undefined }]}
      />,
    );

    // No rows survive the finite-value filter, so the whole tooltip (and its
    // Close button) is not rendered.
    expect(
      screen.queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument();
  });
});
