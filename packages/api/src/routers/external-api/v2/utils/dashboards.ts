import {
  displayTypeSupportsBuilderAlerts,
  displayTypeSupportsRawSqlAlerts,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  validateDashboardContainersStructure,
  validateDashboardTileContainerRefs,
} from '@hyperdx/common-utils/dist/dashboardValidation';
import {
  isBuilderSavedChartConfig,
  isHeatmapCompatibleSource,
  isRawSqlSavedChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  AggregateFunctionSchema,
  BuilderSavedChartConfig,
  DASHBOARD_MAX_CONTAINERS,
  DashboardContainer,
  DashboardContainerSchema,
  DisplayType,
  isLogSource,
  isOnClickDashboardById,
  isOnClickSearchById,
  isTraceSource,
  RawSqlSavedChartConfig,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { SearchConditionLanguageSchema as whereLanguageSchema } from '@hyperdx/common-utils/dist/types';
import { pick } from 'lodash';
import _ from 'lodash';
import mongoose from 'mongoose';
import { z } from 'zod';

import { deleteDashboardAlerts } from '@/controllers/alerts';
import { getConnectionsByTeam } from '@/controllers/connection';
import { getSources } from '@/controllers/sources';
import Dashboard, { DashboardDocument } from '@/models/dashboard';
import {
  translateExternalChartToTileConfig,
  translateExternalFilterToFilter,
  translateFilterToExternalFilter,
} from '@/utils/externalApi';
import logger from '@/utils/logger';
import {
  ExternalDashboardFilter,
  externalDashboardFilterSchema,
  externalDashboardFilterSchemaWithId,
  ExternalDashboardFilterWithId,
  ExternalDashboardHeatmapSelectItem,
  ExternalDashboardRawSqlTileConfig,
  externalDashboardSavedFilterValueSchema,
  ExternalDashboardSelectItem,
  ExternalDashboardTileConfig,
  externalDashboardTileListSchema,
  ExternalDashboardTileWithId,
  externalQuantileLevelSchema,
  tagsSchema,
} from '@/utils/zod';

// --------------------------------------------------------------------------------
// Type Guards and Utility Types
// --------------------------------------------------------------------------------

export type SeriesTile = ExternalDashboardTileWithId & {
  series: Exclude<ExternalDashboardTileWithId['series'], undefined>;
};

function isSeriesTile(tile: ExternalDashboardTileWithId): tile is SeriesTile {
  return 'series' in tile && tile.series !== undefined;
}

export type ConfigTile = ExternalDashboardTileWithId & {
  config: Exclude<ExternalDashboardTileWithId['config'], undefined>;
};

function isRawSqlExternalTileConfig(
  config: ExternalDashboardTileConfig,
): config is ExternalDashboardRawSqlTileConfig {
  return 'configType' in config && config.configType === 'sql';
}

export function isConfigTile(
  tile: ExternalDashboardTileWithId,
): tile is ConfigTile {
  return 'config' in tile && tile.config != undefined;
}

export type ExternalDashboard = {
  id: string;
  name: string;
  tiles: ExternalDashboardTileWithId[];
  tags?: string[];
  filters?: ExternalDashboardFilterWithId[];
  savedQuery?: string | null;
  savedQueryLanguage?: string | null;
  savedFilterValues?: DashboardDocument['savedFilterValues'];
  containers?: DashboardContainer[];
};

// --------------------------------------------------------------------------------
// Conversion functions from internal dashboard format to external dashboard format
// --------------------------------------------------------------------------------

const DEFAULT_SELECT_ITEM: ExternalDashboardSelectItem = {
  aggFn: 'count',
  where: '',
};

const convertToExternalHeatmapSelectItem = (
  item: Exclude<BuilderSavedChartConfig['select'][number], string>,
): ExternalDashboardHeatmapSelectItem => ({
  valueExpression: item.valueExpression,
  // Use `!== undefined` (not truthy) to match the deserializer in
  // convertToInternalTileConfig so empty-string round-trips do not
  // silently drop fields.
  ...(item.countExpression !== undefined
    ? { countExpression: item.countExpression }
    : {}),
  ...(item.heatmapScaleType !== undefined
    ? { heatmapScaleType: item.heatmapScaleType }
    : {}),
});

const convertToExternalSelectItem = (
  item: Exclude<BuilderSavedChartConfig['select'][number], string>,
): ExternalDashboardSelectItem => {
  const parsedAggFn = AggregateFunctionSchema.safeParse(item.aggFn);
  const aggFn = parsedAggFn.success ? parsedAggFn.data : 'none';
  const parsedLevel =
    'level' in item
      ? externalQuantileLevelSchema.safeParse(item.level)
      : undefined;
  const level = parsedLevel?.success ? parsedLevel.data : undefined;
  return {
    ...pick(item, [
      'valueExpression',
      'alias',
      'metricType',
      'metricName',
      'numberFormat',
    ]),
    aggFn,
    where: item.aggCondition ?? '',
    whereLanguage: item.aggConditionLanguage ?? 'lucene',
    periodAggFn: item.isDelta ? 'delta' : undefined,
    ...(level ? { level } : {}),
  };
};

const convertToExternalTileChartConfig = (
  config: SavedChartConfig,
): ExternalDashboardTileConfig | undefined => {
  if (isRawSqlSavedChartConfig(config)) {
    switch (config.displayType) {
      case DisplayType.Line:
        return {
          configType: 'sql',
          displayType: DisplayType.Line,
          connectionId: config.connection,
          sqlTemplate: config.sqlTemplate,
          sourceId: config.source,
          alignDateRangeToGranularity: config.alignDateRangeToGranularity,
          fillNulls: config.fillNulls !== false,
          numberFormat: config.numberFormat,
          compareToPreviousPeriod: config.compareToPreviousPeriod,
        };
      case DisplayType.StackedBar:
        return {
          configType: 'sql',
          displayType: config.displayType,
          connectionId: config.connection,
          sqlTemplate: config.sqlTemplate,
          sourceId: config.source,
          alignDateRangeToGranularity: config.alignDateRangeToGranularity,
          fillNulls: config.fillNulls !== false,
          numberFormat: config.numberFormat,
        };
      case DisplayType.Table:
        return {
          configType: 'sql',
          displayType: DisplayType.Table,
          connectionId: config.connection,
          sqlTemplate: config.sqlTemplate,
          sourceId: config.source,
          numberFormat: config.numberFormat,
          onClick: config.onClick,
        };
      case DisplayType.Number:
        return {
          configType: 'sql',
          displayType: DisplayType.Number,
          connectionId: config.connection,
          sqlTemplate: config.sqlTemplate,
          sourceId: config.source,
          numberFormat: config.numberFormat,
        };
      case DisplayType.Pie:
        return {
          configType: 'sql',
          displayType: DisplayType.Pie,
          connectionId: config.connection,
          sqlTemplate: config.sqlTemplate,
          sourceId: config.source,
          numberFormat: config.numberFormat,
        };
      case DisplayType.Search:
      case DisplayType.Markdown:
      case DisplayType.Heatmap:
        logger.error(
          { config },
          'Error converting chart config to external chart - unsupported display type for raw SQL config',
        );
        return undefined;
    }

    config.displayType satisfies never | undefined;
    return undefined;
  }

  const sourceId = config.source?.toString() ?? '';

  const stringValueOrDefault = <D>(
    value: string | unknown,
    defaultValue: D,
  ): string | D => {
    return typeof value === 'string' ? value : defaultValue;
  };

  switch (config.displayType) {
    case DisplayType.Line:
      return {
        displayType: DisplayType.Line,
        sourceId,
        asRatio:
          config.seriesReturnType === 'ratio' &&
          Array.isArray(config.select) &&
          config.select.length == 2,
        alignDateRangeToGranularity: config.alignDateRangeToGranularity,
        fillNulls: config.fillNulls !== false,
        groupBy: stringValueOrDefault(config.groupBy, undefined),
        select: Array.isArray(config.select)
          ? config.select.map(convertToExternalSelectItem)
          : [DEFAULT_SELECT_ITEM],
        compareToPreviousPeriod: config.compareToPreviousPeriod,
        numberFormat: config.numberFormat,
      };
    case DisplayType.StackedBar:
      return {
        displayType: DisplayType.StackedBar,
        sourceId,
        asRatio:
          config.seriesReturnType === 'ratio' &&
          Array.isArray(config.select) &&
          config.select.length == 2,
        alignDateRangeToGranularity: config.alignDateRangeToGranularity,
        fillNulls: config.fillNulls !== false,
        groupBy: stringValueOrDefault(config.groupBy, undefined),
        select: Array.isArray(config.select)
          ? config.select.map(convertToExternalSelectItem)
          : [DEFAULT_SELECT_ITEM],
        numberFormat: config.numberFormat,
      };
    case DisplayType.Number:
      return {
        displayType: config.displayType,
        sourceId,
        select: Array.isArray(config.select)
          ? [convertToExternalSelectItem(config.select[0])]
          : [DEFAULT_SELECT_ITEM],
        numberFormat: config.numberFormat,
      };
    case DisplayType.Pie:
      return {
        displayType: config.displayType,
        sourceId,
        select: Array.isArray(config.select)
          ? [convertToExternalSelectItem(config.select[0])]
          : [DEFAULT_SELECT_ITEM],
        groupBy: stringValueOrDefault(config.groupBy, undefined),
        numberFormat: config.numberFormat,
      };
    case DisplayType.Table:
      return {
        ...pick(config, [
          'having',
          'numberFormat',
          'groupByColumnsOnLeft',
          'onClick',
        ]),
        displayType: config.displayType,
        sourceId,
        asRatio:
          config.seriesReturnType === 'ratio' &&
          Array.isArray(config.select) &&
          config.select.length == 2,
        groupBy: stringValueOrDefault(config.groupBy, undefined),
        select: Array.isArray(config.select)
          ? config.select.map(convertToExternalSelectItem)
          : [DEFAULT_SELECT_ITEM],
        orderBy: stringValueOrDefault(config.orderBy, undefined),
      };
    case DisplayType.Search:
      return {
        displayType: config.displayType,
        sourceId,
        select: stringValueOrDefault(config.select, ''),
        where: config.where,
        whereLanguage: config.whereLanguage ?? 'lucene',
      };
    case DisplayType.Markdown:
      return {
        displayType: config.displayType,
        markdown: stringValueOrDefault(config.markdown, ''),
      };
    case DisplayType.Heatmap: {
      // The internal heatmap schema requires `select[0]` to be a builder
      // item with a non-empty `valueExpression`. Legacy/corrupted Mongo
      // docs that lack one would otherwise produce a tile that violates
      // the external schema's `min(1)` rule. Returning undefined here
      // would let the caller fall through to `defaultTileConfig`, which
      // emits `displayType: 'line'`. A subsequent GET -> PUT round-trip
      // through the API would then silently overwrite the heatmap with
      // a line chart in Mongo (data loss). Instead, emit a
      // heatmap-shaped placeholder with an empty valueExpression so the
      // response preserves displayType, and a re-PUT surfaces the
      // breakage as a clear validation error from the input schema's
      // `min(1)` rule on `valueExpression` rather than silently
      // downgrading the tile.
      const item = Array.isArray(config.select) ? config.select[0] : undefined;
      if (
        item === undefined ||
        typeof item === 'string' ||
        !item.valueExpression
      ) {
        logger.warn(
          { tileId: sourceId, hasItem: item !== undefined },
          'Heatmap tile is missing select[0].valueExpression; emitting placeholder so callers do not silently downgrade to line',
        );
        const placeholderItem: ExternalDashboardHeatmapSelectItem = {
          valueExpression: '',
        };
        return {
          displayType: DisplayType.Heatmap,
          sourceId,
          select: [placeholderItem],
          where: stringValueOrDefault(config.where, ''),
          whereLanguage: config.whereLanguage ?? 'lucene',
          numberFormat: config.numberFormat,
        };
      }
      return {
        displayType: DisplayType.Heatmap,
        sourceId,
        select: [convertToExternalHeatmapSelectItem(item)],
        where: stringValueOrDefault(config.where, ''),
        whereLanguage: config.whereLanguage ?? 'lucene',
        numberFormat: config.numberFormat,
      };
    }
    case undefined:
      logger.error(
        { config },
        'Error converting chart config to external chart - unsupported display type',
      );
      return undefined;
    default:
      config.displayType satisfies never;
  }
};

function convertTileToExternalChart(
  tile: DashboardDocument['tiles'][number],
  containerById: Map<string, DashboardContainer>,
  dashboardId: string,
): ExternalDashboardTileWithId | undefined {
  // Returned in case of a failure converting the saved chart config
  const defaultTileConfig: ExternalDashboardTileConfig =
    isRawSqlSavedChartConfig(tile.config)
      ? {
          configType: 'sql',
          displayType: 'line',
          connectionId: tile.config.connection,
          sqlTemplate: tile.config.sqlTemplate,
        }
      : {
          displayType: 'line',
          sourceId: tile.config.source?.toString() ?? '',
          select: [DEFAULT_SELECT_ITEM],
        };

  // Treat empty-string container/tab refs as absent so legacy Mongo docs
  // (the underlying `tiles` field is `Mixed`, so older entries may carry
  // `containerId: ""`) round-trip through the external schema, which now
  // enforces `min(1)`. Without this, a GET that hit a legacy doc would
  // return a tile that the next PUT couldn't validate.
  let containerId =
    typeof tile.containerId === 'string' && tile.containerId.length > 0
      ? tile.containerId
      : undefined;
  let tabId =
    typeof tile.tabId === 'string' && tile.tabId.length > 0
      ? tile.tabId
      : undefined;

  // Self-heal orphan refs on read. A doc may carry a containerId that
  // points at a container that has since been removed (or never
  // existed: legacy docs predating the containers feature can have any
  // value in this `Mixed`-typed field). Round-trip these as if absent
  // so a subsequent PUT validates instead of failing schema with
  // "Tile references unknown containerId". Same idea for tabId.
  if (containerId !== undefined) {
    const container = containerById.get(containerId);
    if (!container) {
      logger.warn(
        { dashboardId, tileId: tile.id, containerId },
        'Tile references unknown containerId; dropping ref on read',
      );
      containerId = undefined;
      tabId = undefined;
    } else if (
      tabId !== undefined &&
      !container.tabs?.some(t => t.id === tabId)
    ) {
      logger.warn(
        { dashboardId, tileId: tile.id, containerId, tabId },
        'Tile references unknown tabId; dropping tabId on read',
      );
      tabId = undefined;
    }
  } else if (tabId !== undefined) {
    // tabId without containerId is invalid in the schema; the legacy
    // doc would fail a subsequent PUT, so drop it on read.
    logger.warn(
      { dashboardId, tileId: tile.id, tabId },
      'Tile has tabId without containerId; dropping tabId on read',
    );
    tabId = undefined;
  }

  const { id, x, y, w, h } = tile;
  return {
    id,
    x,
    y,
    w,
    h,
    name: tile.config.name ?? '',
    config: convertToExternalTileChartConfig(tile.config) ?? defaultTileConfig,
    ...(containerId !== undefined ? { containerId } : {}),
    ...(tabId !== undefined ? { tabId } : {}),
  };
}

export function convertToExternalDashboard(
  dashboard: DashboardDocument,
): ExternalDashboard {
  const containers = dashboard.containers ?? [];
  // Dedupe by id when building the lookup map: a doc with duplicate
  // container ids can only resolve tile refs against one of them, and
  // last-write-wins is consistent with how Mongo would have persisted
  // the array. Tile-resolution ambiguity in this case is logged when
  // the tile ref turns out to point at a missing container.
  const containerById = new Map<string, DashboardContainer>(
    containers.map(c => [c.id, c]),
  );
  const dashboardId = dashboard._id.toString();
  return {
    id: dashboardId,
    name: dashboard.name,
    tiles: dashboard.tiles
      .map(tile => convertTileToExternalChart(tile, containerById, dashboardId))
      .filter(t => t !== undefined),
    tags: dashboard.tags || [],
    filters: dashboard.filters?.map(translateFilterToExternalFilter) || [],
    savedQuery: dashboard.savedQuery ?? null,
    savedQueryLanguage: dashboard.savedQueryLanguage ?? null,
    savedFilterValues: dashboard.savedFilterValues ?? [],
    // Mongoose persists missing arrays as []. Only emit containers when
    // the user actually saved one or more, so dashboards without the
    // organization layer round-trip with the field absent.
    ...(containers.length > 0 ? { containers } : {}),
  };
}

// --------------------------------------------------------------------------------
// Conversion functions from external dashboard format to internal dashboard format
// --------------------------------------------------------------------------------

const convertToInternalSelectItem = (
  item: ExternalDashboardSelectItem,
): Exclude<BuilderSavedChartConfig['select'][number], string> => {
  return {
    ...pick(item, [
      'alias',
      'metricType',
      'metricName',
      'aggFn',
      'level',
      'numberFormat',
    ]),
    aggCondition: item.where,
    aggConditionLanguage: item.whereLanguage,
    isDelta: item.periodAggFn === 'delta',
    valueExpression: item.valueExpression ?? '',
  };
};

export function convertToInternalTileConfig(
  externalTile: ConfigTile,
): DashboardDocument['tiles'][number] {
  const externalConfig = externalTile.config;
  const name = externalTile.name || '';

  let internalConfig: SavedChartConfig;

  if (isRawSqlExternalTileConfig(externalConfig)) {
    switch (externalConfig.displayType) {
      case 'line':
      case 'stacked_bar':
        internalConfig = {
          configType: 'sql',
          ...pick(externalConfig, [
            'numberFormat',
            'alignDateRangeToGranularity',
            'compareToPreviousPeriod',
          ]),
          displayType:
            externalConfig.displayType === 'stacked_bar'
              ? DisplayType.StackedBar
              : DisplayType.Line,
          fillNulls: externalConfig.fillNulls === false ? false : undefined,
          name,
          connection: externalConfig.connectionId,
          sqlTemplate: externalConfig.sqlTemplate,
          source: externalConfig.sourceId,
        } satisfies RawSqlSavedChartConfig;
        break;
      case 'table':
      case 'number':
      case 'pie':
        internalConfig = {
          configType: 'sql',
          displayType:
            externalConfig.displayType === 'table'
              ? DisplayType.Table
              : externalConfig.displayType === 'number'
                ? DisplayType.Number
                : DisplayType.Pie,
          name,
          connection: externalConfig.connectionId,
          sqlTemplate: externalConfig.sqlTemplate,
          source: externalConfig.sourceId,
          numberFormat: externalConfig.numberFormat,
          onClick:
            externalConfig.displayType === 'table'
              ? externalConfig.onClick
              : undefined,
        } satisfies RawSqlSavedChartConfig;
        break;
      default:
        // Typecheck to ensure all display types are handled
        externalConfig satisfies never;

        // We should never hit this due to the typecheck above.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        internalConfig = {} as SavedChartConfig;
    }
  } else {
    switch (externalConfig.displayType) {
      case 'line':
      case 'stacked_bar':
        internalConfig = {
          ...pick(externalConfig, [
            'groupBy',
            'numberFormat',
            'alignDateRangeToGranularity',
            'compareToPreviousPeriod',
          ]),
          displayType:
            externalConfig.displayType === 'stacked_bar'
              ? DisplayType.StackedBar
              : DisplayType.Line,
          select: externalConfig.select.map(convertToInternalSelectItem),
          source: externalConfig.sourceId,
          where: '',
          fillNulls: externalConfig.fillNulls === false ? false : undefined,
          seriesReturnType: externalConfig.asRatio ? 'ratio' : undefined,
          name,
        } satisfies BuilderSavedChartConfig;
        break;
      case 'table':
        internalConfig = {
          ...pick(externalConfig, [
            'groupBy',
            'numberFormat',
            'having',
            'orderBy',
            'groupByColumnsOnLeft',
            'onClick',
          ]),
          displayType: DisplayType.Table,
          select: externalConfig.select.map(convertToInternalSelectItem),
          source: externalConfig.sourceId,
          where: '',
          seriesReturnType: externalConfig.asRatio ? 'ratio' : undefined,
          name,
        } satisfies BuilderSavedChartConfig;
        break;
      case 'number':
        internalConfig = {
          displayType: DisplayType.Number,
          select: [convertToInternalSelectItem(externalConfig.select[0])],
          source: externalConfig.sourceId,
          where: '',
          numberFormat: externalConfig.numberFormat,
          name,
        } satisfies BuilderSavedChartConfig;
        break;
      case 'pie':
        internalConfig = {
          ...pick(externalConfig, ['groupBy', 'numberFormat']),
          displayType: DisplayType.Pie,
          select: [convertToInternalSelectItem(externalConfig.select[0])],
          source: externalConfig.sourceId,
          where: '',
          name,
        } satisfies BuilderSavedChartConfig;
        break;
      case 'heatmap': {
        // Heatmap is builder-only and uses a single select item with
        // its own shape: aggFn is the literal 'heatmap' on the external
        // surface, mapped to the internal 'count' aggFn that the editor
        // form persists, with the heatmap-specific countExpression /
        // heatmapScaleType fields preserved on the select item. The
        // row-level filter lives at the chart-config level (matching
        // HeatmapSeriesEditor in the UI), not on the select item.
        const item = externalConfig.select[0];
        internalConfig = {
          ...pick(externalConfig, ['numberFormat']),
          displayType: DisplayType.Heatmap,
          // Match the editor's `applyHeatmapDefaults` (in
          // `packages/app/src/components/DBEditTimeChartForm/EditTimeChartForm.tsx`,
          // search for `aggFn: 'count'`) for the two fields the editor
          // always writes on the select item: `aggFn: 'count'` and
          // `aggCondition: ''`.
          //
          // Where this path intentionally diverges from the editor:
          //
          //   - `aggConditionLanguage` is hardcoded `'lucene'`; the
          //     editor uses `getStoredLanguage() ?? 'lucene'` (a user
          //     session preference). For a UI-saved heatmap whose
          //     author had `'sql'` selected, a GET -> PUT round-trip
          //     through this converter will downgrade the persisted
          //     value to `'lucene'`. The chart renderer does not read
          //     `aggConditionLanguage` for heatmap tiles (heatmap has
          //     no per-select where), so the change is invisible at
          //     render time.
          //
          //   - The editor unconditionally writes
          //     `numberFormat: { output: 'duration', factor: 0.001 }`
          //     and `series.0.countExpression: 'count()'`. Both are
          //     passed through verbatim from the external payload here
          //     and left absent otherwise, so an API-built tile
          //     renders without duration formatting unless the caller
          //     asks for it.
          select: [
            {
              aggFn: 'count',
              aggCondition: '',
              aggConditionLanguage: 'lucene',
              valueExpression: item.valueExpression,
              ...(item.countExpression !== undefined
                ? { countExpression: item.countExpression }
                : {}),
              ...(item.heatmapScaleType !== undefined
                ? { heatmapScaleType: item.heatmapScaleType }
                : {}),
            },
          ],
          source: externalConfig.sourceId,
          // `where` is `z.string().max(10000).optional().default('')` so
          // it is always a string post-parse; sibling pie/number/table
          // arms write the unconditional value too.
          where: externalConfig.where,
          whereLanguage: externalConfig.whereLanguage ?? 'lucene',
          name,
        } satisfies BuilderSavedChartConfig;
        break;
      }
      case 'search':
        internalConfig = {
          ...pick(externalConfig, ['select', 'where']),
          displayType: DisplayType.Search,
          source: externalConfig.sourceId,
          name,
          whereLanguage: externalConfig.whereLanguage ?? 'lucene',
        } satisfies BuilderSavedChartConfig;
        break;
      case 'markdown':
        internalConfig = {
          displayType: DisplayType.Markdown,
          markdown: externalConfig.markdown,
          source: '',
          where: '',
          select: [],
          name,
        } satisfies BuilderSavedChartConfig;
        break;
      default:
        // Typecheck to ensure all display types are handled
        externalConfig satisfies never;

        // We should never hit this due to the typecheck above.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        internalConfig = {} as SavedChartConfig;
    }
  }

  // Omit keys that are null/undefined, so that they're not saved as null in Mongo.
  // We know that the resulting object will conform to SavedChartConfig since we're just
  // removing null properties and anything that is null will just be undefined instead.

  const strippedConfig = _.omitBy(internalConfig, _.isNil) as SavedChartConfig;

  // Mirror the spread-conditional pattern used in `convertTileToExternalChart`:
  // destructure statically (compile-time narrowing) and include the optional
  // refs only when set, so a tile without a containerId never persists
  // `containerId: undefined` to Mongo. The previous `pick(...)` over the
  // external tile included `name`, but the internal `Tile` type stores the
  // name on `config`, not at the top level (`strippedConfig` carries it).
  // Stripping the top-level `name` brings the runtime shape back in line
  // with `DashboardDocument['tiles'][number]`.
  const { id, x, y, w, h, containerId, tabId } = externalTile;
  return {
    id,
    x,
    y,
    w,
    h,
    ...(containerId !== undefined ? { containerId } : {}),
    ...(tabId !== undefined ? { tabId } : {}),
    config: strippedConfig,
  };
}

// --------------------------------------------------------------------------------
// Shared dashboard validation helpers (used by both the REST router and MCP tools)
// --------------------------------------------------------------------------------

/**
 * The shape of a source as returned from `getSources(team)` (and reused
 * by every dashboard validation helper below). Re-exported so the
 * router can pass a single fetched array into multiple helpers without
 * pulling in `controllers/sources` for the type alone.
 */
type SourceForValidation = Awaited<ReturnType<typeof getSources>>[number];

/** Fetches sources for a team. Re-exports the controller call so callers
 * outside `controllers/sources` don't need a second import for the
 * validation flow. The return type is the awaited shape of `getSources`
 * (an array of Source documents) so callers can `await` it directly. */
async function fetchSourcesForValidation(
  team: string | mongoose.Types.ObjectId,
): Promise<SourceForValidation[]> {
  return getSources(team.toString());
}

/**
 * Extract the tile's onClick config, if the tile uses the new "config" format
 * and the display type supports onClick (currently only table).
 */
function getTileOnClick(tile: ExternalDashboardTileWithId) {
  if (!isConfigTile(tile)) return undefined;
  if (!('onClick' in tile.config)) return undefined;
  return tile.config.onClick;
}

/** Returns source IDs referenced in tiles/filters that do not exist for the team */
function getMissingSources(
  sources: SourceForValidation[],
  tiles: ExternalDashboardTileWithId[],
  filters?: (ExternalDashboardFilter | ExternalDashboardFilterWithId)[],
): string[] {
  const sourceIds = new Set<string>();

  for (const tile of tiles) {
    if (isSeriesTile(tile)) {
      for (const series of tile.series) {
        if ('sourceId' in series) {
          sourceIds.add(series.sourceId);
        }
      }
    } else if (isConfigTile(tile)) {
      if ('sourceId' in tile.config && tile.config.sourceId) {
        sourceIds.add(tile.config.sourceId);
      }
    }

    // Include source IDs referenced by OnClick link-outs (mode=id, type=search)
    const onClick = getTileOnClick(tile);
    if (isOnClickSearchById(onClick)) {
      sourceIds.add(onClick.target.id);
    }
  }

  if (filters?.length) {
    for (const filter of filters) {
      if ('sourceId' in filter) {
        sourceIds.add(filter.sourceId);
      }
    }
  }

  const existingSourceIds = new Set(
    sources.map(source => source._id.toString()),
  );
  return [...sourceIds].filter(sourceId => !existingSourceIds.has(sourceId));
}

/**
 * Returns source IDs referenced by heatmap tiles that exist but are not
 * compatible with heatmap rendering. The heatmap UI gates the source picker
 * via the same `HEATMAP_ALLOWED_SOURCE_KINDS` set used here (see
 * `packages/common-utils/src/guards.ts` and `ChartEditorControls.tsx`), so
 * UI and API gates move together.
 */
function getHeatmapTilesWithIncompatibleSources(
  sources: SourceForValidation[],
  tiles: ExternalDashboardTileWithId[],
): string[] {
  const heatmapSourceIds = new Set<string>();
  for (const tile of tiles) {
    if (
      isConfigTile(tile) &&
      !isRawSqlExternalTileConfig(tile.config) &&
      tile.config.displayType === 'heatmap' &&
      tile.config.sourceId
    ) {
      heatmapSourceIds.add(tile.config.sourceId);
    }
  }
  if (heatmapSourceIds.size === 0) return [];

  const sourceById = new Map(sources.map(s => [s._id.toString(), s]));
  return [...heatmapSourceIds].filter(id => {
    const source = sourceById.get(id);
    return source !== undefined && !isHeatmapCompatibleSource(source);
  });
}

/**
 * For a PUT (update) request, return only the heatmap tiles that need
 * to be re-validated against the source-kind gate. A heatmap tile that
 * was already on the same source in the existing dashboard is kept as
 * "unchanged" so the user can edit other parts of the dashboard
 * without being blocked when the underlying source's `kind` was
 * changed after the heatmap was originally accepted. New heatmap
 * tiles, tiles whose displayType just changed to heatmap, and tiles
 * whose `sourceId` changed all flow through the check.
 */
function filterChangedHeatmapTiles(
  requestTiles: ExternalDashboardTileWithId[],
  existingTiles: DashboardDocument['tiles'],
): ExternalDashboardTileWithId[] {
  const existingTilesById = new Map<string, DashboardDocument['tiles'][number]>(
    existingTiles.map(t => [t.id, t]),
  );
  return requestTiles.filter(tile => {
    if (
      !isConfigTile(tile) ||
      isRawSqlExternalTileConfig(tile.config) ||
      tile.config.displayType !== 'heatmap'
    ) {
      return false;
    }
    const existing = tile.id ? existingTilesById.get(tile.id) : undefined;
    if (existing === undefined) {
      // New heatmap tile: validate.
      return true;
    }
    const existingConfig = existing.config;
    if (isRawSqlSavedChartConfig(existingConfig)) {
      // Existing tile was raw-SQL; user is converting to a heatmap.
      return true;
    }
    if (existingConfig.displayType !== DisplayType.Heatmap) {
      // displayType changed to heatmap.
      return true;
    }
    // Existing tile was already a heatmap. Re-check only when the
    // source changed.
    return existingConfig.source?.toString() !== tile.config.sourceId;
  });
}

/**
 * Returns source IDs referenced by onClick search link-outs (mode=id,
 * type=search) whose source kind is not log or trace. The /search destination
 * only supports log and trace sources, so linking to a metric/session source
 * would produce a broken link at click time.
 *
 * Sources that don't exist are ignored here, getMissingSources handles that
 * case separately with a clearer error message.
 */
async function getInvalidOnClickSearchSources(
  team: string | mongoose.Types.ObjectId,
  tiles: ExternalDashboardTileWithId[],
): Promise<string[]> {
  const sourceIds = new Set<string>();

  for (const tile of tiles) {
    const onClick = getTileOnClick(tile);
    if (isOnClickSearchById(onClick)) {
      sourceIds.add(onClick.target.id);
    }
  }

  if (sourceIds.size === 0) return [];

  const sources = await getSources(team.toString());
  const validSources = sources.filter(s => isLogSource(s) || isTraceSource(s));
  const validSourceIds = new Set(validSources.map(s => s._id.toString()));
  return [...sourceIds].filter(id => !validSourceIds.has(id));
}

/**
 * Returns dashboard IDs referenced by tile OnClick link-outs (mode=id,
 * type=dashboard) that do not exist for the team.
 */
async function getMissingOnClickDashboards(
  team: string | mongoose.Types.ObjectId,
  tiles: ExternalDashboardTileWithId[],
): Promise<string[]> {
  const dashboardIds = new Set<string>();

  for (const tile of tiles) {
    const onClick = getTileOnClick(tile);
    if (isOnClickDashboardById(onClick)) {
      dashboardIds.add(onClick.target.id);
    }
  }

  if (dashboardIds.size === 0) return [];

  const existingDashboards = await Dashboard.find(
    { team, _id: { $in: [...dashboardIds] } },
    { _id: 1 },
  ).lean();
  const existingDashboardIds = new Set(
    existingDashboards.map(d => d._id.toString()),
  );
  return [...dashboardIds].filter(id => !existingDashboardIds.has(id));
}

/** Returns connection IDs referenced in tiles that do not belong to the team */
async function getMissingConnections(
  team: string | mongoose.Types.ObjectId,
  tiles: ExternalDashboardTileWithId[],
): Promise<string[]> {
  const connectionIds = new Set<string>();

  for (const tile of tiles) {
    if (isConfigTile(tile) && isRawSqlExternalTileConfig(tile.config)) {
      connectionIds.add(tile.config.connectionId);
    }
  }

  if (connectionIds.size === 0) return [];

  const existingConnections = await getConnectionsByTeam(team.toString());
  const existingConnectionIds = new Set(
    existingConnections.map(connection => connection._id.toString()),
  );

  return [...connectionIds].filter(
    connectionId => !existingConnectionIds.has(connectionId),
  );
}

type SavedQueryLanguage = z.infer<typeof whereLanguageSchema>;

export function resolveSavedQueryLanguage(params: {
  savedQuery: string | null | undefined;
  savedQueryLanguage: SavedQueryLanguage | null | undefined;
}): SavedQueryLanguage | null | undefined {
  const { savedQuery, savedQueryLanguage } = params;
  if (savedQueryLanguage !== undefined) return savedQueryLanguage;
  if (savedQuery === null) return null;
  if (savedQuery) return 'lucene';

  return undefined;
}

const dashboardBodyBaseShape = {
  name: z.string().max(1024),
  tiles: externalDashboardTileListSchema,
  tags: tagsSchema,
  savedQuery: z.string().nullable().optional(),
  savedQueryLanguage: whereLanguageSchema.nullable().optional(),
  savedFilterValues: z
    .array(externalDashboardSavedFilterValueSchema)
    .optional(),
  // The internal `DashboardContainerSchema` already caps individual
  // container/tab/title sizes; the array cap mirrors what the editor
  // would ever generate.
  containers: z
    .array(DashboardContainerSchema)
    .max(DASHBOARD_MAX_CONTAINERS)
    .optional(),
};

// --------------------------------------------------------------------------------
// Shared tile/filter conversion helpers (used by both external API and MCP)
// --------------------------------------------------------------------------------

/**
 * Convert external tile definitions to internal Mongoose-compatible format.
 * Generates new ObjectIds for tiles that don't already have a matching ID in
 * `existingTileIds` (update path) or for all tiles (create path).
 */
export function convertExternalTilesToInternal(
  tiles: ExternalDashboardTileWithId[],
  existingTileIds?: Set<string>,
): DashboardDocument['tiles'] {
  return tiles.map(tile => {
    const tileId =
      existingTileIds && tile.id && existingTileIds.has(tile.id)
        ? tile.id
        : new mongoose.Types.ObjectId().toString();
    const tileWithId = { ...tile, id: tileId };
    if (isConfigTile(tileWithId)) {
      return convertToInternalTileConfig(tileWithId);
    }
    if (isSeriesTile(tileWithId)) {
      return translateExternalChartToTileConfig(tileWithId);
    }
    // Fallback for tiles with neither config nor series; treat as empty series tile.
    // This shouldn't happen with valid input, but matches the previous behavior.
    return translateExternalChartToTileConfig(tileWithId as SeriesTile);
  });
}

/**
 * Convert external filter definitions to internal format, preserving IDs that
 * match `existingFilterIds` (update path) or generating new ones (create path).
 */
export function convertExternalFiltersToInternal(
  filters: (ExternalDashboardFilter | ExternalDashboardFilterWithId)[],
  existingFilterIds?: Set<string>,
) {
  return filters.map(filter => {
    const filterId =
      existingFilterIds && 'id' in filter && existingFilterIds.has(filter.id)
        ? filter.id
        : new mongoose.Types.ObjectId().toString();
    return translateExternalFilterToFilter({ ...filter, id: filterId });
  });
}

/**
 * Returns source IDs on raw SQL tiles whose connection doesn't match
 * the source's persisted connection. Catches copy-paste errors where
 * the LLM mixes up sourceId and connectionId from different sources.
 */
function getSourceConnectionMismatches(
  sources: SourceForValidation[],
  tiles: ExternalDashboardTileWithId[],
): string[] {
  const sourceById = new Map(sources.map(s => [s._id.toString(), s]));

  const mismatched: string[] = [];
  for (const tile of tiles) {
    if (
      isConfigTile(tile) &&
      isRawSqlExternalTileConfig(tile.config) &&
      tile.config.sourceId
    ) {
      const source = sourceById.get(tile.config.sourceId);
      if (source && source.connection.toString() !== tile.config.connectionId) {
        mismatched.push(tile.config.sourceId);
      }
    }
  }

  return mismatched;
}

// ── Shared tile validation ───────────────────────────────────────────────

export type TileValidationContext = {
  teamId: string;
  tiles: ExternalDashboardTileWithId[];
  /** Filters to check for missing source IDs (create/full-update paths). */
  filters?: (ExternalDashboardFilter | ExternalDashboardFilterWithId)[];
  /** Existing internal tiles for scoping heatmap change detection (update paths). */
  existingTiles?: DashboardDocument['tiles'];
  /** Container set to validate tile containerId/tabId refs against. */
  containers: DashboardContainer[];
};

/**
 * Run the full suite of tile validation checks (sources, connections,
 * heatmap source-kind, onClick targets, container/tab refs). Returns
 * `null` when all checks pass, or an error message string on failure.
 *
 * Consolidates the ~95-line validation block that was previously
 * duplicated across REST v2 POST/PUT, MCP save (create/update), and
 * MCP patch handlers.
 */
export async function validateDashboardTiles(
  ctx: TileValidationContext,
): Promise<string | null> {
  const { teamId, tiles, filters, existingTiles, containers } = ctx;

  // Container/tab ref resolution.
  const tileRefIssues = collectTileContainerRefIssues(containers, tiles);
  if (tileRefIssues.length > 0) {
    return tileRefIssues.join('; ');
  }

  // Fetch sources/connections/onClick targets in parallel.
  const [
    sources,
    missingConnections,
    missingOnClickDashboards,
    invalidOnClickSearchSources,
  ] = await Promise.all([
    fetchSourcesForValidation(teamId),
    getMissingConnections(teamId, tiles),
    getMissingOnClickDashboards(teamId, tiles),
    getInvalidOnClickSearchSources(teamId, tiles),
  ]);

  const missingSources = getMissingSources(sources, tiles, filters);
  if (missingSources.length > 0) {
    return `Could not find the following source IDs: ${missingSources.join(', ')}`;
  }
  if (missingConnections.length > 0) {
    return `Could not find the following connection IDs: ${missingConnections.join(', ')}`;
  }

  const sourceConnectionMismatches = getSourceConnectionMismatches(
    sources,
    tiles,
  );
  if (sourceConnectionMismatches.length > 0) {
    return `The following source IDs do not match the specified connections: ${sourceConnectionMismatches.join(', ')}`;
  }

  // Heatmap source-kind gate. On create (no existingTiles), validate all
  // tiles. On update, scope to tiles whose sourceId/displayType changed.
  const heatmapTilesToCheck = existingTiles
    ? filterChangedHeatmapTiles(tiles, existingTiles)
    : tiles;
  const heatmapNonTraceSources = getHeatmapTilesWithIncompatibleSources(
    sources,
    heatmapTilesToCheck,
  );
  if (heatmapNonTraceSources.length > 0) {
    return `Heatmap tiles require a Trace source. The following source IDs are not Trace sources: ${heatmapNonTraceSources.join(', ')}`;
  }

  if (missingOnClickDashboards.length > 0) {
    return `Could not find the following onClick dashboard IDs: ${missingOnClickDashboards.join(', ')}`;
  }
  if (invalidOnClickSearchSources.length > 0) {
    return `The following onClick search source IDs are not log or trace sources: ${invalidOnClickSearchSources.join(', ')}`;
  }

  return null;
}

/**
 * Delete alerts for tiles that were removed or whose config no longer
 * supports alerts (raw SQL with incompatible displayType, or builder
 * tiles with incompatible displayType like Pie/Table/Heatmap/etc.).
 */
export async function cleanupDashboardAlerts({
  dashboardId,
  teamId,
  internalTiles,
  existingTileIds,
}: {
  dashboardId: string;
  teamId: string | mongoose.Types.ObjectId;
  internalTiles: DashboardDocument['tiles'];
  existingTileIds: Set<string>;
}) {
  const newTileIdSet = new Set(internalTiles.map(t => t.id));
  const tileIdsToDeleteAlerts = [
    // Tiles whose config no longer supports alerts (raw SQL or builder).
    ...internalTiles
      .filter(tile => {
        if (isRawSqlSavedChartConfig(tile.config)) {
          return !displayTypeSupportsRawSqlAlerts(tile.config.displayType);
        }
        if (isBuilderSavedChartConfig(tile.config)) {
          return !displayTypeSupportsBuilderAlerts(tile.config.displayType);
        }
        return false;
      })
      .map(tile => tile.id),
    // Tiles that were completely removed.
    ...[...existingTileIds].filter(id => !newTileIdSet.has(id)),
  ];
  if (tileIdsToDeleteAlerts.length > 0) {
    logger.info(
      { dashboardId, teamId, tileIds: tileIdsToDeleteAlerts },
      'Deleting alerts for tiles with unsupported config or removed tiles',
    );
    const teamObjectId =
      teamId instanceof mongoose.Types.ObjectId
        ? teamId
        : new mongoose.Types.ObjectId(teamId);
    await deleteDashboardAlerts(
      dashboardId,
      teamObjectId,
      tileIdsToDeleteAlerts,
    );
  }
}

// --------------------------------------------------------------------------------
// Body validation schemas
// --------------------------------------------------------------------------------

function buildDashboardBodySchema(filterSchema: z.ZodTypeAny): z.ZodEffects<
  z.ZodObject<
    typeof dashboardBodyBaseShape & {
      filters: z.ZodOptional<z.ZodArray<z.ZodTypeAny>>;
    }
  >
> {
  return z
    .object({
      ...dashboardBodyBaseShape,
      filters: z.array(filterSchema).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.savedQuery != null && data.savedQueryLanguage === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'savedQueryLanguage cannot be null when savedQuery is provided',
          path: ['savedQueryLanguage'],
        });
      }

      // Schema-level: only structural checks on containers (duplicate
      // ids, per-container tab-id uniqueness). Cross-tile resolution
      // moved to the request handler so a PUT can fall back to the
      // existing dashboard's containers when the body omits the field
      // (otherwise a tile that references a real preserved container
      // would be rejected against an empty `data.containers ?? []`).
      validateDashboardContainersStructure(data.containers ?? [], ctx);
    });
}

/**
 * Cross-tile container/tab reference resolution against an effective
 * container set. Used by the POST and PUT handlers in
 * `routers/external-api/v2/dashboards.ts`: POST validates against the
 * request body's containers, PUT validates against the request body's
 * containers when present, falling back to the existing dashboard's
 * containers when the body omits the field. Returns a list of
 * `path: message` strings shaped to mirror the body-schema validation
 * error format used by `validateRequestWithEnhancedErrors`.
 */
export function collectTileContainerRefIssues(
  containers: DashboardContainer[],
  tiles: ExternalDashboardTileWithId[],
): string[] {
  const schema = z.object({}).superRefine((_, ctx) => {
    const containerById = new Map<string, DashboardContainer>(
      containers.map(c => [c.id, c]),
    );
    validateDashboardTileContainerRefs(containerById, tiles, ctx);
  });
  const result = schema.safeParse({});
  if (result.success) return [];
  return result.error.issues.map(issue => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

export const createDashboardBodySchema = buildDashboardBodySchema(
  externalDashboardFilterSchema,
);
export const updateDashboardBodySchema = buildDashboardBodySchema(
  externalDashboardFilterSchemaWithId,
);
