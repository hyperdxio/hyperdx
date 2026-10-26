import cx from 'classnames';

import {
  CategoricalChartProps,
  useCategoricalChart,
} from './charts/CategoricalChart';
import ChartContainer from './charts/ChartContainer';
import ChartErrorState from './charts/ChartErrorState';
import { PieChartView } from './charts/PieChartView';

export const DBPieChart = (props: CategoricalChartProps) => {
  const { title, errorVariant } = props;
  const {
    resolvedNumberFormat,
    toolbarItems,
    data,
    isLoading,
    isPlaceholderData,
    isError,
    error,
    chartData,
    responseFormatError,
  } = useCategoricalChart(props);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItems}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError && error ? (
        <ChartErrorState error={error} variant={errorVariant} />
      ) : responseFormatError ? (
        <ChartErrorState error={responseFormatError} variant={errorVariant} />
      ) : data?.data.length === 0 ? (
        <div
          className={cx(
            'd-flex h-100 w-100 align-items-center justify-content-center text-muted',
            { 'effect-pulse': isPlaceholderData },
          )}
        >
          No data found within time range.
        </div>
      ) : (
        <PieChartView
          data-testid="pie-chart-container"
          data={chartData}
          numberFormat={resolvedNumberFormat}
          // Pulse the pie and its legend together: the legend shows values too
          className={isLoading || isPlaceholderData ? 'effect-pulse' : ''}
        />
      )}
    </ChartContainer>
  );
};
