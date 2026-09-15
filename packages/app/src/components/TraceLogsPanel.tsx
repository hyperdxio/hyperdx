import { use, useCallback, useMemo } from 'react';
import Link from 'next/link';
import SqlString from 'sqlstring';
import { buildSearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Button, Flex, Group } from '@mantine/core';
import { IconExternalLink, IconLogs } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';
import { getEventBody, useSource } from '@/source';

import {
  deriveRowSidePanelContextForSource,
  RowSidePanelContext,
} from './DBRowSidePanel';
import { DBSqlRowTable } from './DBRowTable';

/**
 * One trace's logs, as a flat chronological table.
 *
 * Sibling view to the waterfall's interleaved log rows, for when a trace logs
 * enough that reading them inside the span tree stops working. The waterfall
 * owns the log filter; this honours whatever is set there, and hands the same
 * query to the search page for anything more.
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

  // Read-only: the waterfall's Logs filter is the one input for both views.
  const { logWhere, logWhereLanguage } = useWaterfallSearchState({});
  const logFilterLanguage = logWhereLanguage === 'sql' ? 'sql' : 'lucene';

  // Trimmed so a whitespace-only expression counts as unconfigured rather than
  // rendering as a bare `=` in the trace filter.
  const traceIdExpression = logSource?.traceIdExpression?.trim();

  const traceFilter = useMemo(
    () =>
      traceIdExpression
        ? SqlString.format('?=?', [SqlString.raw(traceIdExpression), traceId])
        : undefined,
    [traceIdExpression, traceId],
  );

  const config = useMemo((): BuilderChartConfigWithDateRange | undefined => {
    if (logSource == null || traceFilter == null) {
      return undefined;
    }
    return {
      // Assembled through the shared builder so this query sees the same row
      // set as the search page and alerts do — it carries the source's
      // `tableFilterExpression`, sample weighting, and `source` id (which is
      // how the source's `querySettings` reach the query).
      ...buildSearchChartConfig(logSource, {
        // The trace scope goes in `filters` so the filter keeps the whole
        // `where` slot to itself — the two run in independent languages.
        filters: [{ type: 'sql', condition: traceFilter }],
        where: logWhere ?? '',
        whereLanguage: logFilterLanguage,
        // Ascending: inside a trace, chronological order is execution order.
        orderBy: `${logSource.timestampValueExpression} ASC`,
      }),
      limit: { limit: 200 },
      dateRange,
    };
  }, [logSource, traceFilter, logWhere, logFilterLanguage, dateRange]);

  const parentContext = use(RowSidePanelContext);

  // The same rows in the full search page: the trace scope plus whatever
  // filter is set, in the language that filter runs in so the two combine.
  const searchUrl = useMemo(() => {
    const { generateSearchUrl } = parentContext;
    if (generateSearchUrl == null || logSource == null || !traceIdExpression) {
      return undefined;
    }
    const traceCondition =
      logFilterLanguage === 'sql'
        ? traceFilter
        : `${traceIdExpression}:"${traceId}"`;
    return generateSearchUrl({
      where: logWhere ? `${traceCondition} AND (${logWhere})` : traceCondition,
      whereLanguage: logFilterLanguage,
      source: logSource,
    });
  }, [
    parentContext,
    logSource,
    traceIdExpression,
    traceFilter,
    traceId,
    logFilterLanguage,
    logWhere,
  ]);

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

  // These logs come from a different source than the search this panel was
  // opened from, so rebind search-url generation to them. The column actions go
  // regardless: this table selects the source's own columns, so the header's
  // remove-column action would drop whatever column sits at that index in the
  // searched table instead.
  const rowSidePanelContextValue = useMemo(
    () =>
      logSource
        ? {
            ...deriveRowSidePanelContextForSource(parentContext, logSource),
            displayedColumns: undefined,
            toggleColumn: undefined,
          }
        : parentContext,
    [parentContext, logSource],
  );

  if (isLoading) {
    return null;
  }

  if (config == null || logSource == null) {
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

  return (
    <RowSidePanelContext value={rowSidePanelContextValue}>
      <Flex
        direction="column"
        mih={0}
        px="md"
        style={{ flexGrow: 1 }}
        data-testid={dataTestId}
      >
        {searchUrl && (
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
        )}
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
