/**
 * Tile content rendering — turns a tile query result into an ANSI
 * string for the given display type. Mirror of the web Tile's
 * `renderChartContent` dispatch (packages/app/src/DBDashboardPage.tsx),
 * shared by the interactive TUI and the `hdx chart` command.
 */

import chalk from 'chalk';

import { isRatioChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import type { SQLInterval } from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import type { SourceResponse } from '@/api/client';
import {
  deriveTableColumns,
  formatResponseForCategoricalChart,
  formatResponseForTimeChart,
  getNumberChartValue,
  shouldFillNullsWithZero,
} from '@/shared/chartData';
import {
  axisTickFormatter,
  formatNumber,
  resolveChartNumberFormats,
  resolveSingleSeriesNumberFormat,
} from '@/shared/formatNumber';
import type { TileQueryResult } from '@/shared/tileQuery';
import {
  defaultFormatValue,
  renderCategoricalChart,
  renderLineChart,
  renderMarkdown,
  renderNumberChart,
  renderStackedBarChart,
  renderTableChart,
} from '@/termchart';

export interface RenderTileContentParams {
  result: TileQueryResult;
  source: SourceResponse | undefined;
  width: number;
  height: number;
}

/**
 * Render a tile query result as an ANSI string sized to width × height.
 */
export function renderTileContent({
  result,
  source,
  width,
  height,
}: RenderTileContentParams): string {
  if (result.status === 'markdown') {
    return renderMarkdown(result.markdown, width);
  }
  if (result.status === 'unsupported') {
    return chalk.dim(result.message);
  }
  if (result.status === 'unresolved') {
    return chalk.yellow(result.resolution.message);
  }

  const { queriedConfig, data } = result;
  const displayType = queriedConfig.displayType ?? DisplayType.Line;

  if (data.data.length === 0) {
    return chalk.dim('No data found within time range.');
  }

  switch (displayType) {
    case DisplayType.Line:
    case DisplayType.StackedBar: {
      const timeChartData = formatResponseForTimeChart({
        response: data,
        dateRange: queriedConfig.dateRange,
        granularity: queriedConfig.granularity as SQLInterval | undefined,
        generateEmptyBuckets: shouldFillNullsWithZero(queriedConfig.fillNulls),
        source,
      });
      const { chartFormat } = resolveChartNumberFormats(
        queriedConfig,
        source,
        data.meta,
      );
      const renderFn =
        displayType === DisplayType.StackedBar
          ? renderStackedBarChart
          : renderLineChart;
      const chart = renderFn({
        data: timeChartData,
        width,
        height,
        formatTick: axisTickFormatter(chartFormat),
      });
      // The web overlays a dashed previous-period series; the CLI's
      // chartData port intentionally drops it — call it out rather
      // than silently ignoring the setting.
      const comparesPrevious =
        'compareToPreviousPeriod' in queriedConfig &&
        queriedConfig.compareToPreviousPeriod === true;
      return comparesPrevious
        ? `${chart}\n${chalk.dim('(previous-period comparison not shown in the CLI)')}`
        : chart;
    }

    case DisplayType.Number: {
      return renderNumberChart({
        text: formatNumber(
          getNumberChartValue(data),
          resolveSingleSeriesNumberFormat(queriedConfig, source),
        ),
        width,
        height,
      });
    }

    case DisplayType.Table: {
      const isBuilder = isBuilderChartConfig(queriedConfig);
      const selectLength =
        isBuilder && Array.isArray(queriedConfig.select)
          ? queriedConfig.select.length
          : undefined;
      const isRatio =
        isBuilder && Array.isArray(queriedConfig.select)
          ? isRatioChartConfig(queriedConfig.select, queriedConfig)
          : false;
      const columns = deriveTableColumns({
        rows: data.data,
        selectLength,
        isRatio,
        groupByColumnsOnLeft: isBuilder
          ? queriedConfig.groupByColumnsOnLeft
          : false,
      });
      const { formatByColumn } = resolveChartNumberFormats(
        queriedConfig,
        source,
        data.meta,
      );
      return renderTableChart({
        rows: data.data,
        columns,
        width,
        height,
        formatNumericCell: (dataKey, value) => {
          const nf = formatByColumn.get(dataKey) ?? queriedConfig.numberFormat;
          return nf ? formatNumber(value, nf) : defaultFormatValue(value);
        },
      });
    }

    case DisplayType.Pie:
    case DisplayType.Bar: {
      const entries = formatResponseForCategoricalChart(data);
      const numberFormat = resolveSingleSeriesNumberFormat(
        queriedConfig,
        source,
      );
      return renderCategoricalChart({
        entries,
        width,
        height,
        formatValue: numberFormat
          ? value => formatNumber(value, numberFormat)
          : undefined,
        showPercentages: displayType === DisplayType.Pie,
      });
    }

    default:
      return chalk.dim(
        `"${displayType}" tiles are not supported in the CLI yet.`,
      );
  }
}
