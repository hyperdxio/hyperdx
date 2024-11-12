import { useMemo } from 'react';
import { Paper, Text } from '@mantine/core';
import { usePrevious } from '@mantine/hooks';

import { TSource } from '@/commonTypes';
import HyperJson from '@/components/HyperJson';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getEventBody } from '@/source';

export function useRowData({
  source,
  rowId,
}: {
  source: TSource;
  rowId: string | undefined | null;
}) {
  const eventBodyExpr = getEventBody(source);

  const searchedTraceIdExpr = source.traceIdExpression;

  return useQueriedChartConfig(
    {
      connection: source.connection,
      select: [
        {
          valueExpression: '*',
        },
        {
          valueExpression: source.timestampValueExpression,
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

  const rowData = useMemo(() => {
    const firstRow = { ...(data?.data?.[0] ?? {}) };
    if (!firstRow) {
      return null;
    }

    // Remove internal aliases
    delete firstRow['__hdx_timestamp'];
    delete firstRow['__hdx_trace_id'];
    delete firstRow['__hdx_body'];
    return firstRow;
  }, [data]);

  return (
    <div className="flex-grow-1 bg-body overflow-auto">
      <Paper bg="transparent" mt="sm">
        {rowData != null ? (
          <HyperJson
            data={rowData}
            normallyExpanded={true}
            tabulate={true}
            lineWrap={true}
            getLineActions={undefined}
          />
        ) : (
          <Text>No data</Text>
        )}
      </Paper>
    </div>
  );
}
