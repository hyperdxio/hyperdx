import { use, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { buildSearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Button, Flex, Group } from '@mantine/core';
import { IconExternalLink, IconLogs } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import { getEventBody, useSource } from '@/source';
import { buildDirectTraceWhereClause } from '@/utils/directTrace';

import { RowSidePanelContext } from './DBRowSidePanel';
import { DBSqlRowTable } from './DBRowTable';

/**
 * One trace's logs, as a flat chronological table.
 *
 * Sibling view to the waterfall's interleaved log rows, for when a trace logs
 * enough that reading them inside the span tree stops working. Shows the whole
 * trace, unfiltered — "Open in search" is the way on to anything narrower.
 */
export default function TraceLogsPanel({
  logSourceId,
  traceId,
  dateRange,
  onNavigateToLog,
  'data-testid': dataTestId,
}: {
  logSourceId: string;
  traceId: string;
  dateRange: [Date, Date];
  onNavigateToLog: (
    rowId: string,
    aliasWith: WithClause[],
    label: string,
  ) => void;
  'data-testid'?: string;
}) {
  const { data: logSource, isLoading } = useSource({
    id: logSourceId,
    kinds: [SourceKind.Log],
  });

  // Trimmed so a whitespace-only expression counts as unconfigured rather than
  // rendering as a bare `=` in the trace filter.
  const traceIdExpression = logSource?.traceIdExpression?.trim();

  const traceWhere = useMemo(
    () =>
      traceIdExpression
        ? buildDirectTraceWhereClause(traceIdExpression, traceId)
        : undefined,
    [traceIdExpression, traceId],
  );

  const config = useMemo((): BuilderChartConfigWithDateRange | undefined => {
    if (logSource == null || traceWhere == null) {
      return undefined;
    }
    return {
      // Assembled through the shared builder so this query sees the same row
      // set as the search page and alerts do — it carries the source's
      // `tableFilterExpression`, sample weighting, and `source` id (which is
      // how the source's `querySettings` reach the query).
      ...buildSearchChartConfig(logSource, {
        where: traceWhere,
        whereLanguage: 'sql',
        // Ascending: inside a trace, chronological order is execution order.
        orderBy: `${logSource.timestampValueExpression} ASC`,
      }),
      limit: { limit: 200 },
      dateRange,
    };
  }, [logSource, traceWhere, dateRange]);

  const handleRowDetailsClick = useCallback(
    (rowWhere: RowWhereResult, row: Record<string, unknown>) => {
      // The table selects the source's own expressions, so the body sits under
      // its expression rather than a normalized alias.
      const body = logSource ? row[getEventBody(logSource) ?? ''] : undefined;
      onNavigateToLog(
        rowWhere.where,
        rowWhere.aliasWith,
        typeof body === 'string' && body.length > 0 ? body : 'Log',
      );
    },
    [logSource, onNavigateToLog],
  );

  const parentContext = use(RowSidePanelContext);

  // Both of the searched table's row actions are wrong for this table, which
  // lists another source's rows with its own columns: the cell popover's
  // filter buttons would write a log column into the searched source's
  // filters, and the header's remove-column action maps by index onto the
  // searched select. Filtering lives in search, which the link below opens.
  const rowSidePanelContextValue = useMemo(
    () => ({
      ...parentContext,
      onPropertyAddClick: undefined,
      displayedColumns: undefined,
      toggleColumn: undefined,
    }),
    [parentContext],
  );

  if (isLoading) {
    return null;
  }

  if (config == null || logSource == null || traceWhere == null) {
    return (
      <EmptyState
        icon={<IconLogs size={24} />}
        title="Correlated logs unavailable"
        description="This trace's log source is missing, or has no trace ID expression configured. Check the source's settings."
        variant="card"
        m="sm"
      />
    );
  }

  // The same rows in the full search page. Built here rather than through the
  // context's `generateSearchUrl`, which stamps the search page's own time
  // range and re-applies its filter pills — both would land the reader on a
  // different row set than the tab is showing.
  const searchUrl = `/search?${new URLSearchParams({
    source: logSource.id,
    where: traceWhere,
    whereLanguage: 'sql',
    from: dateRange[0].getTime().toString(),
    to: dateRange[1].getTime().toString(),
    isLive: 'false',
  }).toString()}`;

  return (
    <RowSidePanelContext value={rowSidePanelContextValue}>
      <Flex
        direction="column"
        mih={0}
        px="md"
        style={{ flexGrow: 1 }}
        data-testid={dataTestId}
      >
        <Group justify="flex-end" py="xs">
          <Button
            variant="link"
            size="xs"
            component={Link}
            href={searchUrl}
            rightSection={<IconExternalLink size={14} />}
            data-testid="trace-logs-open-in-search"
          >
            Open in search
          </Button>
        </Group>
        <div style={{ height: '100%', overflow: 'auto' }}>
          <DBSqlRowTable
            sourceId={logSource.id}
            config={config}
            queryKeyPrefix="trace-logs"
            isLive={false}
            showExpandButton={false}
            onRowDetailsClick={handleRowDetailsClick}
            onChildModalOpen={parentContext.setChildModalOpen}
          />
        </div>
      </Flex>
    </RowSidePanelContext>
  );
}
