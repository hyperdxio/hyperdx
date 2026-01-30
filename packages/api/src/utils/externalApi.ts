import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import {
  AggregateFunctionSchema,
  DisplayType,
  SavedChartConfig,
  SelectList,
} from '@hyperdx/common-utils/dist/types';
import { pick } from 'lodash';
import { FlattenMaps, LeanDocument } from 'mongoose';

import {
  AlertChannel,
  AlertDocument,
  AlertInterval,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
import type { DashboardDocument } from '@/models/dashboard';
import {
  ChartSeries,
  ExternalDashboardTileWithId,
  MarkdownChartSeries,
  NumberChartSeries,
  SearchChartSeries,
  TableChartSeries,
  TimeChartSeries,
} from '@/utils/zod';

import logger from './logger';

function hasLevel(
  series: Omit<SelectList[number], string>,
): series is SelectList[number] & {
  level: number;
} {
  return 'level' in series && typeof series.level === 'number';
}

function isSortOrderDesc(config: SavedChartConfig): boolean {
  if (!config.orderBy) {
    return false;
  }

  if (typeof config.orderBy === 'string') {
    return config.orderBy.toLowerCase().endsWith(' desc');
  }

  if (Array.isArray(config.orderBy) && config.orderBy.length === 0) {
    return false;
  }

  return Array.isArray(config.orderBy) && config.orderBy[0].ordering === 'DESC';
}

const convertChartConfigToExternalChartSeries = (
  config: SavedChartConfig,
): ChartSeries[] => {
  const { displayType, source: sourceId, select, groupBy } = config;
  const isSelectArray = Array.isArray(select);
  const convertedGroupBy = Array.isArray(groupBy)
    ? groupBy.map(g => g.valueExpression)
    : splitAndTrimWithBracket(groupBy ?? '');

  switch (displayType) {
    case 'line':
    case 'stacked_bar':
      if (!isSelectArray) {
        logger.error(`Expected array select for displayType ${displayType}`);
        return [];
      }

      return select.map(s => {
        const aggFnSanitized = AggregateFunctionSchema.safeParse(
          s.aggFn ?? 'none',
        );
        return {
          ...pick(s, ['aggFn', 'alias', 'metricName', 'numberFormat']),
          aggFn: aggFnSanitized.success ? aggFnSanitized.data : 'none',
          type: 'time',
          sourceId,
          displayType,
          level: hasLevel(s) ? s.level : undefined,
          field: s.valueExpression,
          where: s.aggCondition ?? '',
          whereLanguage: s.aggConditionLanguage ?? 'lucene',
          groupBy: convertedGroupBy,
          metricDataType: s.metricType,
        } satisfies TimeChartSeries;
      });

    case 'table':
      if (!isSelectArray) {
        logger.error(`Expected array select for displayType ${displayType}`);
        return [];
      }

      return select.map(s => {
        const aggFnSanitized = AggregateFunctionSchema.safeParse(
          s.aggFn ?? 'none',
        );
        return {
          ...pick(s, ['aggFn', 'alias', 'metricName', 'numberFormat']),
          aggFn: aggFnSanitized.success ? aggFnSanitized.data : 'none',
          type: 'table',
          sourceId,
          level: hasLevel(s) ? s.level : undefined,
          field: s.valueExpression,
          where: s.aggCondition ?? '',
          whereLanguage: s.aggConditionLanguage ?? 'lucene',
          groupBy: convertedGroupBy,
          metricDataType: s.metricType,
          sortOrder: isSortOrderDesc(config) ? 'desc' : 'asc',
        } satisfies TableChartSeries;
      });

    case 'number': {
      if (!isSelectArray || select.length === 0) {
        logger.error(
          `Expected non-empty array select for displayType ${displayType}`,
        );
        return [];
      }

      const firstSelect = select[0];
      const aggFnSanitized = AggregateFunctionSchema.safeParse(
        firstSelect.aggFn ?? 'none',
      );

      return [
        {
          ...pick(firstSelect, [
            'aggFn',
            'alias',
            'metricName',
            'numberFormat',
          ]),
          aggFn: aggFnSanitized.success ? aggFnSanitized.data : 'none',
          type: 'number',
          sourceId,
          level: hasLevel(firstSelect) ? firstSelect.level : undefined,
          field: firstSelect.valueExpression,
          where: firstSelect.aggCondition ?? '',
          whereLanguage: firstSelect.aggConditionLanguage ?? 'lucene',
          metricDataType: firstSelect.metricType,
        },
      ] satisfies [NumberChartSeries];
    }

    case 'search': {
      if (isSelectArray) {
        logger.error(
          `Expected non-array select for displayType ${displayType}`,
        );
        return [];
      }

      return [
        {
          type: 'search',
          sourceId,
          fields: splitAndTrimWithBracket(select ?? ''),
          where: config.where ?? '',
          whereLanguage: config.whereLanguage ?? 'lucene',
        },
      ] satisfies [SearchChartSeries];
    }

    case 'markdown':
      return [
        {
          type: 'markdown',
          content: config.markdown || '',
        },
      ] satisfies [MarkdownChartSeries];

    case 'heatmap': // Heatmap is not supported in external API, and should not be present in dashboards
    default:
      logger.error(
        `DisplayType ${displayType} is not supported in external API`,
      );
      return [];
  }
};

function translateTileToExternalChart(
  tile: DashboardDocument['tiles'][number],
): ExternalDashboardTileWithId {
  const { name, seriesReturnType } = tile.config;
  return {
    ...pick(tile, ['id', 'x', 'y', 'w', 'h']),
    asRatio: seriesReturnType === 'ratio',
    name: name ?? '',
    series: convertChartConfigToExternalChartSeries(tile.config),
  };
}

export function translateExternalChartToTileConfig(
  chart: ExternalDashboardTileWithId,
): DashboardDocument['tiles'][number] {
  const { id, name, x, y, w, h, series, asRatio } = chart;

  if (series.length === 0) {
    throw new Error('Chart must have at least one series');
  }

  // API validation ensures all series have the same type
  const firstSeries = series[0];

  // Determine the sourceId and displayType based on series type
  let sourceId: string =
    firstSeries.type === 'markdown' ? '' : firstSeries.sourceId;
  let select: SavedChartConfig['select'] = '';
  let displayType: SavedChartConfig['displayType'];
  let groupBy: SavedChartConfig['groupBy'] = '';
  let where: SavedChartConfig['where'] = '';
  let whereLanguage: SavedChartConfig['whereLanguage'] = 'lucene';
  let orderBy: SavedChartConfig['orderBy'] = '';
  let markdown: SavedChartConfig['markdown'] = '';

  switch (firstSeries.type) {
    case 'time': {
      displayType =
        firstSeries.displayType === 'stacked_bar'
          ? DisplayType.StackedBar
          : DisplayType.Line;

      // Convert time series to select array
      select = series.map(s => {
        if (s.type !== 'time') {
          throw new Error('All series in a time chart must be time series');
        }
        return {
          aggFn: s.aggFn ?? undefined,
          valueExpression: s.field ?? '',
          alias: s.alias ?? undefined,
          aggCondition: s.where ?? '',
          aggConditionLanguage: s.whereLanguage ?? 'lucene',
          level: s.level ?? undefined,
          metricType: s.metricDataType ?? undefined,
          metricName: s.metricName ?? undefined,
        };
      });

      groupBy = firstSeries.groupBy.join(',');
      break;
    }

    case 'table': {
      displayType = DisplayType.Table;

      // Convert table series to select array
      select = series.map(s => {
        if (s.type !== 'table') {
          throw new Error('All series in a table chart must be table series');
        }
        return {
          aggFn: s.aggFn ?? undefined,
          valueExpression: s.field ?? '',
          alias: s.alias ?? undefined,
          aggCondition: s.where ?? '',
          aggConditionLanguage: s.whereLanguage ?? 'lucene',
          level: s.level ?? undefined,
          metricType: s.metricDataType ?? undefined,
          metricName: s.metricName ?? undefined,
        };
      });

      groupBy = firstSeries.groupBy.join(',');

      if (firstSeries.sortOrder && firstSeries.field) {
        orderBy = [
          {
            valueExpression: firstSeries.field,
            ordering: firstSeries.sortOrder === 'desc' ? 'DESC' : 'ASC',
          },
        ];
      }

      break;
    }

    case 'number': {
      displayType = DisplayType.Number;

      // Number chart uses only the first series
      select = [
        {
          aggFn: firstSeries.aggFn ?? undefined,
          valueExpression: firstSeries.field ?? '',
          alias: firstSeries.alias ?? undefined,
          aggCondition: firstSeries.where ?? '',
          aggConditionLanguage: firstSeries.whereLanguage ?? 'lucene',
          level: firstSeries.level ?? undefined,
          metricType: firstSeries.metricDataType ?? undefined,
          metricName: firstSeries.metricName ?? undefined,
        },
      ];

      break;
    }

    case 'search': {
      displayType = DisplayType.Search;
      // Search chart uses fields as a comma-separated string
      select = firstSeries.fields.join(', ');
      where = firstSeries.where ?? '';
      whereLanguage = firstSeries.whereLanguage ?? 'lucene';
      break;
    }

    case 'markdown': {
      displayType = DisplayType.Markdown;
      sourceId = 'markdown'; // Markdown charts don't have a sourceId, so we use a placeholder
      markdown = firstSeries.content;
      break;
    }

    default: {
      // Ensure exhaustive check at compile time
      const _exhaustiveCheck: never = firstSeries;
      throw new Error(`Invalid chart: ${_exhaustiveCheck}`);
    }
  }

  const config: SavedChartConfig = {
    name,
    source: sourceId,
    displayType,
    select,
    groupBy,
    where,
    whereLanguage,
    orderBy,
    markdown,
    seriesReturnType: asRatio ? 'ratio' : 'column',
  };

  return {
    id,
    x,
    y,
    w,
    h,
    config,
  };
}

export type ExternalDashboard = {
  id: string;
  name: string;
  tiles: ExternalDashboardTileWithId[];
  tags?: string[];
};

export type ExternalDashboardRequest = {
  name: string;
  tiles: ExternalDashboardTileWithId[];
  tags?: string[];
};

export function translateDashboardDocumentToExternalDashboard(
  dashboard: DashboardDocument,
): ExternalDashboard {
  return {
    id: dashboard._id.toString(),
    name: dashboard.name,
    tiles: dashboard.tiles.map(translateTileToExternalChart),
    tags: dashboard.tags || [],
  };
}

// Alert related types and transformations
export type ExternalAlert = {
  id: string;
  name?: string | null;
  message?: string | null;
  threshold: number;
  interval: AlertInterval;
  thresholdType: AlertThresholdType;
  source?: string;
  state: AlertState;
  channel: AlertChannel;
  team: string;
  tileId?: string;
  dashboard?: string;
  savedSearch?: string;
  groupBy?: string;
  silenced?: {
    by?: string;
    at: string;
    until: string;
  };
  createdAt?: string;
  updatedAt?: string;
};

type AlertDocumentObject =
  | AlertDocument
  | FlattenMaps<LeanDocument<AlertDocument>>;

function hasCreatedAt(
  alert: AlertDocumentObject,
): alert is AlertDocument & { createdAt: Date } {
  return 'createdAt' in alert && alert.createdAt instanceof Date;
}

function hasUpdatedAt(
  alert: AlertDocumentObject,
): alert is AlertDocument & { updatedAt: Date } {
  return 'updatedAt' in alert && alert.updatedAt instanceof Date;
}

function transformSilencedToExternalSilenced(
  silenced: AlertDocumentObject['silenced'],
): ExternalAlert['silenced'] {
  return silenced
    ? {
        by: silenced.by?.toString(),
        at: silenced.at.toISOString(),
        until: silenced.until.toISOString(),
      }
    : undefined;
}

export function translateAlertDocumentToExternalAlert(
  alert: AlertDocument,
): ExternalAlert {
  // Convert to plain object if it's a Mongoose document
  const alertObj: AlertDocumentObject = alert.toJSON
    ? alert.toJSON()
    : { ...alert };

  // Copy all fields, renaming _id to id, ensuring ObjectId's are strings
  const result = {
    id: alertObj._id.toString(),
    name: alertObj.name,
    message: alertObj.message,
    threshold: alertObj.threshold,
    interval: alertObj.interval,
    thresholdType: alertObj.thresholdType,
    source: alertObj.source,
    state: alertObj.state,
    channel: alertObj.channel,
    team: alertObj.team.toString(),
    tileId: alertObj.tileId,
    dashboard: alertObj.dashboard?.toString(),
    savedSearch: alertObj.savedSearch?.toString(),
    groupBy: alertObj.groupBy,
    silenced: transformSilencedToExternalSilenced(alertObj.silenced),
    createdAt: hasCreatedAt(alertObj)
      ? alertObj.createdAt.toISOString()
      : undefined,
    updatedAt: hasUpdatedAt(alertObj)
      ? alertObj.updatedAt.toISOString()
      : undefined,
  };

  return result;
}
