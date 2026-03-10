import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  AggregateFunctionSchema,
  BuilderSavedChartConfig,
  DisplayType,
  RawSqlSavedChartConfig,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { pick } from 'lodash';
import _ from 'lodash';

import { DashboardDocument } from '@/models/dashboard';
import { translateFilterToExternalFilter } from '@/utils/externalApi';
import logger from '@/utils/logger';
import {
  ExternalDashboardFilterWithId,
  ExternalDashboardRawSqlTileConfig,
  ExternalDashboardSelectItem,
  ExternalDashboardTileConfig,
  ExternalDashboardTileWithId,
  externalQuantileLevelSchema,
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
          numberFormat: config.numberFormat,
        };
      case DisplayType.Number:
        return {
          configType: 'sql',
          displayType: DisplayType.Number,
          connectionId: config.connection,
          sqlTemplate: config.sqlTemplate,
          numberFormat: config.numberFormat,
        };
      case DisplayType.Pie:
        return {
          configType: 'sql',
          displayType: DisplayType.Pie,
          connectionId: config.connection,
          sqlTemplate: config.sqlTemplate,
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
