import {
  BuilderSavedChartConfig,
  DashboardFilter,
  DisplayType,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';
import { FlattenMaps, LeanDocument } from 'mongoose';

import {
  AlertChannel,
  AlertDocument,
  AlertInterval,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
import type { DashboardDocument } from '@/models/dashboard';
import { SeriesTile } from '@/routers/external-api/v2/utils/dashboards';
import { ExternalDashboardFilterWithId } from '@/utils/zod';

/** Returns a new object containing only the truthy, requested keys from the original object */
const pickIfTruthy = <T, K extends keyof T>(obj: T, keys: K[]): Partial<T> => {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (obj[key]) {
      result[key] = obj[key];
    }
  }
  return result;
};

export function translateExternalChartToTileConfig(
  chart: SeriesTile,
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
  let select: BuilderSavedChartConfig['select'] = '';
  let displayType: BuilderSavedChartConfig['displayType'];
  let groupBy: BuilderSavedChartConfig['groupBy'] = '';
  let where: BuilderSavedChartConfig['where'] = '';
  let whereLanguage: BuilderSavedChartConfig['whereLanguage'] = 'lucene';
  let orderBy: BuilderSavedChartConfig['orderBy'] = '';
  let markdown: BuilderSavedChartConfig['markdown'] = '';
  let numberFormat: BuilderSavedChartConfig['numberFormat'] = undefined;

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

        // Take the first numberFormat found among series
        if (s.numberFormat && !numberFormat) {
          numberFormat = s.numberFormat;
        }

        return {
          // Avoid including undefined values in the object, so that they are not saved as "null" in Mongo
          ...pickIfTruthy(s, ['alias', 'aggFn', 'level', 'metricName']),
          ...(s.metricDataType ? { metricType: s.metricDataType } : {}),
          valueExpression: s.field ?? '',
          aggCondition: s.where ?? '',
          aggConditionLanguage: s.whereLanguage ?? 'lucene',
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

        // Take the first numberFormat found among series
        if (s.numberFormat && !numberFormat) {
          numberFormat = s.numberFormat;
        }

        return {
          // Avoid including undefined values in the object, so that they are not saved as "null" in Mongo
          ...pickIfTruthy(s, ['alias', 'aggFn', 'level', 'metricName']),
          ...(s.metricDataType ? { metricType: s.metricDataType } : {}),
          valueExpression: s.field ?? '',
          aggCondition: s.where ?? '',
          aggConditionLanguage: s.whereLanguage ?? 'lucene',
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
      numberFormat = firstSeries.numberFormat;

      // Number chart uses only the first series
      select = [
        {
          // Avoid including undefined values in the object, so that they are not saved as "null" in Mongo
          ...pickIfTruthy(firstSeries, [
            'alias',
            'aggFn',
            'level',
            'metricName',
          ]),
          ...(firstSeries.metricDataType
            ? { metricType: firstSeries.metricDataType }
            : {}),
          valueExpression: firstSeries.field ?? '',
          aggCondition: firstSeries.where ?? '',
          aggConditionLanguage: firstSeries.whereLanguage ?? 'lucene',
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

  const seriesReturnType = asRatio ? 'ratio' : 'column';

  const config: SavedChartConfig = {
    // Avoid including undefined values in the object, so that they are not saved as "null" in Mongo
    ...pickIfTruthy(
      {
        groupBy,
        orderBy,
        markdown,
        seriesReturnType,
        numberFormat,
      },
      ['groupBy', 'orderBy', 'markdown', 'seriesReturnType', 'numberFormat'],
    ),
    name,
    source: sourceId,
    displayType,
    select,
    where,
    whereLanguage,
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

export function translateFilterToExternalFilter(
  filter: DashboardFilter,
): ExternalDashboardFilterWithId {
  return {
    ...omit(filter, 'source'),
    sourceId: filter.source.toString(),
  };
}

export function translateExternalFilterToFilter(
  filter: ExternalDashboardFilterWithId,
): DashboardFilter {
  return {
    ...omit(filter, 'sourceId'),
    source: filter.sourceId,
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
  teamId: string;
  tileId?: string;
  dashboardId?: string;
  savedSearchId?: string;
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
    teamId: alertObj.team.toString(),
    tileId: alertObj.tileId,
    dashboardId: alertObj.dashboard?.toString(),
    savedSearchId: alertObj.savedSearch?.toString(),
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
