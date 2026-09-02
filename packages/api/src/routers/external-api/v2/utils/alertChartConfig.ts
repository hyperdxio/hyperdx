import {
  AggregateFunctionSchema,
  AlertChartConfig,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';

import { AlertDocument, AlertSource, IAlert } from '@/models/alert';
import {
  ExternalAlert,
  translateAlertDocumentToExternalAlert,
} from '@/utils/externalApi';
import logger from '@/utils/logger';
import {
  externalAlertBuilderChartConfigSchema,
  ExternalAlertChartConfig,
  externalAlertRawSqlChartConfigSchema,
  externalQuantileLevelSchema,
} from '@/utils/zod';

import {
  convertToExternalTileChartConfig,
  convertToInternalTileConfig,
} from './dashboards';

/**
 * Converts an inline alert's external-dialect chart config (the tile-config
 * dialect v2 dashboards use: `sourceId`, per-select `where`, `asRatio`,
 * `connectionId` + `sqlTemplate`) into the internal AlertChartConfig shape the
 * alert document persists and the check-alerts task evaluates.
 *
 * Reuses the dashboard tile converter through a synthetic tile so the two
 * surfaces cannot drift on field mapping (`where` -> `aggCondition`,
 * `asRatio` -> `seriesReturnType`, `connectionId` -> `connection`, fillNulls
 * defaulting, ...). Layout fields are placeholders — only `config` is kept.
 * The alert-only fields the tile dialect lacks (`name`, chart-level
 * `where`/`whereLanguage`) are threaded through on top.
 */
export function convertExternalAlertChartConfigToInternal(
  external: ExternalAlertChartConfig,
): AlertChartConfig {
  const { config } = convertToInternalTileConfig({
    id: '',
    // The tile converter persists the tile's name into the config, which is
    // exactly where an alert's config name lives.
    name: external.name ?? '',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    config: external,
  });
  // The converter never emits a PromQL variant or an embedded `alert` for the
  // display types the alert schema admits, so dropping `alert` yields a valid
  // AlertChartConfig.
  const internal = omit(config, ['alert']) as AlertChartConfig;
  if (!external.name) {
    // Synthetic-tile artifact: the converter wrote name: ''.
    delete internal.name;
  }
  if (!('configType' in external) && !('configType' in internal)) {
    // The tile converter hardcodes where: '' (the tile dialect has no
    // chart-level filter); the alert dialect does, so apply it.
    if (external.where) {
      internal.where = external.where;
      internal.whereLanguage = external.whereLanguage ?? 'lucene';
    }
  }
  return internal;
}

const EXTERNAL_ALERT_DISPLAY_TYPES = [
  DisplayType.Line,
  DisplayType.StackedBar,
  DisplayType.Number,
] as const;

type ExternalAlertDisplayType = (typeof EXTERNAL_ALERT_DISPLAY_TYPES)[number];

/**
 * External dialect spelling -> internal spelling for top-level config keys.
 * Exported for the schema drift-guard test.
 */
export const EXTERNAL_TO_INTERNAL_KEY: Record<string, string> = {
  sourceId: 'source',
  connectionId: 'connection',
  asRatio: 'seriesReturnType',
};

/**
 * Internal fields the external round-trip drops but which have no effect on
 * how the check-alerts task evaluates the config (render/UI-only concerns).
 * Losing them on an external GET -> PUT does not change alert behavior.
 * Exported for the schema drift-guard test.
 */
export const EVALUATION_INERT_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'markdown',
  // Only meaningful together with `filters`, which is itself lossy.
  'filtersLogicalOperator',
  'groupByColumnsOnLeft',
  'color',
  'colorRules',
  'backgroundChart',
  'compareToPreviousPeriod',
  'fitYAxisToData',
  'onClick',
  'alternateRowBackground',
  // Client-side null-bucket rendering; the alert task ignores it.
  'fillNulls',
  // Evaluation-relevant only with a groupBy, which (on variants whose shape
  // lacks seriesLimit, i.e. number) is itself refused when present.
  'seriesLimit',
]);

