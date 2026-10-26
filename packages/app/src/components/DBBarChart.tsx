import cx from 'classnames';

import { BarChartView } from './charts/BarChartView';
import {
  CategoricalChartProps,
  useCategoricalChart,
} from './charts/CategoricalChart';
import ChartContainer from './charts/ChartContainer';
import ChartErrorState from './charts/ChartErrorState';

export const DBBarChart = (props: CategoricalChartProps) => {
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
    <ChartContainer title={props.title} toolbarItems={toolbarItems}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError && error ? (
        <ChartErrorState error={error} variant={props.errorVariant} />
      ) : responseFormatError ? (
        <ChartErrorState
          error={responseFormatError}
          variant={props.errorVariant}
        />
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
        <BarChartView
          data-testid="bar-chart-container"
          data={chartData}
          numberFormat={resolvedNumberFormat}
          className={isLoading || isPlaceholderData ? 'effect-pulse' : ''}
        />
      )}
    </ChartContainer>
  );
};
