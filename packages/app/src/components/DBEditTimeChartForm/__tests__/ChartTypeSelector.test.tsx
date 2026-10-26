import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChartTypeSelector } from '@/components/DBEditTimeChartForm/ChartTypeSelector';

describe('ChartTypeSelector', () => {
  it('checks the option for the current display type', () => {
    renderWithMantine(
      <ChartTypeSelector value={DisplayType.Pie} onChange={jest.fn()} />,
    );

    expect(screen.getByRole('radio', { name: 'Pie' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Table' })).not.toBeChecked();
  });

  it('reports the picked display type', async () => {
    const onChange = jest.fn();
    renderWithMantine(
      <ChartTypeSelector value={DisplayType.Line} onChange={onChange} />,
    );

    await userEvent.click(screen.getByRole('radio', { name: 'Heatmap' }));

    expect(onChange).toHaveBeenCalledWith(DisplayType.Heatmap);
  });

  it('keeps a stacked variant when time series is picked again', async () => {
    const onChange = jest.fn();
    renderWithMantine(
      <ChartTypeSelector value={DisplayType.StackedBar} onChange={onChange} />,
    );

    const timeSeries = screen.getByRole('radio', { name: 'Time series' });
    expect(timeSeries).toBeChecked();
    await userEvent.click(timeSeries);

    expect(onChange).not.toHaveBeenCalled();
  });
});
