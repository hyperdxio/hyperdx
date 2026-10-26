import { useMemo } from 'react';
import cx from 'classnames';
import {
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
  isRawSqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithDateRange,
  resolveChartPaletteToken,
} from '@hyperdx/common-utils/dist/types';

import {
  buildMVDateRangeIndicator,
  convertToNumberChartConfig,
  convertToReducedPromqlChartConfig,
} from '@/ChartUtils';
import {
  getMinGranularitySeconds,
  useQueriedChartConfig,
} from '@/hooks/useChartConfig';
import { useLocalChartQuery } from '@/hooks/useLocalChartQuery';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useResultTransform } from '@/hooks/useResultTransform';
import { useSingleSeriesNumberFormat, useSource } from '@/source';
import {
  formatNumber,
  getColorFromCSSToken,
  resolveConditionalColor,
} from '@/utils';

import { SafeAutoSizeNumber } from './charts/AutoSizeNumber';
import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import MultipleValuesIndicator from './charts/MultipleValuesIndicator';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';
import NumberTileBackgroundChart from './NumberTileBackgroundChart';

export default function DBNumberChart({
  config,
  enabled = true,
  queryKeyPrefix,
  title,
  toolbarPrefix,
  toolbarSuffix,
  showMVOptimizationIndicator = true,
  errorVariant,
}: {
  config: ChartConfigWithDateRange;
  queryKeyPrefix?: string;
  enabled?: boolean;
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  showMVOptimizationIndicator?: boolean;
  errorVariant?: ChartErrorStateVariant;
}) {
  const { data: source } = useSource({
    id: config.source,
  });
  const minGranularitySeconds = getMinGranularitySeconds(source);

  const queriedConfig = useMemo(() => {
    if (isBuilderChartConfig(config)) return convertToNumberChartConfig(config);
    if (isPromqlChartConfig(config)) {
      return convertToReducedPromqlChartConfig({
        ...config,
        minGranularitySeconds,
      });
    }
    return config;
  }, [config, minGranularitySeconds]);

  const builderQueriedConfig = isBuilderChartConfig(queriedConfig)
    ? queriedConfig
    : undefined;
  const { data: mvOptimizationData } =
    useMVOptimizationExplanation(builderQueriedConfig);

  const local = useLocalChartQuery(config, {
    kind: 'number',
    queryKeyPrefix,
    enabled,
  });
  const remote = useQueriedChartConfig(queriedConfig, {
    placeholderData: (prev: any) => prev,
    queryKeyPrefix,
    enabled: enabled && !local.active,
  });
  const { data, isLoading, isError, error, isPlaceholderData } =
    useResultTransform(local.active ? local : remote, config.transformSql);

  // The value is the first numeric value in the first row of the result
  const valueColumn = data?.meta
    ? filterColumnMetaByType(data?.meta, [JSDataType.Number])?.[0]
    : undefined;
  const resultError =
    data && !valueColumn && isRawSqlChartConfig(queriedConfig)
      ? new Error(
          `No numeric columns found in result column metadata. Make sure a numeric column exists in the result set.\n\nResult Metadata: ${JSON.stringify(data.meta)}`,
        )
      : error;

  // The reducer leaves one row per series.
  const promqlSeriesCount = isPromqlChartConfig(queriedConfig)
    ? (data?.data?.length ?? 0)
    : 0;

  // Several series leave the value ambiguous (see the warning) and the tile
  // shows whichever came first, so a trend behind it would mislead. Whether
  // the config can be bucketed at all is the sparkline's own call.
  const showSparkline =
    config.backgroundChart != null && promqlSeriesCount <= 1;

  const resolvedNumberFormat = useSingleSeriesNumberFormat(queriedConfig);

  const value = valueColumn
    ? data?.data?.[0]?.[valueColumn.name]
    : (Object.values(data?.data?.[0] ?? {})?.[0] ?? Number.NaN);
  const formattedValue = formatNumber(value as number, resolvedNumberFormat);

  // Resolve the display color in three layers:
  //   1. Conditional color rules evaluated against the raw value
  //      (last-match-wins, Grafana threshold semantics). Falls through
  //      when no rule matches.
  //   2. Static tile color from `config.color`, run through
  //      `resolveChartPaletteToken` so legacy `chart-1`..`chart-10`
  //      stored values from pre-#2362 saves still resolve to the right
  //      hue. The fetch-path `normalizeDashboardTileColors` already
  //      heals stored data, but this guards in-memory tile configs that
  //      bypass the fetch normalizer.
  //   3. Default text color when nothing else resolves.
  //
  // The raw value (pre-format) is used so rules match on the actual data
  // value, not the formatted string. ClickHouse returns UInt64 counts as
  // strings over JSON (output_format_json_quote_64bit_integers=1), so
  // coerce string values to numbers when possible so numeric operators
  // match correctly.
  // Re-use the already-computed `value`; the `?? Number.NaN` fallback there
  // is for `formatNumber`'s sake, the coercion IIFE below treats undefined
  // and NaN as "no value" so the rules short-circuit to the fallback color.
  const rawValueRaw =
    typeof value === 'number' && Number.isNaN(value)
      ? undefined
      : (value as number | string | undefined);

  const rawValue: number | string | null | undefined = (() => {
    if (rawValueRaw == null) return rawValueRaw;
    if (typeof rawValueRaw === 'number') return rawValueRaw;
    const n = Number(rawValueRaw);
    return Number.isFinite(n) ? n : rawValueRaw;
  })();

  const resolvedToken = resolveConditionalColor(
    rawValue ?? null,
    config.colorRules,
    resolveChartPaletteToken(config.color),
  );

  const tileColor = resolvedToken
    ? getColorFromCSSToken(resolvedToken)
    : undefined;

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (promqlSeriesCount > 1) {
      allToolbarItems.push(
        <MultipleValuesIndicator
          key="db-number-chart-multiple-values"
          seriesCount={promqlSeriesCount}
          multipleSeriesHint="Aggregate the expression, for example with sum() or sum by (...), to return a single series."
        />,
      );
    }

    if (source && showMVOptimizationIndicator && builderQueriedConfig) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-number-chart-mv-indicator"
          config={builderQueriedConfig}
          source={source}
          variant="icon"
        />,
      );
    }

    const dateRangeIndicator = buildMVDateRangeIndicator({
      mvOptimizationData,
      originalDateRange: queriedConfig.dateRange,
    });

    if (dateRangeIndicator) {
      allToolbarItems.push(dateRangeIndicator);
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [
    toolbarPrefix,
    toolbarSuffix,
    source,
    showMVOptimizationIndicator,
    mvOptimizationData,
    queriedConfig,
    builderQueriedConfig,
    promqlSeriesCount,
  ]);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError ? (
        <ChartErrorState error={error} variant={errorVariant} />
      ) : resultError ? (
        <ChartErrorState error={resultError} variant={errorVariant} />
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
        <div
          className={isLoading || isPlaceholderData ? 'effect-pulse' : ''}
          style={{ position: 'relative', width: '100%', height: '100%' }}
        >
          {showSparkline && config.backgroundChart && (
            <NumberTileBackgroundChart
              config={config}
              backgroundChart={config.backgroundChart}
              queryKeyPrefix={queryKeyPrefix}
              enabled={enabled}
            />
          )}
          <div style={{ position: 'relative', zIndex: 1, height: '100%' }}>
            <SafeAutoSizeNumber
              color={tileColor}
              data-testid="number-chart-value"
            >
              {formattedValue ?? 'N/A'}
            </SafeAutoSizeNumber>
          </div>
        </div>
      )}
    </ChartContainer>
  );
}
