import { useMemo } from 'react';
import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Box } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getDisplayedTimestampValueExpression, getEventBody } from '@/source';

import { DBRowJsonViewer } from './DBRowJsonViewer';

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
}

export function useRowData({
  source,
  rowId,
}: {
  source: TSource;
  rowId: string | undefined | null;
}) {
  const eventBodyExpr = getEventBody(source);

  const searchedTraceIdExpr = source.traceIdExpression;
  const searchedSpanIdExpr = source.spanIdExpression;

  const severityTextExpr =
    source.severityTextExpression || source.statusCodeExpression;

  return useQueriedChartConfig(
    {
      connection: source.connection,
      select: [
        {
          valueExpression: '*',
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
        ...(source.serviceNameExpression
          ? [
              {
                valueExpression: source.serviceNameExpression,
                alias: ROW_DATA_ALIASES.SERVICE_NAME,
              },
            ]
          : []),
        ...(source.resourceAttributesExpression
          ? [
              {
                valueExpression: source.resourceAttributesExpression,
                alias: ROW_DATA_ALIASES.RESOURCE_ATTRIBUTES,
              },
            ]
          : []),
        ...(source.eventAttributesExpression
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
      ],
      where: rowId ?? '0=1',
      from: source.from,
      limit: { limit: 1 },
    },
    {
      queryKey: ['row_side_panel', rowId, source],
      enabled: rowId != null,
    },
  );
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

export function RowDataPanel({
  source,
  rowId,
  'data-testid': dataTestId,
}: {
  source: TSource;
  rowId: string | undefined | null;
  'data-testid'?: string;
}) {
  const { data, isLoading, isError } = useRowData({ source, rowId });

  const firstRow = useMemo(() => {
    const firstRow = { ...(data?.data?.[0] ?? {}) };
    if (!firstRow) {
      return null;
    }
    return firstRow;
  }, [data]);

  const jsonColumns = getJSONColumnNames(data?.meta);

  return (
    <div className="flex-grow-1 bg-body overflow-auto" data-testid={dataTestId}>
      <Box mx="md" my="sm">
        <DBRowJsonViewer data={firstRow} jsonColumns={jsonColumns} />
      </Box>
    </div>
  );
}
