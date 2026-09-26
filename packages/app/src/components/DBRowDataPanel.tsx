import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { flatten } from 'flat';
import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import {
  isLogSource,
  isTraceSource,
  QuerySettings,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box } from '@mantine/core';

import {
  mergeQuerySettings,
  useQueriedChartConfig,
} from '@/hooks/useChartConfig';
import { WithClause } from '@/hooks/useRowWhere';
import {
  getDisplayedTimestampValueExpression,
  getDurationMsExpression,
  getEventBody,
} from '@/source';
import { getSelectExpressionsForHighlightedAttributes } from '@/utils/highlightedAttributes';
import { getTimestampValueSelects } from '@/utils/rowTimestamps';

import { DBRowJsonViewer } from './DBRowJsonViewer';
import { getActiveInfraCorrelations } from './infraCorrelations';

// The source's own `timestampValueExpression` columns are projected too, under
// the `__hdx_timestamp_value_<i>` aliases owned by `@/utils/rowTimestamps`.
export enum ROW_DATA_ALIASES {
  TIMESTAMP = '__hdx_timestamp',
  BODY = '__hdx_body',
  TRACE_ID = '__hdx_trace_id',
  SPAN_ID = '__hdx_span_id',
  SEVERITY_TEXT = '__hdx_severity_text',
  SERVICE_NAME = '__hdx_service_name',
  RESOURCE_ATTRIBUTES = '__hdx_resource_attributes',
  EVENT_ATTRIBUTES = '__hdx_event_attributes',
  EVENTS_EXCEPTION_ATTRIBUTES = '__hdx_events_exception_attributes',
  SPAN_EVENTS = '__hdx_span_events',
  DURATION_MS = '__hdx_duration_ms',
  SPAN_KIND = '__hdx_span_kind',
  SPAN_LINKS = '__hdx_span_links',
}

// ClickHouse leaves MATERIALIZED and ALIAS columns out of `SELECT *` unless
// these settings are on, so the row panel would hide those columns.
const SELECT_ALL_COLUMNS_QUERY_SETTINGS: QuerySettings = [
  { setting: 'asterisk_include_materialized_columns', value: '1' },
  { setting: 'asterisk_include_alias_columns', value: '1' },
];

// Connections whose user cannot change these settings (for example, a
// `readonly = 1` user). Shared by every row lookup, so each one fails once.
// Read it through useSyncExternalStore: the React Compiler memoizes plain reads.
const connectionsRejectingSelectAllSettings = new Set<string>();
const rejectedConnectionListeners = new Set<() => void>();

function subscribeToRejectedConnections(listener: () => void) {
  rejectedConnectionListeners.add(listener);
  return () => {
    rejectedConnectionListeners.delete(listener);
  };
}

function markConnectionRejectingSettings(connection: string) {
  if (!connectionsRejectingSelectAllSettings.has(connection)) {
    connectionsRejectingSelectAllSettings.add(connection);
    rejectedConnectionListeners.forEach(listener => listener());
  }
}

// ClickHouse names the setting in each rejection: READONLY (164),
// UNKNOWN_SETTING (115) and SETTING_CONSTRAINT_VIOLATION (452).
function isSelectAllSettingRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return SELECT_ALL_COLUMNS_QUERY_SETTINGS.some(({ setting }) =>
    message.includes(setting),
  );
}

