import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChartSeriesTooltip } from '@/components/charts/ChartSeriesTooltip';
import type { ActiveClickSeries } from '@/HDXMultiSeriesTimeChart';
import { MAX_TOOLTIP_ROWS } from '@/HDXMultiSeriesTimeChart';

// Build `count` current-period series with descending values so the tooltip's
// value-desc sort/cap is deterministic.
function makeRows(count: number): ActiveClickSeries[] {
  return Array.from({ length: count }, (_, i) => ({
    value: count - i,
    dataKey: `g${i}`,
    name: `g${i}`,
    color: '#437eef',
  }));
}

const baseProps = {
  activeLabel: '1700000000',
  numberFormatByKey: new Map(),
  buildSearchUrl: () => null,
};

describe('ChartSeriesTooltip', () => {
  it('shows passive "+N more" text (not a button) without onLoadAllSeries', () => {
    // 25 rows over the 20-row cap => 5 hidden by the tooltip; plus 100 dropped
    // by the chart render cap => totalHidden should read 105.
    renderWithMantine(
      <ChartSeriesTooltip
        {...baseProps}
        activePayload={makeRows(MAX_TOOLTIP_ROWS + 5)}
        hiddenSeriesCount={100}
      />,
    );

    expect(screen.queryByRole('button', { name: /load all/i })).toBeNull();
    // tooltipHiddenCount (5) + hiddenSeriesCount (100) = 105.
    expect(screen.getByText(/\+105 more/)).toBeInTheDocument();
  });

  it('renders a clickable load-all button and fires onLoadAllSeries', async () => {
    const onLoadAllSeries = jest.fn();
    renderWithMantine(
      <ChartSeriesTooltip
        {...baseProps}
        activePayload={makeRows(MAX_TOOLTIP_ROWS + 5)}
        hiddenSeriesCount={100}
        onLoadAllSeries={onLoadAllSeries}
      />,
    );

    const button = screen.getByRole('button', {
      name: /load all 105 more series/i,
    });
    expect(button).toHaveTextContent(/\+105 more \(click to load all\)/);
    await userEvent.click(button);
    expect(onLoadAllSeries).toHaveBeenCalledTimes(1);
  });

  it('folds hiddenSeriesCount into the total even when nothing overflows the tooltip cap', () => {
    // Under the tooltip cap (no tooltipHiddenCount), so the "+N more" total is
    // driven entirely by the chart-level render cap.
    renderWithMantine(
      <ChartSeriesTooltip
        {...baseProps}
        activePayload={makeRows(3)}
        hiddenSeriesCount={42}
      />,
    );

    expect(screen.getByText(/\+42 more/)).toBeInTheDocument();
  });

  it('shows no "+N more" line when nothing is hidden', () => {
    renderWithMantine(
      <ChartSeriesTooltip {...baseProps} activePayload={makeRows(3)} />,
    );

    expect(screen.queryByText(/more/)).toBeNull();
  });

  it('caps rendered rows at MAX_TOOLTIP_ROWS when not expanded', () => {
    renderWithMantine(
      <ChartSeriesTooltip
        {...baseProps}
        activePayload={makeRows(MAX_TOOLTIP_ROWS + 30)}
      />,
    );

    // Only the top 20 series render; the 21st (g20) is beyond the preview cap.
    expect(screen.getByText('g0')).toBeInTheDocument();
    expect(screen.getByText(`g${MAX_TOOLTIP_ROWS - 1}`)).toBeInTheDocument();
    expect(screen.queryByText(`g${MAX_TOOLTIP_ROWS}`)).toBeNull();
    // The overflow is summarized.
    expect(screen.getByText(/\+30 more/)).toBeInTheDocument();
  });

  it('renders every row (past the 20-row preview) when expanded, so "load all" reveals them', () => {
    // This is the core fix: once "load all" is active the pinned tooltip shows
    // the full set in its scrollable body instead of the 20-row preview.
    const count = MAX_TOOLTIP_ROWS + 30;
    renderWithMantine(
      <ChartSeriesTooltip
        {...baseProps}
        activePayload={makeRows(count)}
        expanded
      />,
    );

    // Rows beyond the 20-preview are now present.
    expect(screen.getByText(`g${MAX_TOOLTIP_ROWS}`)).toBeInTheDocument();
    expect(screen.getByText(`g${count - 1}`)).toBeInTheDocument();
    // Nothing beyond the expanded cap here, so no "+N more".
    expect(screen.queryByText(/more/)).toBeNull();
  });

  it('still summarizes rows beyond expandedRowCap when expanded', () => {
    renderWithMantine(
      <ChartSeriesTooltip
        {...baseProps}
        activePayload={makeRows(30)}
        expanded
        expandedRowCap={25}
      />,
    );

    // 30 rows, cap 25 => 5 summarized.
    expect(screen.getByText('g24')).toBeInTheDocument();
    expect(screen.queryByText('g25')).toBeNull();
    expect(screen.getByText(/\+5 more/)).toBeInTheDocument();
  });
});
