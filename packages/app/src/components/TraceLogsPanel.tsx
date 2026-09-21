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
import { parseAsSortingStateString } from '@/utils/queryParsers';

import { RowSidePanelContext } from './DBRowSidePanel';
import { DBSqlRowTable } from './DBRowTable';

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

  // `min(1)` on the schema accepts a space, which would render as a bare `=`.
  const traceIdExpression = logSource?.traceIdExpression?.trim();

  const traceWhere = useMemo(
    () =>
      traceIdExpression
        ? buildDirectTraceWhereClause(traceIdExpression, traceId)
        : undefined,
    [traceIdExpression, traceId],
  );

  // Inside a trace, chronological order is execution order.
  const orderBy = logSource
    ? `${logSource.timestampValueExpression} ASC`
    : undefined;

  const config = useMemo((): BuilderChartConfigWithDateRange | undefined => {
    if (logSource == null || traceWhere == null) {
      return undefined;
    }
    return {
      // Carries the source's tableFilterExpression, sample weighting and id.
      ...buildSearchChartConfig(logSource, {
        where: traceWhere,
        whereLanguage: 'sql',
        orderBy,
      }),
      limit: { limit: 200 },
      dateRange,
    };
  }, [logSource, traceWhere, orderBy, dateRange]);

  const handleRowDetailsClick = useCallback(
    (rowWhere: RowWhereResult, row: Record<string, unknown>) => {
      // The table selects the source's expressions, not normalized aliases.
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

  // These rows aren't the searched table's: its cell filter would write a log
  // column into that source's filters, and its column removal maps by index.
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

  const parsedSort = parseAsSortingStateString.parse(orderBy ?? '');
  const sortBy = parsedSort ? [parsedSort] : undefined;

  // Not `generateSearchUrl`: it stamps the search page's time range and filter
  // pills, landing the reader on a different row set. `where` and `select` are
  // read by `parseAsStringEncoded`, which decodes one level past the query
  // string's own; `select` also seeds the page's SELECT input, which is blank
  // without it.
  const searchUrl = `/search?${new URLSearchParams({
    source: logSource.id,
    select: encodeURIComponent(logSource.defaultTableSelectExpression),
    where: encodeURIComponent(traceWhere),
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
            tableId="trace-logs"
            initialSortBy={sortBy}
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
