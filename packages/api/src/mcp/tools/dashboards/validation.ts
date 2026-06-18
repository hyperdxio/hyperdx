import {
  hasMacro,
  INTERVAL_MACROS,
  SOURCE_DEPENDENT_MACROS,
  TIME_RANGE_MACROS,
} from '@hyperdx/common-utils/dist/macros';

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
    // SOURCE_DEPENDENT_MACROS are bare names ('filters', 'sourceTable') for
    // hasMacro; surface them in the user-facing `$__name` form.
    const macros = SOURCE_DEPENDENT_MACROS.filter(macro =>
      hasMacro(sqlTemplate, macro),
    ).map(macro => `$__${macro}`);
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
