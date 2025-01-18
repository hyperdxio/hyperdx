import { useMemo } from 'react';

import { TSource } from '@/commonTypes';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getEventBody, getFirstTimestampValueExpression } from '@/source';

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
          valueExpression: getFirstTimestampValueExpression(
            source.timestampValueExpression,
          ),
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
        ...(severityTextExpr
          ? [
              {
                valueExpression: severityTextExpr,
                alias: '__hdx_severity_text',
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

export function RowDataPanel({
  source,
  rowId,
}: {
  source: TSource;
  rowId: string | undefined | null;
}) {
  const { data, isLoading, isError } = useRowData({ source, rowId });

  const firstRow = useMemo(() => {
    const firstRow = { ...(data?.data?.[0] ?? {}) };
    if (!firstRow) {
      return null;
    }
    return firstRow;
  }, [data]);

  return (
    <div className="flex-grow-1 bg-body overflow-auto">
      <DBRowJsonViewer data={firstRow} />
    </div>
  );
}
