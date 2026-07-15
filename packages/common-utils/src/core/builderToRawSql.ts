import SqlString from 'sqlstring';

import { Metadata } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import {
  convertToCategoricalChartConfig,
  convertToNumberChartConfig,
  convertToTableChartConfig,
} from '@/core/utils';
import { isBuilderChartConfig } from '@/guards';
import { format } from '@/sqlFormatter';
import {
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  DisplayType,
} from '@/types';

/** Display types that support raw-SQL chart configs. */
const RAW_SQL_DISPLAY_TYPES = new Set<DisplayType>([
  DisplayType.Table,
  DisplayType.Line,
  DisplayType.StackedBar,
  DisplayType.Pie,
  DisplayType.Bar,
  DisplayType.Number,
]);

/**
 * Inlines any remaining ChSql query params (e.g. LIMIT/OFFSET values) into
 * the SQL text with type-appropriate quoting. `parameterizedQueryToSql` is
 * not suitable here — it splices values in raw, dropping quotes.
 */
function inlineParams(sql: string, params: Record<string, any>): string {
  return sql.replace(
    /\{(HYPERDX_PARAM_\d+):(\w+)\}/g,
    (match, key: string, type: string) => {
      // eslint-disable-next-line security/detect-object-injection
      const value = params[key];
      if (value === undefined) {
        throw new Error(`Unbound query param ${match} in SQL template`);
      }
      if (type === 'Identifier') {
        return `\`${String(value).replaceAll('`', '\\`')}\``;
      }
      if (type === 'String') {
        return SqlString.escape(String(value));
      }
      return String(value);
    },
  );
}

function tryFormatSqlTemplate(sql: string): string {
  try {
    return format(sql);
  } catch {
    return sql;
  }
}

/**
 * Result of {@link renderBuilderConfigAsSqlTemplate}: either the generated SQL
 * template, or a user-facing reason the config can't be converted.
 */
export type RenderedSqlTemplate =
  | { isError: false; sql: string }
  | { isError: true; error: string };

/**
 * Renders a builder chart config as a raw-SQL template string using the
 * dynamic template macros ($__fromTime_ms, $__toTime_ms, $__timeInterval,
 * $__sourceTable, $__filters) in place of bound date/interval/table values.
 *
 * On success returns `{ sql }`. When the config can't be represented as a
 * single raw-SQL chart it returns `{ error }` with a user-facing reason —
 * non-builder configs, multi-series or non-time-series metric charts, string
 * selects (Search / EventPatterns), display types without raw-SQL support, or
 * a missing source — so callers can surface the message without re-deriving it.
 */
export async function renderBuilderConfigAsSqlTemplate(
  config: ChartConfigWithOptDateRange,
  metadata: Metadata,
): Promise<RenderedSqlTemplate> {
  if (!isBuilderChartConfig(config) || typeof config.select === 'string') {
    return {
      isError: true,
      error: 'This chart type cannot be auto-converted to SQL.',
    };
  }

  // Metric charts render one query per series (see splitChartConfigs), so only
  // single-series metric charts can be converted to a single raw-SQL query.
  const isMetric = config.metricTables != null;
  if (isMetric && Array.isArray(config.select) && config.select.length > 1) {
    return {
      isError: true,
      error: 'Multi-series metric charts cannot be auto-converted to SQL.',
    };
  }

  // A concrete source table is required for non-metric charts; metric charts
  // resolve their table from metricTables via the $__sourceTable(metricType)
  // macro, so they only need the database.
  if (!config.from?.databaseName || (!isMetric && !config.from?.tableName)) {
    return {
      isError: true,
      error: 'Auto-converting to SQL requires a source to be selected.',
    };
  }

  const displayType = config.displayType ?? DisplayType.Line;
  if (!RAW_SQL_DISPLAY_TYPES.has(displayType)) {
    return {
      isError: true,
      error: 'This chart type cannot be auto-converted to SQL.',
    };
  }

  // The intervalSeconds param behind $__timeInterval is only bound for
  // time-series display types (QUERY_PARAMS_BY_DISPLAY_TYPE), so only those
  // keep a granularity; its concrete value is resolved at query time.
  const isTimeSeries =
    displayType === DisplayType.Line || displayType === DisplayType.StackedBar;

  // Metric queries time-bucket inside their CTEs and therefore need the
  // interval macros that only time-series display types bind, so metric
  // conversion is restricted to time-series charts.
  if (isMetric && !isTimeSeries) {
    return {
      isError: true,
      error:
        'Metric charts can only be auto-converted to SQL for time series display types.',
    };
  }

  // Apply the same per-display-type transform the chart itself runs so the
  // template's query shape (LIMIT / ORDER BY / dropped group-by) matches the
  // live query. Time-series (line/stacked bar) is intentionally handled inline via the
  // granularity/date macros below rather than convertToTimeChartConfig, which
  // resolves granularity and the date range to concrete values (and adds a
  // live-query-only LIMIT) — the opposite of what a reusable template needs.
  const templateConfig: ChartConfigWithDateRange = {
    ...config,
    dateRange: [new Date(0), new Date(0)],
  };
  const renderConfig =
    displayType === DisplayType.Pie || displayType === DisplayType.Bar
      ? convertToCategoricalChartConfig(templateConfig)
      : displayType === DisplayType.Number
        ? convertToNumberChartConfig(templateConfig)
        : displayType === DisplayType.Table
          ? convertToTableChartConfig(templateConfig)
          : config;

  const rendered = await renderChartConfig(
    {
      ...renderConfig,
      displayType,
      dateRange: [new Date(0), new Date(0)],
      granularity: isTimeSeries ? (config.granularity ?? 'auto') : undefined,
      isRenderingRawSqlTemplate: true,
    },
    metadata,
    undefined,
  );

  const sql = inlineParams(rendered.sql, rendered.params);
  if (sql.includes('HYPERDX_PARAM_')) {
    throw new Error('Unsubstituted query param in generated SQL template');
  }

  return {
    isError: false,
    sql: tryFormatSqlTemplate(sql),
  };
}
