import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import {
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  isBuilderChartConfig,
  isRawSqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithDateRange,
  resolveChartPaletteToken,
} from '@hyperdx/common-utils/dist/types';
import { Flex, Text } from '@mantine/core';

import {
  buildMVDateRangeIndicator,
  convertToNumberChartConfig,
} from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSingleSeriesNumberFormat, useSource } from '@/source';
import {
  formatNumber,
  getColorFromCSSToken,
  resolveConditionalColor,
} from '@/utils';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';
import NumberTileBackgroundChart from './NumberTileBackgroundChart';

const NUMBER_TILE_MIN_FONT_SIZE = 10;
const NUMBER_TILE_MAX_FONT_SIZE = 72;
// Initial / fallback font size used before the first measurement runs
// (and as a sensible mid-range size if measurement is unavailable).
// Tuned to look reasonable in a typical "default" tile (~6 columns wide
// on a 24-col grid) without overflowing.
const NUMBER_TILE_DEFAULT_FONT_SIZE = 36;
const NUMBER_TILE_PADDING = 12;

function fitFontSize(
  textEl: HTMLElement,
  availableWidth: number,
  availableHeight: number,
  minFontSize: number,
  maxFontSize: number,
): number {
  if (availableWidth <= 0 || availableHeight <= 0) {
    return minFontSize;
  }

  let lo = minFontSize;
  let hi = maxFontSize;
  let best = minFontSize;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    textEl.style.fontSize = `${mid}px`;
    if (
      textEl.scrollWidth <= availableWidth &&
      textEl.scrollHeight <= availableHeight
    ) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

// Plain centered rendering used as a fallback when AutoSizeNumber's
// measurement / ResizeObserver pipeline throws unexpectedly. Mirrors the
// pre-auto-size implementation so dashboards keep showing the value even
// if the resize logic encounters a runtime error.
function SimpleNumber({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <Flex align="center" justify="center" h="100%" style={{ flexGrow: 1 }}>
      <Text size="4rem" c={color}>
        {children}
      </Text>
    </Flex>
  );
}

// Renders the formatted number at the largest font size (between
// NUMBER_TILE_MIN_FONT_SIZE and NUMBER_TILE_MAX_FONT_SIZE) that fits the
// surrounding tile, recomputing whenever the tile resizes or the value
// changes. Prevents long values (large counts, currency, percentages)
// from overflowing small dashboard tiles.
function AutoSizeNumber({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const [fontSize, setFontSize] = useState<number>(
    NUMBER_TILE_DEFAULT_FONT_SIZE,
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    let raf: number | null = null;
    const recalc = () => {
      raf = null;
      if (!container || !textEl) return;
      const availW = container.clientWidth - NUMBER_TILE_PADDING * 2;
      const availH = container.clientHeight - NUMBER_TILE_PADDING * 2;
      const next = fitFontSize(
        textEl,
        availW,
        availH,
        NUMBER_TILE_MIN_FONT_SIZE,
        NUMBER_TILE_MAX_FONT_SIZE,
      );
      setFontSize(next);
    };

    recalc();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const ro = new ResizeObserver(() => {
      if (raf != null) return;
      raf = requestAnimationFrame(recalc);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [children]);

  return (
    <Flex
      ref={containerRef}
      align="center"
      justify="center"
      h="100%"
      w="100%"
      style={{
        flexGrow: 1,
        overflow: 'hidden',
        padding: NUMBER_TILE_PADDING,
      }}
    >
      <Text
        ref={textRef}
        c={color}
        style={{
          fontSize,
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </Text>
    </Flex>
  );
}

// Wraps AutoSizeNumber in an error boundary so a runtime failure in the
// measurement / ResizeObserver pipeline never blanks out the tile;
// instead the dashboard falls back to the original fixed-size rendering.
function SafeAutoSizeNumber({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <ErrorBoundary
      fallback={<SimpleNumber color={color}>{children}</SimpleNumber>}
    >
      <AutoSizeNumber color={color}>{children}</AutoSizeNumber>
    </ErrorBoundary>
  );
}

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
  const queriedConfig = useMemo(
    () =>
      isBuilderChartConfig(config)
        ? convertToNumberChartConfig(config)
        : config,
    [config],
  );

  const builderQueriedConfig = isBuilderChartConfig(queriedConfig)
    ? queriedConfig
    : undefined;
  const { data: mvOptimizationData } =
    useMVOptimizationExplanation(builderQueriedConfig);

  const { data, isLoading, isError, error } = useQueriedChartConfig(
    queriedConfig,
    {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig],
      enabled,
    },
  );

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

  const resolvedNumberFormat = useSingleSeriesNumberFormat(queriedConfig);

  const value = valueColumn
    ? data?.data?.[0]?.[valueColumn.name]
    : (Object.values(data?.data?.[0] ?? {})?.[0] ?? Number.NaN);
  const formattedValue = formatNumber(value as number, resolvedNumberFormat);

  const { data: source } = useSource({
    id: config.source,
  });

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
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {config.backgroundChart && (
            <NumberTileBackgroundChart
              config={config}
              backgroundChart={config.backgroundChart}
            />
          )}
          <div style={{ position: 'relative', zIndex: 1, height: '100%' }}>
            <SafeAutoSizeNumber color={tileColor}>
              {formattedValue ?? 'N/A'}
            </SafeAutoSizeNumber>
          </div>
        </div>
      )}
    </ChartContainer>
  );
}
