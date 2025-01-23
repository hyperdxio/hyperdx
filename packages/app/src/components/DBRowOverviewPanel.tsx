import { useMemo } from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Accordion } from '@mantine/core';

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

export function RowOverviewPanel({
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

  const resourceAttributes = useMemo(() => {
    return firstRow[source.resourceAttributesExpression!] || {};
  }, [firstRow, source.resourceAttributesExpression]);

  const eventAttributes = useMemo(() => {
    return firstRow[source.eventAttributesExpression!] || {};
  }, [firstRow, source.eventAttributesExpression]);

  return (
    <div className="flex-grow-1 bg-body overflow-auto">
      <Accordion
        defaultValue={['resourceAttributes', 'eventAttributes']}
        multiple
      >
        <Accordion.Item value="resourceAttributes">
          <Accordion.Control>Resource Attributes</Accordion.Control>
          <Accordion.Panel>
            <DBRowJsonViewer data={resourceAttributes} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="eventAttributes">
          <Accordion.Control>
            {source.kind === 'log' ? 'Log' : 'Span'} Attributes
          </Accordion.Control>
          <Accordion.Panel>
            <DBRowJsonViewer data={eventAttributes} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </div>
  );
}
