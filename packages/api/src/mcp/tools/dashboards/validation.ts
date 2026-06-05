import { SOURCE_DEPENDENT_MACROS } from '@hyperdx/common-utils/dist/macros';

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
    const macros = SOURCE_DEPENDENT_MACROS.filter(macro =>
      sqlTemplate.includes(macro),
    );
    if (macros.length > 0) {
      offending.push({
        tile: tile.name?.trim() || `tile #${index + 1}`,
        macros: [...macros],
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
