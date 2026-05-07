import { useMemo } from 'react';
import { TSource } from '@berg/common-utils/dist/types';
import { Box } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { WithClause } from '@/hooks/useRowWhere';

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
  aliasWith,
}: {
  source: TSource;
  rowId: string | undefined | null;
  aliasWith?: WithClause[];
}) {
  const queryResult = useQueriedChartConfig(
    {
      // Berg routes catalog/QueryExecutionContext resolution through
      // `chartConfig.connection` (= source id). An empty string here
      // makes the API fall back to `cfg.GLUE_CATALOG_ID`, which on
      // multi-catalog deployments points at the wrong catalog and the
      // row-detail SELECT silently returns no rows. Stamp the source id
      // so the bridge resolves the right catalog/database.
      connection: source.id,
      select: [
        { valueExpression: '*' },
        ...(source.timestampColumn
          ? [
              {
                valueExpression: source.timestampColumn,
                alias: ROW_DATA_ALIASES.TIMESTAMP,
              },
            ]
          : []),
      ],
      where: rowId ?? '0=1',
      from: { databaseName: source.database, tableName: source.table },
      limit: { limit: 1 },
      ...(aliasWith && aliasWith.length > 0 ? { with: aliasWith } : {}),
    },
    {
      queryKey: ['row_side_panel', rowId, aliasWith, source],
      enabled: rowId != null,
    },
  );

  return queryResult;
}

export function getJSONColumnNames(
  meta: { name: string; type: string }[] | undefined,
) {
  return (
    meta
      ?.filter(m => m.type === 'JSON' || m.type.startsWith('JSON('))
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

  return (
    <div className="flex-grow-1 overflow-auto" data-testid={dataTestId}>
      <Box mx="md" my="sm">
        <DBRowJsonViewer data={firstRow} jsonColumns={jsonColumns} />
      </Box>
    </div>
  );
}