/**
 * Internal fields that DO affect evaluation and that the external dialect
 * cannot express. A non-empty value on any of these makes the config
 * unrepresentable, so the GET response omits chartConfig and a blind echo-PUT
 * fails loudly ("chartConfig is required") instead of silently rewriting the
 * alert's query. Exported for the schema drift-guard test, which asserts every
 * field of the internal AlertChartConfigSchema is deliberately classified.
 */
export const KNOWN_LOSSY_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'filters',
  'having',
  'havingLanguage',
  'orderBy',
  'limit',
  'ratioMode',
  'selectGroupBy',
  'granularity',
  'implicitColumnExpression',
  'sampleWeightExpression',
  'eventTableSelect',
  'bodyExpression',
  'useTextIndexForImplicitColumn',
  'metricTables',
]);

/** Select-item fields the external dialect round-trips. */
const REPRESENTABLE_SELECT_ITEM_KEYS: ReadonlySet<string> = new Set([
  'aggFn',
  'aggCondition',
  'aggConditionLanguage',
  'valueExpression',
  'alias',
  'level',
  'metricType',
  'metricName',
  'numberFormat',
  'isDelta',
]);

/**
 * Select-item fields that are inert on line/stacked_bar/number charts
 * (heatmap- or table-cell-only affordances) and may be dropped.
 */
const EVALUATION_INERT_SELECT_ITEM_KEYS: ReadonlySet<string> = new Set([
  'color',
  'colorRules',
  'countExpression',
  'heatmapScaleType',
]);

const isEmptyValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/** Values equivalent to the field being absent. */
const isDefaultValue = (key: string, value: unknown): boolean => {
  switch (key) {
    case 'seriesReturnType':
      return value === 'column';
    case 'whereLanguage':
    case 'aggConditionLanguage':
    case 'havingLanguage':
      return value === 'lucene';
    default:
      // Persisted boolean flags are off-by-default; fillNulls (number|false)
      // is evaluation-inert and classified above, so `false` here only ever
      // describes a flag in its default state.
      return value === false;
  }
};

const EXTERNAL_ALERT_WHERE_MAX = 10000;

/**
 * Whether the persisted internal config survives an external GET -> PUT
 * round-trip without changing what the alert evaluates. Anything not
 * expressible in the external dialect (and not evaluation-inert) makes the
 * config unrepresentable. Allowlist semantics: unknown future fields refuse
 * by default rather than leaking through silently.
 */
function isRepresentableExternally(
  config: AlertChartConfig,
  displayType: ExternalAlertDisplayType,
): boolean {
  const isRawSql = 'configType' in config && config.configType === 'sql';
  const memberSchema = (
    isRawSql
      ? externalAlertRawSqlChartConfigSchema
      : externalAlertBuilderChartConfigSchema
  ).optionsMap.get(displayType);
  if (memberSchema == null) {
    return false;
  }
  // The representable set is derived from the external member schema itself,
  // so it cannot drift when the external dialect gains fields.
  const representableKeys = new Set(
    Object.keys(memberSchema.shape).map(
      key => EXTERNAL_TO_INTERNAL_KEY[key] ?? key,
    ),
  );

  for (const [key, value] of Object.entries(config)) {
    if (isEmptyValue(value) || isDefaultValue(key, value)) continue;
    if (representableKeys.has(key)) continue;
    if (EVALUATION_INERT_CONFIG_KEYS.has(key)) continue;
    return false;
  }

  if (isRawSql) {
    return true;
  }

  if ('where' in config && typeof config.where === 'string') {
    // The external schema caps the chart-level filter; a longer stored value
    // would emit a body that cannot be PUT back.
    if (config.where.length > EXTERNAL_ALERT_WHERE_MAX) {
      return false;
    }
  }

  const select = 'select' in config ? config.select : undefined;
  // A raw SQL select expression string has no external representation — the
  // tile converter would silently substitute a default count() item.
  if (!Array.isArray(select)) {
    return false;
  }
  // The external schema caps select at 20 items.
  if (select.length === 0 || select.length > 20) {
    return false;
  }
  // The external converter keeps only select[0] on formula-less number
  // configs, so extra items would be silently discarded.
  if (
    displayType === DisplayType.Number &&
    select.length > 1 &&
    !('formulas' in config && (config.formulas?.length ?? 0) > 0)
  ) {
    return false;
  }
  for (const item of select) {
    // Values, not just key names: `convertToExternalSelectItem` falls back to
    // `aggFn: 'none'` for an aggregation the external enum does not admit
    // (the internal schema also allows `histogram`, `quantileMerge`, and the
    // *Merge combinators) and drops a `level` outside the external quantile
    // set. Emitting either would silently rewrite the aggregation on a
    // GET -> PUT, which is what this gate exists to prevent.
    if (!AggregateFunctionSchema.safeParse(item.aggFn).success) {
      return false;
    }
    if (
      item.aggFn === 'quantile' &&
      !externalQuantileLevelSchema.safeParse(
        'level' in item ? item.level : undefined,
      ).success
    ) {
      return false;
    }

    for (const [key, value] of Object.entries(item)) {
      if (isEmptyValue(value) || isDefaultValue(key, value)) continue;
      // Inert leftovers the external converter heals away: a level on a
      // non-quantile agg and a valueExpression on a count are ignored by the
      // renderer (see convertToExternalSelectItem).
      if (key === 'level' && item.aggFn !== 'quantile') continue;
      if (key === 'valueExpression' && item.aggFn === 'count') continue;
      if (REPRESENTABLE_SELECT_ITEM_KEYS.has(key)) continue;
      if (EVALUATION_INERT_SELECT_ITEM_KEYS.has(key)) continue;
      return false;
    }
  }

  return true;
}

