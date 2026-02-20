import {
  AggregateFunctionSchema,
  DisplayType,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { pick } from 'lodash';
import _ from 'lodash';

import { DashboardDocument } from '@/models/dashboard';
import { translateFilterToExternalFilter } from '@/utils/externalApi';
import logger from '@/utils/logger';
import {
  ExternalDashboardFilterWithId,
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
};

// --------------------------------------------------------------------------------
// Conversion functions from internal dashboard format to external dashboard format
// --------------------------------------------------------------------------------

const DEFAULT_SELECT_ITEM: ExternalDashboardSelectItem = {
  aggFn: 'count',
  where: '',
};

const convertToExternalSelectItem = (
  item: Exclude<SavedChartConfig['select'][number], string>,
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
  const sourceId = config.source?.toString() ?? '';

  const stringValueOrDefault = <D>(
    value: string | unknown,
    defaultValue: D,
  ): string | D => {
    return typeof value === 'string' ? value : defaultValue;
  };

  switch (config.displayType) {
    case 'line':
    case 'stacked_bar':
      return {
        displayType: config.displayType,
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
        ...(config.displayType === 'line'
          ? { compareToPreviousPeriod: config.compareToPreviousPeriod }
          : {}),
        numberFormat: config.numberFormat,
      };
    case 'number':
      return {
        displayType: config.displayType,
        sourceId,
        select: Array.isArray(config.select)
          ? [convertToExternalSelectItem(config.select[0])]
          : [DEFAULT_SELECT_ITEM],
        numberFormat: config.numberFormat,
      };
    case 'table':
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
    case 'search':
      return {
        displayType: config.displayType,
        sourceId,
        select: stringValueOrDefault(config.select, ''),
        where: config.where,
        whereLanguage: config.whereLanguage ?? 'lucene',
      };
    case 'markdown':
      return {
        displayType: config.displayType,
        markdown: stringValueOrDefault(config.markdown, ''),
      };
    default:
      logger.error(
        { config },
        'Error converting chart config to external chart - unrecognized display type',
      );
      return undefined;
  }
};

function convertTileToExternalChart(
  tile: DashboardDocument['tiles'][number],
): ExternalDashboardTileWithId {
  // Returned in case of a failure converting the saved chart config
  const defaultTileConfig: ExternalDashboardTileConfig = {
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
    tiles: dashboard.tiles.map(convertTileToExternalChart),
    tags: dashboard.tags || [],
    filters: dashboard.filters?.map(translateFilterToExternalFilter) || [],
  };
}

// --------------------------------------------------------------------------------
// Conversion functions from external dashboard format to internal dashboard format
// --------------------------------------------------------------------------------

const convertToInternalSelectItem = (
  item: ExternalDashboardSelectItem,
): Exclude<SavedChartConfig['select'][number], string> => {
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
      };
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
      };
      break;
    case 'number':
      internalConfig = {
        displayType: DisplayType.Number,
        select: [convertToInternalSelectItem(externalConfig.select[0])],
        source: externalConfig.sourceId,
        where: '',
        numberFormat: externalConfig.numberFormat,
        name,
      };
      break;
    case 'search':
      internalConfig = {
        ...pick(externalConfig, ['select', 'where']),
        displayType: DisplayType.Search,
        source: externalConfig.sourceId,
        name,
        whereLanguage: externalConfig.whereLanguage ?? 'lucene',
      };
      break;
    case 'markdown':
      internalConfig = {
        displayType: DisplayType.Markdown,
        markdown: externalConfig.markdown,
        source: '',
        where: '',
        select: [],
        name,
      };
      break;
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
