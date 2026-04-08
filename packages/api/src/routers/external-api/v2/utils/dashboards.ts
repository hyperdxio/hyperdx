import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  AggregateFunctionSchema,
  BuilderSavedChartConfig,
  DisplayType,
  RawSqlSavedChartConfig,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { SearchConditionLanguageSchema as whereLanguageSchema } from '@hyperdx/common-utils/dist/types';
import { pick } from 'lodash';
import _ from 'lodash';
import mongoose from 'mongoose';
import { z } from 'zod';

import { getConnectionsByTeam } from '@/controllers/connection';
import { getSources } from '@/controllers/sources';
import { DashboardDocument } from '@/models/dashboard';
import { translateFilterToExternalFilter } from '@/utils/externalApi';
import logger from '@/utils/logger';
import {
  ExternalDashboardFilter,
  externalDashboardFilterSchema,
  externalDashboardFilterSchemaWithId,
  ExternalDashboardFilterWithId,
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

export function isSeriesTile(
  tile: ExternalDashboardTileWithId,
): tile is SeriesTile {
  return 'series' in tile && tile.series !== undefined;
}

export type ConfigTile = ExternalDashboardTileWithId & {
  config: Exclude<ExternalDashboardTileWithId['config'], undefined>;
};

export function isRawSqlExternalTileConfig(
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
};

// --------------------------------------------------------------------------------
// Conversion functions from internal dashboard format to external dashboard format
// --------------------------------------------------------------------------------

const DEFAULT_SELECT_ITEM: ExternalDashboardSelectItem = {
  aggFn: 'count',
  where: '',
};

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
    ...pick(item, ['valueExpression', 'alias', 'metricType', 'metricName']),
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
        ...pick(config, ['having', 'numberFormat']),
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
    case DisplayType.Heatmap:
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

  return {
    ...pick(tile, ['id', 'x', 'y', 'w', 'h']),
    name: tile.config.name ?? '',
    config: convertToExternalTileChartConfig(tile.config) ?? defaultTileConfig,
  };
}

export function convertToExternalDashboard(
  dashboard: DashboardDocument,
): ExternalDashboard {
  return {
    id: dashboard._id.toString(),
    name: dashboard.name,
    tiles: dashboard.tiles
      .map(convertTileToExternalChart)
      .filter(t => t !== undefined),
    tags: dashboard.tags || [],
    filters: dashboard.filters?.map(translateFilterToExternalFilter) || [],
    savedQuery: dashboard.savedQuery ?? null,
    savedQueryLanguage: dashboard.savedQueryLanguage ?? null,
    savedFilterValues: dashboard.savedFilterValues ?? [],
  };
}

// --------------------------------------------------------------------------------
// Conversion functions from external dashboard format to internal dashboard format
// --------------------------------------------------------------------------------

const convertToInternalSelectItem = (
  item: ExternalDashboardSelectItem,
): Exclude<BuilderSavedChartConfig['select'][number], string> => {
  return {
    ...pick(item, ['alias', 'metricType', 'metricName', 'aggFn', 'level']),
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const strippedConfig = _.omitBy(internalConfig, _.isNil) as SavedChartConfig;

  return {
    ...pick(externalTile, ['id', 'x', 'y', 'w', 'h', 'name']),
    config: strippedConfig,
  };
}

// --------------------------------------------------------------------------------
// Shared dashboard validation helpers (used by both the REST router and MCP tools)
// --------------------------------------------------------------------------------

/** Returns source IDs referenced in tiles/filters that do not exist for the team */
export async function getMissingSources(
  team: string | mongoose.Types.ObjectId,
  tiles: ExternalDashboardTileWithId[],
  filters?: (ExternalDashboardFilter | ExternalDashboardFilterWithId)[],
): Promise<string[]> {
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
  }

  if (filters?.length) {
    for (const filter of filters) {
      if ('sourceId' in filter) {
        sourceIds.add(filter.sourceId);
      }
    }
  }

  const existingSources = await getSources(team.toString());
  const existingSourceIds = new Set(
    existingSources.map(source => source._id.toString()),
  );
  return [...sourceIds].filter(sourceId => !existingSourceIds.has(sourceId));
}

/** Returns connection IDs referenced in tiles that do not belong to the team */
export async function getMissingConnections(
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
};

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
    });
}

export const createDashboardBodySchema = buildDashboardBodySchema(
  externalDashboardFilterSchema,
);
export const updateDashboardBodySchema = buildDashboardBodySchema(
  externalDashboardFilterSchemaWithId,
);
