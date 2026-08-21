import React from 'react';
import { useForm } from 'react-hook-form';
import { MetricsDataType } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AggFnSelectControlled } from '@/components/AggFnSelect';

// Mantine's Combobox calls scrollIntoView when its dropdown opens; jsdom lacks it.
window.HTMLElement.prototype.scrollIntoView = jest.fn();

function Harness({
  metricType,
  hideCustom = true,
}: {
  metricType?: MetricsDataType;
  hideCustom?: boolean;
}) {
  const { control } = useForm({
    defaultValues: { aggFn: 'count', level: 0.95 },
  });
  return (
    <AggFnSelectControlled
      aggFnName="aggFn"
      quantileLevelName="level"
      defaultValue="count"
      control={control}
      hideCustom={hideCustom}
      metricType={metricType}
    />
  );
}

const openSelect = async () => {
  const input = screen.getByTestId('agg-fn-select');
  await userEvent.click(input);
};

describe('AggFnSelect', () => {
  it('shows the full aggregation list for gauge metrics', async () => {
    renderWithMantine(<Harness metricType={MetricsDataType.Gauge} />);
    await openSelect();

    expect(await screen.findByText('Count of Events')).toBeInTheDocument();
    expect(screen.getByText('Average')).toBeInTheDocument();
    expect(screen.getByText('Sum')).toBeInTheDocument();
    expect(screen.getByText('Maximum')).toBeInTheDocument();
    expect(screen.getByText('Minimum')).toBeInTheDocument();
    expect(screen.getByText('95th Percentile')).toBeInTheDocument();
  });

  it('shows the Increase option only for Sum metrics', async () => {
    renderWithMantine(<Harness metricType={MetricsDataType.Sum} />);
    await openSelect();

    expect(await screen.findByText('Increase')).toBeInTheDocument();
  });

  it('does not show Increase for gauge metrics', async () => {
    renderWithMantine(<Harness metricType={MetricsDataType.Gauge} />);
    await openSelect();

    await screen.findByText('Count of Events');
    expect(screen.queryByText('Increase')).not.toBeInTheDocument();
  });

  it.each([
    ['histogram', MetricsDataType.Histogram],
    ['exponential histogram', MetricsDataType.ExponentialHistogram],
  ])('hides unsupported aggregations for %s metrics', async (_label, type) => {
    renderWithMantine(<Harness metricType={type} />);
    await openSelect();

    // Supported for histogram metrics: count + quantiles.
    expect(await screen.findByText('Count of Events')).toBeInTheDocument();
    expect(screen.getByText('99th Percentile')).toBeInTheDocument();
    expect(screen.getByText('95th Percentile')).toBeInTheDocument();
    expect(screen.getByText('90th Percentile')).toBeInTheDocument();
    expect(screen.getByText('Median')).toBeInTheDocument();

    // Unsupported aggregations should be hidden.
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
    expect(screen.queryByText('Sum')).not.toBeInTheDocument();
    expect(screen.queryByText('Maximum')).not.toBeInTheDocument();
    expect(screen.queryByText('Minimum')).not.toBeInTheDocument();
    expect(screen.queryByText('Count Distinct')).not.toBeInTheDocument();
    expect(screen.queryByText('Any')).not.toBeInTheDocument();
    expect(screen.queryByText('Increase')).not.toBeInTheDocument();
  });
});
