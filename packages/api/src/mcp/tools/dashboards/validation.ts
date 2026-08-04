import {
  getSourceDependentMacrosUsed,
  hasMacro,
  INTERVAL_MACROS,
  TIME_RANGE_MACROS,
} from '@hyperdx/common-utils/dist/macros';

import { getMetricSelectIssues } from '@/mcp/tools/query/schemas';
import {
  isConfigTile,
  isRawSqlExternalTileConfig,
} from '@/routers/external-api/v2/utils/dashboards';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

/**
 * Returns one entry per raw SQL tile that uses a source-dependent macro but
 * does not set a `sourceId`, recording which macro(s) triggered it so callers
 * can build a precise error message.
 */
export function getRawSqlTilesMissingRequiredSource(
  tiles: ExternalDashboardTileWithId[],
): { tile: string; macros: string[] }[] {
  const offending: { tile: string; macros: string[] }[] = [];
  tiles.forEach((tile, index) => {
    if (
      !isConfigTile(tile) ||
      !isRawSqlExternalTileConfig(tile.config) ||
      tile.config.sourceId
    ) {
      return;
    }
    const { sqlTemplate } = tile.config;
    // getSourceDependentMacrosUsed returns bare names ('filters',
    // 'sourceTable'); surface them in the user-facing `$__name` form.
    const macros = getSourceDependentMacrosUsed(sqlTemplate).map(
      macro => `$__${macro}`,
    );
    if (macros.length > 0) {
      offending.push({
        tile: tile.name?.trim() || `tile #${index + 1}`,
        macros,
      });
    }
  });
  return offending;
}

/**
 * MCP-only guard: a raw SQL tile that uses a source-dependent macro
 * ($__filters or $__sourceTable) must set a `sourceId`.
 *
 * Returns a human-readable error message, or `null` when all tiles are valid.
 */
export function getRawSqlMissingSourceError(
  tiles: ExternalDashboardTileWithId[],
): string | null {
  const offending = getRawSqlTilesMissingRequiredSource(tiles);
  if (offending.length === 0) return null;
  const list = offending
    .map(({ tile, macros }) => `${tile} (uses ${macros.join(', ')})`)
    .join('; ');
  return (
    'Raw SQL tiles that use the $__filters or $__sourceTable macro must set a sourceId. ' +
    "Without a source, $__filters cannot resolve dashboard filters against the source's " +
    'columns and $__sourceTable fails at query time. Add a sourceId to the following tiles ' +
    '(call clickstack_list_sources to find it), or remove the macro if the query reads ' +
    `from multiple tables: ${list}`
  );
}

/**
 * Validate the metric aggregation constraints of every builder tile's select
 * items, reusing the same `getMetricSelectIssues` rules the query and
 * save/patch tools apply at input time. This is the guard for tiles that were
 * persisted BEFORE those rules existed, or through non-MCP paths (REST/UI/
 * legacy) — e.g. a histogram metric with aggFn "avg"/"sum"/"min"/"max", which
 * the ClickHouse renderer cannot translate.
 *
 * Only metric select items (those carrying a `metricType`) are inspected;
 * log/trace items, raw SQL tiles, heatmaps, and string-`select` tiles are
 * skipped. Returns one human-readable error per offending item, or an empty
 * array when all tiles are valid.
 */
export function getMetricTileAggFnErrors(
  tiles: ExternalDashboardTileWithId[],
): string[] {
  const errors: string[] = [];
  tiles.forEach((tile, index) => {
    if (!isConfigTile(tile) || isRawSqlExternalTileConfig(tile.config)) {
      return;
    }
    // Builder tiles (line/stacked_bar/table/number/pie/bar) carry an array of
    // structured select items. Search/event_patterns use a string `select` and
    // heatmaps use a single object without an aggFn — neither is a metric
    // aggregation, so `Array.isArray` filters them out.
    const select = (tile.config as { select?: unknown }).select;
    if (!Array.isArray(select)) {
      return;
    }
    const label = tile.name?.trim() || `tile #${index + 1}`;
    select.forEach((rawItem, selectIndex) => {
      if (!rawItem || typeof rawItem !== 'object') {
        return;
      }
      const item = rawItem as Record<string, unknown>;
      // Only metric select items can violate metric-kind aggFn rules.
      if (typeof item.metricType !== 'string') {
        return;
      }
      const issues = getMetricSelectIssues({
        aggFn: typeof item.aggFn === 'string' ? item.aggFn : undefined,
        metricType: item.metricType,
        metricName:
          typeof item.metricName === 'string' ? item.metricName : undefined,
        // The external tile schema stores the Prometheus-style gauge delta as
        // `periodAggFn: 'delta'`; map it back to the `isDelta` flag the shared
        // validator understands.
        isDelta: item.periodAggFn === 'delta',
        level: typeof item.level === 'number' ? item.level : undefined,
        valueExpression:
          typeof item.valueExpression === 'string'
            ? item.valueExpression
            : undefined,
      });
      for (const issue of issues) {
        errors.push(
          `${label} select[${selectIndex}].${issue.path.join('.')}: ${issue.message}`,
        );
      }
    });
  });
  return errors;
}

/** Raw SQL display types that plot a value over time. */
const TIME_SERIES_DISPLAY_TYPES = ['line', 'stacked_bar'];

/**
 * Returns one advisory string per raw SQL tile that omits a strongly
 * recommended macro:
 *  - a time-range macro (any of TIME_RANGE_MACROS) — all display types;
 *  - $__timeInterval — time-series display types only;
 *  - $__filters / $__sourceTable
 *
 * These are non-blocking warnings, not errors: a tile may legitimately omit them
 * (e.g. a query that should ignore the dashboard time range), so they are
 * surfaced as guidance the agent can act on or knowingly disregard.
 */
export function getRawSqlTileMacroWarnings(
  tiles: ExternalDashboardTileWithId[],
): string[] {
  const hints: string[] = [];
  tiles.forEach((tile, index) => {
    if (!isConfigTile(tile) || !isRawSqlExternalTileConfig(tile.config)) {
      return;
    }
    const { sqlTemplate, displayType } = tile.config;
    const label = tile.name?.trim() || `tile #${index + 1}`;
    const missing: string[] = [];

    if (!TIME_RANGE_MACROS.some(macro => hasMacro(sqlTemplate, macro))) {
      missing.push(
        'a time-range macro such as $__timeFilter(col) (so the tile follows the dashboard time picker)',
      );
    }
    if (
      TIME_SERIES_DISPLAY_TYPES.includes(displayType) &&
      !INTERVAL_MACROS.some(macro => hasMacro(sqlTemplate, macro))
    ) {
      missing.push(
        '$__timeInterval(col) (so time buckets match the dashboard granularity)',
      );
    }

    if (!hasMacro(sqlTemplate, 'filters')) {
      missing.push(
        '$__filters (so dashboard filters apply to this tile; requires a sourceId on the tile)',
      );
    }

    if (!hasMacro(sqlTemplate, 'sourceTable')) {
      missing.push(
        "$__sourceTable (so the query tracks the tile's configured source; requires a sourceId on the tile)",
      );
    }

    if (missing.length > 0) {
      hints.push(
        `Raw SQL tile "${label}" is missing ${missing.join('; ')}. ` +
          'These macros are strongly recommended unless the query intentionally ignores the dashboard time range and filters.',
      );
    }
  });
  return hints;
}
