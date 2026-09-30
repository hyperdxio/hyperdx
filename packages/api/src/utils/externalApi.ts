import {
  isFilterBroadcastEnabled,
  isFilterRequired,
  isFilterVariableEnabled,
} from '@hyperdx/common-utils/dist/filters';
import {
  AlertErrorType,
  AlertThresholdType,
  BuilderSavedChartConfig,
  DashboardFilter,
  DisplayType,
  SavedChartConfig,
} from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';
import { Types } from 'mongoose';

import type { ObjectId } from '@/models';
import {
  AlertChannel,
  AlertDocument,
  AlertInterval,
  AlertState,
  getAlertChannels,
  IAlert,
} from '@/models/alert';
import type { DashboardDocument, IDashboard } from '@/models/dashboard';
import type { ISavedSearch } from '@/models/savedSearch';
import { SeriesTile } from '@/routers/external-api/v2/utils/dashboards';
import {
  isPopulatedRef,
  populatedRefOrNull,
  resolveAlertDisplayFields,
} from '@/utils/alerts';
import {
  ExternalAlertChartConfig,
  ExternalDashboardFilterWithId,
} from '@/utils/zod';

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
  const { id, name, x, y, w, h, series, asRatio, containerId, tabId } = chart;

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
    ...(containerId !== undefined ? { containerId } : {}),
    ...(tabId !== undefined ? { tabId } : {}),
  };
}

export function translateFilterToExternalFilter(
  filter: DashboardFilter,
): ExternalDashboardFilterWithId {
  // Omitted from responses unless the filter is required, so a GET response
  // can be PUT back verbatim.
  const omittedKeys = isFilterRequired(filter)
    ? []
    : (['minSelections', 'isGlobalRequirement'] as const);

  switch (filter.type) {
    case 'STATIC_LIST':
      return omit(filter, ...omittedKeys);

    case 'PROMETHEUS_LABEL':
      return {
        ...omit(filter, 'source', ...omittedKeys),
        sourceId: filter.source.toString(),
      };

    case 'QUERY_EXPRESSION': {
      // Ignore variableName and appliesToSourceIds if the filter is not in a mode that uses them
      const ignoredKeys = [
        ...omittedKeys,
        ...(isFilterVariableEnabled(filter) ? [] : (['variableName'] as const)),
        ...(isFilterBroadcastEnabled(filter)
          ? []
          : (['appliesToSourceIds'] as const)),
      ];
      return {
        ...omit(filter, 'source', ...ignoredKeys),
        sourceId: filter.source.toString(),
      };
    }

    default:
      filter satisfies never;
      return filter;
  }
}

export function translateExternalFilterToFilter(
  filter: ExternalDashboardFilterWithId,
): DashboardFilter {
  switch (filter.type) {
    case 'STATIC_LIST':
      return filter;

    case 'PROMETHEUS_LABEL':
      return { ...omit(filter, 'sourceId'), source: filter.sourceId };

    case 'QUERY_EXPRESSION':
      return { ...omit(filter, 'sourceId'), source: filter.sourceId };

    default:
      filter satisfies never;
      return filter;
  }
}

// Alert related types and transformations
export type ExternalAlert = {
  id: string;
  name?: string | null;
  displayName: string;
  tags: string[];
  message?: string | null;
  note?: string | null;
  threshold: number;
  thresholdMax?: number;
  interval: AlertInterval;
  scheduleOffsetMinutes?: number;
  scheduleStartAt?: string | null;
  numConsecutiveWindows?: number | null;
  thresholdType: AlertThresholdType;
  source?: string;
  state: AlertState;
  channel?: AlertChannel;
  channels?: AlertChannel[];
  teamId: string;
  tileId?: string;
  dashboardId?: string;
  savedSearchId?: string;
  groupBy?: string;
  /**
   * Inline alerts only, and only on single-alert responses (the list endpoint
   * stays lean): the alert's persisted chart config in the external
   * tile-config dialect.
   */
  chartConfig?: ExternalAlertChartConfig;
  silenced?: {
    by?: string;
    at: string;
    until: string;
  };
  executionErrors?: {
    timestamp: string;
    type: AlertErrorType;
    message: string;
  }[];
  createdAt?: string;
  updatedAt?: string;
};

// An alert's savedSearch/dashboard ref as this module receives it: a bare
// ObjectId, or — when the caller used a populating reader — the referenced
// document, possibly projected down to the display fields.
type AlertRef<T> = ObjectId | (Partial<T> & { _id: ObjectId }) | null;

type AlertRefFields = {
  savedSearch?: AlertRef<ISavedSearch>;
  dashboard?: AlertRef<IDashboard>;
};

type AlertDocumentObject = Omit<IAlert, keyof AlertRefFields> & {
  _id: ObjectId;
} & AlertRefFields;

export type TranslatableAlertDocument = Omit<
  AlertDocument,
  keyof AlertRefFields
> &
  AlertRefFields;

