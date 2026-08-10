import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HiddenSeriesIndicator from '@/components/charts/HiddenSeriesIndicator';

describe('HiddenSeriesIndicator', () => {
  it('renders nothing when no series are hidden', () => {
    renderWithMantine(
      <HiddenSeriesIndicator
        hiddenSeriesCount={0}
        renderedSeriesCount={100}
        onLoadAll={jest.fn()}
      />,
    );
    // No warning icon/button when nothing is hidden.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is a passive icon (not a button) without onLoadAll', () => {
    renderWithMantine(
      <HiddenSeriesIndicator
        hiddenSeriesCount={900}
        renderedSeriesCount={100}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a clickable load-all button and fires onLoadAll', async () => {
    const onLoadAll = jest.fn();
    renderWithMantine(
      <HiddenSeriesIndicator
        hiddenSeriesCount={900}
        renderedSeriesCount={100}
        onLoadAll={onLoadAll}
      />,
    );
    // aria-label reflects the total (rendered + hidden).
    const button = screen.getByRole('button', {
      name: /load all 1,000 series/i,
    });
    await userEvent.click(button);
    expect(onLoadAll).toHaveBeenCalledTimes(1);
  });

  it('states all series were loaded when the result was NOT capped', async () => {
    renderWithMantine(
      <HiddenSeriesIndicator
        hiddenSeriesCount={900}
        renderedSeriesCount={100}
        rowCount={1234}
        resultWasCapped={false}
      />,
    );
    // Mantine renders the tooltip label into the DOM on hover.
    await userEvent.hover(screen.getByTestId('hidden-series-indicator-icon'));
    expect(
      await screen.findByText(/All 1,000 series were loaded/i),
    ).toBeInTheDocument();
    // Row count is surfaced as secondary detail.
    expect(screen.getByText(/from 1,234 rows/i)).toBeInTheDocument();
  });

  it('does NOT claim all series were loaded when the result WAS capped', async () => {
    renderWithMantine(
      <HiddenSeriesIndicator
        hiddenSeriesCount={900}
        renderedSeriesCount={100}
        resultWasCapped
      />,
    );
    await userEvent.hover(screen.getByTestId('hidden-series-indicator-icon'));
    const tip = await screen.findByText(/loaded \(capped\) result/i);
    expect(tip).toBeInTheDocument();
    // The contradicting "all ... were loaded" claim must be absent.
    expect(tip.textContent).not.toMatch(/series were loaded/i);
  });
});
