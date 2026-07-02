import { useMemo } from 'react';
import { flatten } from 'flat';
import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import {
  isLogSource,
  isTraceSource,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { WithClause } from '@/hooks/useRowWhere';
import { getDisplayedTimestampValueExpression, getEventBody } from '@/source';
import { getSelectExpressionsForHighlightedAttributes } from '@/utils/highlightedAttributes';

import { DBRowJsonViewer } from './DBRowJsonViewer';
import { getActiveInfraCorrelations } from './infraCorrelations';

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
  SPAN_LINKS = '__hdx_span_links',
}

export function useRowData({
  source,
  rowId,
  aliasWith,
}: {
  source: TSource;
  rowId: string | undefined | null;
  aliasWith?: WithClause[];
}) {
  const eventBodyExpr = getEventBody(source);

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

  const queryResult = useQueriedChartConfig(
    {
      connection: source.connection,
      select: [
        {
          valueExpression: knownColumns || '*',
        },
        {
          valueExpression: getDisplayedTimestampValueExpression(source),
          alias: ROW_DATA_ALIASES.TIMESTAMP,
        },
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
    },
    {
      queryKey: ['row_side_panel', rowId, aliasWith, source],
      enabled: rowId != null,
    },
  );

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
    data: normalizedData,
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
  'data-testid': dataTestId,
}: {
  source: TSource;
  rowId: string | undefined | null;
  aliasWith?: WithClause[];
  'data-testid'?: string;
}) {
  const { data } = useRowData({ source, rowId, aliasWith });

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
      <Box mx="md" my="sm">
        <DBRowJsonViewer
          data={firstRow}
          jsonColumns={jsonColumns}
          mapColumns={mapColumns}
        />
      </Box>
    </div>
  );
}