export function useRowData({
  source,
  rowId,
  aliasWith,
  dateRange,
}: {
  source: TSource;
  rowId: string | undefined | null;
  aliasWith?: WithClause[];
  /**
   * Optional window to bound the lookup by. Applied against the source's
   * `timestampValueExpression` (not the displayed timestamp), so a row id that
   * carries no timestamp of its own — e.g. the `TraceId`/`SpanId` pair "View
   * Trace" synthesizes — can still prune parts instead of scanning the table.
   * Callers must memoize the tuple; it participates in the query key.
   */
  dateRange?: [Date, Date];
}) {
  const eventBodyExpr = getEventBody(source);

  const timestampValueExpr = source.timestampValueExpression?.trim()
    ? source.timestampValueExpression
    : undefined;

  const searchedTraceIdExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.traceIdExpression
      : undefined;
  const searchedSpanIdExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.spanIdExpression
      : undefined;

  const severityTextExpr = isLogSource(source)
    ? source.severityTextExpression
    : isTraceSource(source)
      ? source.statusCodeExpression
      : undefined;

  const selectHighlightedRowAttributes =
    source.kind === SourceKind.Trace || source.kind === SourceKind.Log
      ? getSelectExpressionsForHighlightedAttributes(
          source.highlightedRowAttributeExpressions,
        )
      : [];

  // `SELECT *` can fail against a Distributed/Merge table whose underlying
  // target tables declare different column sets. When the source declares a
  // "known columns" list (columns known to exist across all target tables) we
  // select that instead of `*` when fetching full row data.
  const knownColumns =
    isLogSource(source) || isTraceSource(source)
      ? source.knownColumnsListExpression?.trim()
      : undefined;

  const baseConfig = {
    connection: source.connection,
    select: [
      {
        valueExpression: knownColumns || '*',
      },
      {
        valueExpression: getDisplayedTimestampValueExpression(source),
        alias: ROW_DATA_ALIASES.TIMESTAMP,
      },
      ...getTimestampValueSelects(timestampValueExpr),
      ...(eventBodyExpr
        ? [
            {
              valueExpression: eventBodyExpr,
              alias: ROW_DATA_ALIASES.BODY,
            },
          ]
        : []),
      ...(searchedTraceIdExpr
        ? [
            {
              valueExpression: searchedTraceIdExpr,
              alias: ROW_DATA_ALIASES.TRACE_ID,
            },
          ]
        : []),
      ...(searchedSpanIdExpr
        ? [
            {
              valueExpression: searchedSpanIdExpr,
              alias: ROW_DATA_ALIASES.SPAN_ID,
            },
          ]
        : []),
      ...(severityTextExpr
        ? [
            {
              valueExpression: severityTextExpr,
              alias: ROW_DATA_ALIASES.SEVERITY_TEXT,
            },
          ]
        : []),
      ...((isLogSource(source) || isTraceSource(source)) &&
      source.serviceNameExpression
        ? [
            {
              valueExpression: source.serviceNameExpression,
              alias: ROW_DATA_ALIASES.SERVICE_NAME,
            },
          ]
        : []),
      ...('resourceAttributesExpression' in source &&
      source.resourceAttributesExpression
        ? [
            {
              valueExpression: source.resourceAttributesExpression,
              alias: ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES,
            },
          ]
        : []),
      ...((isLogSource(source) || isTraceSource(source)) &&
      source.eventAttributesExpression
        ? [
            {
              valueExpression: source.eventAttributesExpression,
              alias: ROW_DATA_ALIASES.EVENT_ATTRIBUTES,
            },
          ]
        : []),
      ...(source.kind === SourceKind.Trace && source.spanEventsValueExpression
        ? [
            {
              valueExpression: `${source.spanEventsValueExpression}.Attributes[indexOf(${source.spanEventsValueExpression}.Name, 'exception')]`,
              alias: ROW_DATA_ALIASES.EVENTS_EXCEPTION_ATTRIBUTES,
            },
            {
              valueExpression: source.spanEventsValueExpression,
              alias: ROW_DATA_ALIASES.SPAN_EVENTS,
            },
          ]
        : []),
      ...(source.kind === SourceKind.Trace && source.durationExpression
        ? [
            {
              valueExpression: getDurationMsExpression(source),
              alias: ROW_DATA_ALIASES.DURATION_MS,
            },
          ]
        : []),
      ...(source.kind === SourceKind.Trace && source.spanKindExpression
        ? [
            {
              valueExpression: source.spanKindExpression,
              alias: ROW_DATA_ALIASES.SPAN_KIND,
            },
          ]
        : []),
      ...(source.kind === SourceKind.Trace && source.spanLinksValueExpression
        ? [
            {
              valueExpression: source.spanLinksValueExpression,
              alias: ROW_DATA_ALIASES.SPAN_LINKS,
            },
          ]
        : []),
      ...selectHighlightedRowAttributes,
    ],
    where: rowId ?? '0=1',
    from: source.from,
    limit: { limit: 1 },
    ...(aliasWith && aliasWith.length > 0 ? { with: aliasWith } : {}),
  };

  const connection = source.connection;
  const rejectsSettings = useSyncExternalStore(
    subscribeToRejectedConnections,
    () => connectionsRejectingSelectAllSettings.has(connection),
    () => false,
  );
  // The row query has no `config.source`, so the source's query settings do not
  // reach it. Use the source's own value for these two settings here.
  const additionalQuerySettings =
    knownColumns || rejectsSettings
      ? undefined
      : mergeQuerySettings(
          source.querySettings?.filter(({ setting }) =>
            SELECT_ALL_COLUMNS_QUERY_SETTINGS.some(
              defaultSetting => defaultSetting.setting === setting,
            ),
          ),
          SELECT_ALL_COLUMNS_QUERY_SETTINGS,
        );
  // A rejected setting will fail again, so only other errors keep the retry.
  const settingsQueryOptions = additionalQuerySettings
    ? {
        additionalQuerySettings,
        retry: (failureCount: number, error: Error) =>
          failureCount < 1 && !isSelectAllSettingRejected(error),
      }
    : {};

  const baseQueryKey = ['row_side_panel', rowId, aliasWith, source];
  // Both halves of the filter are needed for `renderChartConfig` to emit one, so
  // a source with no usable timestamp expression can't be bounded at all.
  const hasWindow = dateRange != null && timestampValueExpr != null;

  const boundedResult = useQueriedChartConfig(
    {
      ...baseConfig,
      ...(hasWindow
        ? { dateRange, timestampValueExpression: timestampValueExpr }
        : {}),
    },
    {
      queryKey: [...baseQueryKey, dateRange],
      enabled: rowId != null && hasWindow,
      ...settingsQueryOptions,
    },
  );

  // The window may be derived from a *different* row than the one we're
  // looking for (eg. looking up a span based on a log's timestamp). If the
  // window excludes the row, the bounded query returns zero rows.
  const isBoundedEmpty =
    hasWindow &&
    boundedResult.isSuccess &&
    boundedResult.data?.isComplete !== false && // Defensive check against chunked queries
    boundedResult.data?.data?.length === 0;

  const isFallbackActive = !hasWindow || isBoundedEmpty;

  // Key is identical to the unbounded config so this shares cache entries
  // with the call sites that never pass a `dateRange`, letting the retry
  // often resolve from cache instead of scanning.
  const fallbackResult = useQueriedChartConfig(baseConfig, {
    queryKey: [...baseQueryKey, undefined],
    enabled: rowId != null && isFallbackActive,
    ...settingsQueryOptions,
  });

  const queryResult = isFallbackActive ? fallbackResult : boundedResult;

  const isSettingsRejected =
    additionalQuerySettings != null &&
    queryResult.isError &&
    isSelectAllSettingRejected(queryResult.error);
  useEffect(() => {
    if (isSettingsRejected) {
      markConnectionRejectingSettings(connection);
    }
  }, [isSettingsRejected, connection]);

  // The bounded result is known-empty by the time the retry is enabled, so
  // report loading until it settles rather than briefly claiming the row is
  // absent. The same applies while the row is fetched again without settings.
  const isLoading =
    queryResult.isLoading ||
    isSettingsRejected ||
    (isBoundedEmpty && queryResult.isPending);

  // Normalize resource and event attributes to always use flat keys for both JSON and Map columns
  const normalizedData = useMemo(() => {
    if (!queryResult.data?.data?.[0]) {
      return queryResult.data;
    }

    const row = queryResult.data.data[0];
    const normalizedRow = { ...row };

    if (row[ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES]) {
      normalizedRow[ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES] = flatten(
        row[ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES],
      );
    }

    if (row[ROW_DATA_ALIASES.EVENT_ATTRIBUTES]) {
      normalizedRow[ROW_DATA_ALIASES.EVENT_ATTRIBUTES] = flatten(
        row[ROW_DATA_ALIASES.EVENT_ATTRIBUTES],
      );
    }

    return {
      ...queryResult.data,
      data: [normalizedRow],
    };
  }, [queryResult.data]);

  return {
    ...queryResult,
    ...(isSettingsRejected ? { isError: false, error: null } : {}),
    data: normalizedData,
    isLoading,
  };
}