/**
 * Converts an inline alert's persisted internal chart config to the external
 * tile-config dialect for API responses. Returns undefined when the external
 * contract cannot represent the config faithfully — an unsupported display
 * type, a PromQL config, or a config carrying evaluation-affecting fields the
 * dialect cannot express (see isRepresentableExternally). Callers omit the
 * field, so a blind echo-PUT fails loudly instead of silently rewriting the
 * alert's query.
 */
export function convertAlertChartConfigToExternal(
  config: AlertChartConfig,
): ExternalAlertChartConfig | undefined {
  const displayType = config.displayType;
  if (
    displayType == null ||
    !(EXTERNAL_ALERT_DISPLAY_TYPES as readonly DisplayType[]).includes(
      displayType,
    ) ||
    !isRepresentableExternally(config, displayType as ExternalAlertDisplayType)
  ) {
    logger.warn(
      { displayType },
      'Inline alert chart config has no faithful external representation; omitting chartConfig',
    );
    return undefined;
  }

  const external = convertToExternalTileChartConfig(config);
  switch (external?.displayType) {
    case DisplayType.Line:
    case DisplayType.StackedBar:
    case DisplayType.Number: {
      const name = config.name ? { name: config.name } : {};
      if ('configType' in external) {
        return { ...external, ...name };
      }
      return {
        ...external,
        ...name,
        // Chart-level filter: builder configs only (the raw SQL internal
        // shape has no `where`).
        ...(!('configType' in config) && config.where
          ? {
              where: config.where,
              whereLanguage: config.whereLanguage ?? 'lucene',
            }
          : {}),
      };
    }
    default:
      logger.error(
        { config },
        'Inline alert chart config has no external representation',
      );
      return undefined;
  }
}

/**
 * `translateAlertDocumentToExternalAlert` plus the inline alert's chartConfig
 * (external dialect) when one is faithfully representable. Single-alert
 * responses (GET by id, POST, PUT, MCP detail) use this; list responses use
 * the bare translator so they stay lean. Lives here (not utils/externalApi)
 * to keep the utils -> router-utils import direction one-way.
 */
export function translateAlertDocumentToExternalAlertWithChartConfig(
  alert: AlertDocument,
): ExternalAlert {
  const external = translateAlertDocumentToExternalAlert(alert);
  const alertObj: Pick<IAlert, 'source' | 'chartConfig'> = alert.toJSON
    ? alert.toJSON()
    : alert;
  const chartConfig =
    alertObj.source === AlertSource.INLINE && alertObj.chartConfig != null
      ? convertAlertChartConfigToExternal(alertObj.chartConfig)
      : undefined;
  return { ...external, ...(chartConfig && { chartConfig }) };
}