/**
 * A populated ref whose target was deleted resolves to `null` in `toJSON()`,
 * but Mongoose still holds the original id in `populated()`. Prefer that so the
 * response keeps pointing at the (now dangling) dashboard/saved search instead
 * of silently dropping the field.
 */
function refIdToString(
  ref: AlertRef<object> | undefined,
  populatedId: ObjectId | undefined,
): string | undefined {
  if (ref == null) {
    return populatedId?.toString();
  }
  return (isPopulatedRef(ref) ? ref._id : ref).toString();
}

/**
 * Mongoose types `populated()` as `any`; it returns the original ObjectId for
 * a populated single ref, and undefined when the path was never populated.
 */
function populatedRefId(
  alert: TranslatableAlertDocument,
  path: keyof AlertRefFields,
): ObjectId | undefined {
  const id: unknown =
    typeof alert.populated === 'function' ? alert.populated(path) : undefined;
  return id instanceof Types.ObjectId ? id : undefined;
}

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

function transformScheduleStartAt(
  scheduleStartAt: unknown,
): ExternalAlert['scheduleStartAt'] {
  if (scheduleStartAt === null) {
    return null;
  }

  if (scheduleStartAt === undefined) {
    return undefined;
  }

  if (scheduleStartAt instanceof Date) {
    return scheduleStartAt.toISOString();
  }

  return typeof scheduleStartAt === 'string' ? scheduleStartAt : undefined;
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

function transformErrorsToExternalErrors(
  errors: AlertDocumentObject['executionErrors'],
): ExternalAlert['executionErrors'] {
  return errors?.map(err => ({
    timestamp:
      err.timestamp instanceof Date
        ? err.timestamp.toISOString()
        : String(err.timestamp),
    type: err.type,
    message: err.message,
  }));
}

// Note: this translator does not attach an inline alert's `chartConfig`.
// Single-alert responses (GET by id, POST, PUT, MCP detail) attach it via
// `translateAlertDocumentToExternalAlertWithChartConfig` (v2 router util) —
// keeping the converter out of here avoids a runtime import cycle with the
// v2 utils, and list responses stay lean so a team with hundreds of raw-SQL
// inline alerts does not ship every template on each page.
export function translateAlertDocumentToExternalAlert(
  alert: TranslatableAlertDocument,
): ExternalAlert {
  // Convert to plain object if it's a Mongoose document. `flattenMaps: false`
  // picks the toJSON overload that doesn't wrap every field in FlattenMaps<>
  // (which breaks ObjectId); the alert schema has no Map fields, so the
  // runtime output is identical.
  const alertObj: AlertDocumentObject = alert.toJSON
    ? alert.toJSON({ flattenMaps: false })
    : { ...alert };

  const channels = getAlertChannels(alertObj);

  // The ref fields are populated documents when the caller used one of the
  // `*WithDisplayRefs` readers and bare ObjectIds otherwise.
  const dashboard = populatedRefOrNull(alertObj.dashboard);
  const savedSearch = populatedRefOrNull(alertObj.savedSearch);

  // Copy all fields, renaming _id to id, ensuring ObjectId's are strings
  const result = {
    id: alertObj._id.toString(),
    name: alertObj.name,
    ...resolveAlertDisplayFields(alertObj, { dashboard, savedSearch }),
    message: alertObj.message,
    note: alertObj.note ?? null,
    threshold: alertObj.threshold,
    thresholdMax: alertObj.thresholdMax,
    interval: alertObj.interval,
    ...(alertObj.scheduleOffsetMinutes != null && {
      scheduleOffsetMinutes: alertObj.scheduleOffsetMinutes,
    }),
    scheduleStartAt: transformScheduleStartAt(alertObj.scheduleStartAt),
    numConsecutiveWindows: alertObj.numConsecutiveWindows ?? null,
    thresholdType: alertObj.thresholdType,
    source: alertObj.source,
    state: alertObj.state,
    // Omit both fields when no channel resolves (e.g. a legacy `{type: null}`
    // channel) instead of emitting `channels: []` alongside a null-typed
    // `channel` -- that shape violates this API's own OpenAPI contract
    // (`AlertChannels` requires minItems: 1, and `AlertChannel`'s oneOf has no
    // branch for `{type: null}`).
    ...(channels.length > 0 && { channel: channels[0], channels }),
    teamId: alertObj.team.toString(),
    tileId: alertObj.tileId ?? undefined,
    dashboardId: refIdToString(
      alertObj.dashboard,
      populatedRefId(alert, 'dashboard'),
    ),
    savedSearchId: refIdToString(
      alertObj.savedSearch,
      populatedRefId(alert, 'savedSearch'),
    ),
    groupBy: alertObj.groupBy ?? undefined,
    silenced: transformSilencedToExternalSilenced(alertObj.silenced),
    executionErrors: transformErrorsToExternalErrors(alertObj.executionErrors),
    createdAt: hasCreatedAt(alertObj)
      ? alertObj.createdAt.toISOString()
      : undefined,
    updatedAt: hasUpdatedAt(alertObj)
      ? alertObj.updatedAt.toISOString()
      : undefined,
  };

  return result;
}
