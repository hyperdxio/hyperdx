import type { FilterForVariableDeclaration } from '@hyperdx/common-utils/dist/filters';
import {
  getDashboardVariableDeclarations,
  getFilterVariableName,
  isFilterVariableEnabled,
} from '@hyperdx/common-utils/dist/filters';
import {
  isBuilderSavedChartConfig,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  getSourceDependentMacrosUsed,
  hasMacro,
  INTERVAL_MACROS,
  TIME_RANGE_MACROS,
} from '@hyperdx/common-utils/dist/macros';
import {
  DashboardFilter,
  DisplayType,
  SavedChartConfig,
  SearchConditionLanguage,
} from '@hyperdx/common-utils/dist/types';
import {
  getVariableReferences,
  mapBuilderVariableTemplates,
  validateVariableReferencesInTemplate,
} from '@hyperdx/common-utils/dist/variables';

import {
  convertToInternalTileConfig,
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

/** Minimal projection needed to check a filter's dropdown-values query. */
export type FilterForVariableValidation = FilterForVariableDeclaration &
  Partial<Pick<DashboardFilter, 'where' | 'whereLanguage'>>;

/**
 * Non-blocking checks on the dashboard variables references in a filter's `where`.
 *
 * A dependent filter is one whose `where` names another filter's variable, so
 * that picking a service narrows the endpoint dropdown to that service's
 * endpoints.
 *
 * Three warnings can arise from a dependent filter's `where`:
 *  - referencing a filter that collects a value but never publishes it
 *    (`isVariableEnabled` unset), which is the usual cause of an "unknown
 *    variable" here;
 *  - referencing the filter's OWN variable, which narrows its dropdown to the
 *    values already selected so the rest disappear from a multi-select;
 *  - a `where` that is not `sql`, where the macros are literal text.
 */
export function getFilterVariableWarnings(
  filters: FilterForVariableValidation[] | undefined,
): string[] {
  if (!filters?.length) return [];

  const variables = getDashboardVariableDeclarations(filters).map(
    declaration => ({ ...declaration, values: [] }),
  );
  const declaredNames = new Set(variables.map(variable => variable.name));

  // A map from variable name to to the name of the filter that collects it but is not variable-enabled.
  const filtersByUnpublishedVarName = new Map<string, string>();
  for (const filter of filters) {
    if (isFilterVariableEnabled(filter)) continue;
    for (const candidate of [
      getFilterVariableName(filter),
      filter.variableName?.trim(),
    ]) {
      if (!candidate) continue;
      const key = candidate.toLowerCase();
      if (!filtersByUnpublishedVarName.has(key))
        filtersByUnpublishedVarName.set(key, filter.name);
    }
  }

  const warnings: string[] = [];
  filters.forEach((filter, index) => {
    const where = filter.where?.trim();
    if (!where) return;

    const label = filter.name?.trim() || `filter #${index + 1}`;
    const language = filter.whereLanguage ?? 'sql';

    const result = validateVariableReferencesInTemplate(where, variables, {
      subject: 'The dropdown values query',
      language,
    });
    const issues = [...result.errors, ...result.warnings];

    const referencedNames = new Set(
      getVariableReferences(where).map(reference => reference.name),
    );

    const ownName = isFilterVariableEnabled(filter)
      ? getFilterVariableName(filter)
      : undefined;
    if (ownName && referencedNames.has(ownName)) {
      issues.push(
        `The dropdown values query references this filter's own variable $${ownName}, ` +
          'which narrows the dropdown to the values already selected. Reference ' +
          "another filter's variable instead.",
      );
    }

    for (const name of referencedNames) {
      if (declaredNames.has(name)) continue;
      const owner = filtersByUnpublishedVarName.get(name.toLowerCase());
      if (owner == null) continue;
      issues.push(
        `$${name} is not published as a variable. The filter named "${owner}" collects ` +
          `that value but does not expose it: set isVariableEnabled: true (and ` +
          `variableName: "${name}") on it so this dropdown can depend on it.`,
      );
    }

    warnings.push(...issues.map(issue => `Filter "${label}": ${issue}`));
  });

  return warnings;
}

/**
 * Non-blocking checks on the dashboard variables a tile's expressions
 * reference, run against the variables the dashboard's filters actually
 * declare.
 */
export function getTileVariableWarnings(
  tiles: ExternalDashboardTileWithId[],
  filters: FilterForVariableDeclaration[] | undefined,
): string[] {
  const variables = getDashboardVariableDeclarations(filters).map(
    declaration => ({ ...declaration, values: [] }),
  );

  const warnings: string[] = [];
  tiles.forEach((tile, index) => {
    if (!isConfigTile(tile)) return;
    const label = tile.name?.trim() || `tile #${index + 1}`;

    // Convert to the internal config format so that variable validators can run
    let config: SavedChartConfig;
    try {
      config = convertToInternalTileConfig(tile).config;
    } catch {
      // A tile shape the converter refuses is already reported by the schema
      // validation that runs alongside this; nothing to add here.
      return;
    }

    const issues: string[] = [];
    const validate = (template: string, language: SearchConditionLanguage) => {
      const result = validateVariableReferencesInTemplate(template, variables, {
        subject: language === 'lucene' ? 'The Lucene filter' : 'SQL',
        language,
      });
      issues.push(...result.errors, ...result.warnings);
    };

    if (isRawSqlSavedChartConfig(config)) {
      validate(config.sqlTemplate, 'sql');
    } else if (
      isBuilderSavedChartConfig(config) &&
      config.displayType !== DisplayType.Markdown
    ) {
      mapBuilderVariableTemplates(config, (template, language) => {
        validate(template, language);
        return template;
      });
    }

    // Not every message from the validators names its subject (the editor
    // shows them attached to the input they came from), so identify the tile
    // here rather than relying on the `subject` option.
    warnings.push(...issues.map(issue => `Tile "${label}": ${issue}`));
  });

  return warnings;
}
