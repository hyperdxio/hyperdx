import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HeatmapModeControl } from '@/components/DBEditTimeChartForm/HeatmapModeControl';

describe('HeatmapModeControl', () => {
  it('offers no histogram mode by default', () => {
    renderWithMantine(
      <HeatmapModeControl mode="distribution" onModeChange={jest.fn()} />,
    );
    expect(screen.getByRole('radio', { name: 'Series' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Histogram' })).toBeNull();
  });

  it('offers and selects histogram mode when allowed', async () => {
    const onModeChange = jest.fn();
    renderWithMantine(
      <HeatmapModeControl
        mode="distribution"
        onModeChange={onModeChange}
        allowHistogram
      />,
    );
    await userEvent.click(screen.getByText('Histogram'));
    expect(onModeChange).toHaveBeenCalledWith('histogram');
  });

  it.each([
    [false, ['Distribution', 'Series']],
    [true, ['Distribution', 'Series', 'Histogram']],
  ])(
    'explains each offered mode on hover (allowHistogram: %s)',
    async (allowHistogram, modes) => {
      renderWithMantine(
        <HeatmapModeControl
          mode="distribution"
          onModeChange={jest.fn()}
          allowHistogram={allowHistogram}
        />,
      );
      await userEvent.hover(screen.getByTestId('heatmap-mode-help'));
      const tooltip = await screen.findByRole('tooltip');
      for (const mode of modes) {
        expect(tooltip).toHaveTextContent(`${mode}:`);
      }
      expect(tooltip.textContent?.includes('Histogram:')).toBe(allowHistogram);
    },
  );
});
