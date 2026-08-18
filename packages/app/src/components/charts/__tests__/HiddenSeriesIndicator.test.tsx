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
});
