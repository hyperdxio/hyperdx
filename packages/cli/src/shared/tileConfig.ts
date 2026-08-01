/**
 * Dashboard tile → queryable chart config resolution.
 *
 * @source packages/app/src/DBDashboardPage.tsx (Tile component's
 *   queriedConfig effect) and packages/app/src/ChartUtils.tsx
 *   (convertToTimeChartConfig / convertToNumberChartConfig /
 *   convertToTableChartConfig).
 *
 * The resulting configs are passed to
 * `clickhouseClient.queryChartConfig()` (common-utils), which renders
 * SQL via `renderChartConfig` — the exact same pipeline the web
 * frontend uses. Do NOT modify the resolution rules without checking
 * the web components first.
 */

import {
  convertDateRangeToGranularityString,
  convertToCategoricalChartConfig,
  getAlignedDateRange,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  displayTypeRequiresSource,
  isBuilderChartConfig,
  isBuilderSavedChartConfig,
  isPromqlSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import type {
  BuilderChartConfigWithDateRange,
  ChartConfigWithDateRange,
  ChartConfigWithOptTimestamp,
  Filter,
  MetricsDataType,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import type { SourceResponse } from '@/api/client';

/** Sort tiles in reading order: by grid y, then x (matches web layout). */
export function sortTilesForDisplay<T extends { x: number; y: number }>(
  tiles: T[],
): T[] {
  return [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
}

// ---- Source helpers ------------------------------------------------

/**
 * @source packages/app/src/utils.ts (getMetricTableName)
 */
export function getMetricTableName(
  source: SourceResponse,
  metricType?: string,
): string | undefined {
  if (metricType == null) {
    return source.from.tableName;
  }
  if (source.kind === 'metric') {
    return source.metricTables?.[metricType.toLowerCase() as MetricsDataType];
  }
  return undefined;
}

/**
 * @source packages/common-utils/src/types.ts (getSampleWeightExpression) —
 * re-implemented against the CLI's SourceResponse shape.
 */
function getSampleWeightExpression(source: SourceResponse): string | undefined {
  return source.kind === 'trace' && source.sampleRateExpression
    ? source.sampleRateExpression
    : undefined;
}

// ---- Tile config resolution ----------------------------------------

export type ResolvedTileConfig =
  | { ok: true; config: ChartConfigWithDateRange }
  | {
      ok: false;
      reason:
        | 'promql-unsupported'
        | 'source-missing'
        | 'source-unset'
        | 'connection-missing';
      message: string;
    };

/**
 * Merge a saved tile config with its source and the dashboard-level
 * date range / granularity / filters into a queryable chart config.
 *
 * Mirror of the web Tile component's `queriedConfig` effect
 * (packages/app/src/DBDashboardPage.tsx). Any config returned with
 * `ok: true` can be handed to `queryChartConfig` for SQL rendering.
 */
export function resolveTileConfig({
  config,
  source,
  dateRange,
  granularity,
  filters,
}: {
  config: SavedChartConfig;
  source: SourceResponse | undefined;
  dateRange: [Date, Date];
  granularity?: string;
  filters?: Filter[];
}): ResolvedTileConfig {
  // PromQL tiles query through the Prometheus REST API on the web —
  // not supported in the CLI yet.
  if (isPromqlSavedChartConfig(config)) {
    return {
      ok: false,
      reason: 'promql-unsupported',
      message: 'PromQL tiles are not supported in the CLI yet.',
    };
  }

  if (isRawSqlSavedChartConfig(config)) {
    // Some raw SQL charts don't have a source
    if (!config.source) {
      return {
        ok: true,
        config: { ...config, dateRange, granularity, filters },
      };
    }
    if (source == null) {
      return sourceMissing();
    }
    return {
      ok: true,
      config: {
        ...config,
        // Populate these columns from the source to support Lucene-based
        // filters and metric table macros
        implicitColumnExpression: source.implicitColumnExpression,
        useTextIndexForImplicitColumn: source.useTextIndexForImplicitColumn,
        from: source.from,
        metricTables: source.metricTables,
        ...(source.kind === 'log'
          ? { bodyExpression: source.bodyExpression }
          : {}),
        sampleWeightExpression: getSampleWeightExpression(source),
        dateRange,
        granularity,
        filters,
      },
    };
  }

  if (isBuilderSavedChartConfig(config)) {
    // Markdown tiles render static content without querying and are
    // short-circuited in fetchTileData — they never reach this branch.
    if (!displayTypeRequiresSource(config.displayType)) {
      return {
        ok: false,
        reason: 'source-unset',
        message: `"${config.displayType}" tiles do not query a source.`,
      };
    }
    if (!config.source) {
      return {
        ok: false,
        reason: 'source-unset',
        message:
          'The data source for this tile is not set. Edit the tile in the web UI to select a data source.',
      };
    }
    if (source == null) {
      return sourceMissing();
    }

    const isMetricSource = source.kind === 'metric';

    // TODO: will need to update this when we allow for multiple metrics per chart
    const firstSelect = Array.isArray(config.select)
      ? config.select[0]
      : undefined;
    const metricType =
      isMetricSource && typeof firstSelect !== 'string'
        ? firstSelect?.metricType
        : undefined;
    const tableName = getMetricTableName(source, metricType);
    if (!source.connection) {
      return {
        ok: false,
        reason: 'connection-missing',
        message: 'The data source for this tile has no connection configured.',
      };
    }

    const isLogOrTrace = source.kind === 'log' || source.kind === 'trace';

    return {
      ok: true,
      config: {
        ...config,
        connection: source.connection,
        dateRange,
        granularity,
        timestampValueExpression: source.timestampValueExpression ?? '',
        from: {
          databaseName: source.from?.databaseName || 'default',
          tableName: tableName || '',
        },
        implicitColumnExpression: isLogOrTrace
          ? source.implicitColumnExpression
          : undefined,
        useTextIndexForImplicitColumn: isLogOrTrace
          ? source.useTextIndexForImplicitColumn
          : undefined,
        bodyExpression:
          source.kind === 'log' ? source.bodyExpression : undefined,
        sampleWeightExpression: getSampleWeightExpression(source),
        filters,
        metricTables: isMetricSource ? source.metricTables : undefined,
      },
    };
  }

  // Should be unreachable — SavedChartConfig is a closed union.
  return {
    ok: false,
    reason: 'source-unset',
    message: 'Unsupported tile configuration.',
  };

  function sourceMissing(): ResolvedTileConfig {
    return {
      ok: false,
      reason: 'source-missing',
      message:
        'The data source for this tile no longer exists. Edit the tile in the web UI to select a new source.',
    };
  }
}

// ---- Per-displayType config transforms -----------------------------

/**
 * Parse a user-supplied granularity ("auto" or "<n> second|minute|hour|day").
 *
 * Returns `{ granularity: undefined }` for "auto" (letting the pipeline
 * pick), the normalized interval for valid input, or null for anything
 * else. Units beyond day (week/month/…) are rejected because the
 * response-shaping pipeline (convertGranularityToSeconds /
 * toStartOfInterval, mirroring the web) does not support them — the web
 * UI only offers second/minute/hour/day granularities too.
 */
export function parseGranularityFlag(
  value: string,
): { granularity: string | undefined } | null {
  const trimmed = value.trim();
  if (trimmed === 'auto') return { granularity: undefined };
  return /^[1-9]\d* (second|minute|hour|day)$/.test(trimmed)
    ? { granularity: trimmed }
    : null;
}

/**
 * @source packages/app/src/ChartUtils.tsx (getTimeChartGranularity)
 *
 * `maxBuckets` defaults to 80 to match the web. CLI callers may pass a
 * smaller value so 1 bucket ≈ 1 terminal column.
 */
function getTimeChartGranularity(
  granularity: string | undefined,
  dateRange: [Date, Date],
  maxBuckets = 80,
): string {
  return granularity === 'auto' || granularity == null
    ? convertDateRangeToGranularityString(dateRange, maxBuckets)
    : granularity;
}

/**
 * @source packages/app/src/ChartUtils.tsx (convertToTimeChartConfig)
 */
export function convertToTimeChartConfig(
  config: ChartConfigWithDateRange,
  maxBuckets = 80,
): ChartConfigWithDateRange {
  // Series capping is opt-in per tile via the chart's Display Settings; when
  // unset, no __hdx_series_limit CTE is emitted and every series is fetched.
  const seriesLimit = isBuilderChartConfig(config)
    ? config.seriesLimit != null
      ? Math.max(1, config.seriesLimit)
      : undefined
    : undefined;

  const granularity = getTimeChartGranularity(
    config.granularity,
    config.dateRange,
    maxBuckets,
  );

  const dateRange =
    config.alignDateRangeToGranularity === false
      ? config.dateRange
      : getAlignedDateRange(config.dateRange, granularity);

  // When the range is bucket-aligned, the end is the start of the next bucket,
  // so end-exclusive is required to avoid double-counting boundary events.
  // When alignment is off the end is the user's exact selection, so fall back
  // to the caller's setting, if there is one.
  const isAligned = config.alignDateRangeToGranularity !== false;
  const dateRangeEndInclusive = isAligned
    ? false
    : (config.dateRangeEndInclusive ?? false);

  return isBuilderChartConfig(config)
    ? {
        ...config,
        dateRange,
        dateRangeEndInclusive,
        granularity,
        limit: { limit: 100000 },
        // Overwrite (not conditionally spread) so a cleared `null` from the
        // source config is normalized to undefined rather than carried over.
        seriesLimit,
      }
    : {
        ...config,
        dateRangeEndInclusive,
        dateRange,
        granularity,
      };
}

/**
 * @source packages/app/src/ChartUtils.tsx (convertToNumberChartConfig)
 */
export function convertToNumberChartConfig(
  config: ChartConfigWithDateRange,
): ChartConfigWithDateRange {
  if (!isBuilderChartConfig(config)) return config;
  const { granularity: _g, groupBy: _gb, ...rest } = config;
  return rest as ChartConfigWithDateRange;
}

/**
 * @source packages/app/src/ChartUtils.tsx (convertToTableChartConfig)
 */
export function convertToTableChartConfig(
  config: ChartConfigWithDateRange,
): ChartConfigWithDateRange {
  if (!isBuilderChartConfig(config)) return config;

  const { granularity: _g, ...rest } = config;
  const convertedConfig = structuredClone(
    rest,
  ) as BuilderChartConfigWithDateRange;

  // Set a default limit if not already set
  if (!convertedConfig.limit) {
    convertedConfig.limit = { limit: 200 };
  }

  // Set a default orderBy if groupBy is set but orderBy is not,
  // so that the set of rows within the limit is stable.
  if (
    convertedConfig.groupBy &&
    typeof convertedConfig.groupBy === 'string' &&
    !convertedConfig.orderBy
  ) {
    convertedConfig.orderBy = convertedConfig.groupBy;
  }

  return convertedConfig;
}

/**
 * Apply the per-displayType config transform the matching web chart
 * component would apply before querying:
 *
 * - line / stacked_bar → DBTimeChart → convertToTimeChartConfig
 * - number → DBNumberChart → convertToNumberChartConfig
 * - table → DBTableChart → convertToTableChartConfig
 * - pie / bar → CategoricalChart → convertToCategoricalChartConfig
 */
export function convertTileConfigForQuery(
  config: ChartConfigWithDateRange,
  { maxTimeBuckets = 80 }: { maxTimeBuckets?: number } = {},
): ChartConfigWithDateRange {
  switch (config.displayType) {
    case DisplayType.Line:
    case DisplayType.StackedBar:
      return convertToTimeChartConfig(config, maxTimeBuckets);
    case DisplayType.Number:
      return convertToNumberChartConfig(config);
    case DisplayType.Table:
      return convertToTableChartConfig(config);
    case DisplayType.Pie:
    case DisplayType.Bar:
      // Raw SQL configs pass through untouched (matches CategoricalChart)
      return isBuilderChartConfig(config)
        ? (convertToCategoricalChartConfig(config) as ChartConfigWithDateRange &
            typeof config)
        : config;
    default:
      return config;
  }
}

/**
 * Display types the CLI can render. Others get a placeholder.
 */
export const CLI_SUPPORTED_DISPLAY_TYPES: ReadonlySet<DisplayType> = new Set([
  DisplayType.Line,
  DisplayType.StackedBar,
  DisplayType.Number,
  DisplayType.Table,
  DisplayType.Pie,
  DisplayType.Bar,
  DisplayType.Markdown,
]);
