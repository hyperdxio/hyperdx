import { useMemo } from 'react';
import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Box } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getDisplayedTimestampValueExpression, getEventBody } from '@/source';

import { DBRowJsonViewer } from './DBRowJsonViewer';

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
          alias: '__hdx_timestamp',
        },
        ...(eventBodyExpr
          ? [
              {
                valueExpression: eventBodyExpr,
                alias: '__hdx_body',
              },
            ]
          : []),
        ...(searchedTraceIdExpr
          ? [
              {
                valueExpression: searchedTraceIdExpr,
                alias: '__hdx_trace_id',
              },
            ]
          : []),
        ...(searchedSpanIdExpr
          ? [
              {
                valueExpression: searchedSpanIdExpr,
                alias: '__hdx_span_id',
              },
            ]
          : []),
        ...(severityTextExpr
          ? [
              {
                valueExpression: severityTextExpr,
                alias: '__hdx_severity_text',
              },
            ]
          : []),
        ...(source.serviceNameExpression
          ? [
              {
                valueExpression: source.serviceNameExpression,
                alias: '__hdx_service_name',
              },
            ]
          : []),
        ...(source.resourceAttributesExpression
          ? [
              {
                valueExpression: source.resourceAttributesExpression,
                alias: '__hdx_resource_attributes',
              },
            ]
          : []),
        ...(source.eventAttributesExpression
          ? [
              {
                valueExpression: source.eventAttributesExpression,
                alias: '__hdx_event_attributes',
              },
            ]
          : []),
        ...(source.kind === SourceKind.Trace && source.spanEventsValueExpression
          ? [
              {
                valueExpression: `${source.spanEventsValueExpression}.Attributes[indexOf(${source.spanEventsValueExpression}.Name, 'exception')]`,
                alias: '__hdx_events_exception_attributes',
              },
              {
                valueExpression: source.spanEventsValueExpression,
                alias: '__hdx_span_events',
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