// Detects whether a normalized row carries resource attributes that match a
// built-in infrastructure correlation (Kubernetes Pod or Node today), used to
// conditionally surface the Infrastructure tab/panel. Delegates to the same
// descriptor list the panel renders from, so the gate and the render never
// drift apart. Requires the source to expose resource attributes; returns
// false (rather than throwing) on any gap.
export function rowHasK8sContext(
  source: TSource | null | undefined,
  normalizedRow: Record<string, any> | null | undefined,
): boolean {
  try {
    if (
      source == null ||
      !('resourceAttributesExpression' in source) ||
      !source.resourceAttributesExpression ||
      !normalizedRow
    ) {
      return false;
    }

    const resourceAttrs = normalizedRow[ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES];
    return getActiveInfraCorrelations(resourceAttrs).length > 0;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export function getJSONColumnNames(meta: ResponseJSON['meta'] | undefined) {
  return (
    meta
      // The type could either be just 'JSON' or it could be 'JSON(<parameters>)'
      // this is a basic way to match both cases
      ?.filter(m => m.type === 'JSON' || m.type.startsWith('JSON('))
      .map(m => m.name) ?? []
  );
}

// Returns the names of Map-typed columns in the result metadata. Used by
// `mergePath` to keep numeric-looking sub-keys on a Map(String, ...) from
// collapsing into ClickHouse array-index syntax (`Map[2]`), which the
// server rejects with
// `Illegal types of arguments: Map(String, ...), UInt8 for function
// arrayElement`. HDX-4369.
export function getMapColumnNames(meta: ResponseJSON['meta'] | undefined) {
  return (
    meta
      // Match both `Map(K, V)` and the bare `Map` (rare; defensive).
      ?.filter(m => m.type === 'Map' || m.type.startsWith('Map('))
      .map(m => m.name) ?? []
  );
}

export function RowDataPanel({
  source,
  rowId,
  aliasWith,
  dateRange,
  flush = false,
  'data-testid': dataTestId,
}: {
  source: TSource;
  rowId: string | undefined | null;
  aliasWith?: WithClause[];
  dateRange?: [Date, Date];
  // When true, drop the horizontal margin so content aligns flush with
  // surrounding chrome (e.g. the tab bar in the trace span detail panel).
  flush?: boolean;
  'data-testid'?: string;
}) {
  const { data } = useRowData({ source, rowId, aliasWith, dateRange });

  const firstRow = useMemo(() => {
    const firstRow = { ...(data?.data?.[0] ?? {}) };
    if (!firstRow) {
      return null;
    }
    return firstRow;
  }, [data]);

  const jsonColumns = getJSONColumnNames(data?.meta);
  const mapColumns = getMapColumnNames(data?.meta);

  return (
    <div className="flex-grow-1 overflow-auto" data-testid={dataTestId}>
      <Box mx={flush ? 0 : 'md'} my="sm">
        <DBRowJsonViewer
          data={firstRow}
          jsonColumns={jsonColumns}
          mapColumns={mapColumns}
        />
      </Box>
    </div>
  );
}
