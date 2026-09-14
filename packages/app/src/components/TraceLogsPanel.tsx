import { use, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import SqlString from 'sqlstring';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box, Flex } from '@mantine/core';
import { IconLogs } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';
import { getEventBody, useSource } from '@/source';

import {
  deriveRowSidePanelContextForSource,
  RowSidePanelContext,
} from './DBRowSidePanel';
import { DBSqlRowTable } from './DBRowTable';

/**
 * Every log in one trace, as a flat chronological table.
 *
 * Sibling view to the waterfall's interleaved log rows: it shares the same
 * `logWhere` URL state, so a filter set in either place applies to both, but
 * it isn't bound to the span tree — which is what makes a log-heavy trace
 * readable.
 */
export default function TraceLogsPanel({
  logSourceId,
  traceId,
  dateRange,
  highlightedRowId,
  onNavigateToLog,
  'data-testid': dataTestId,
}: {
  logSourceId: string;
  traceId: string;
  dateRange: [Date, Date];
  /** Row id of the log this panel was opened from, when it is one of these logs. */
  highlightedRowId?: string;
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

  const {
    logWhere,
    logWhereLanguage,
    onSubmit: submitFilters,
  } = useWaterfallSearchState({ hasLogSource: true });

  const logFilterLanguage: 'lucene' | 'sql' =
    logWhereLanguage === 'sql' ? 'sql' : 'lucene';

  const { control, handleSubmit, setValue } = useForm({
    defaultValues: {
      logWhere: logWhere ?? '',
      // Prefer the URL language so a shared link / reload shows the language
      // the filter runs in; fall back to the stored preference.
      logWhereLanguage:
        logWhereLanguage === 'sql' || logWhereLanguage === 'lucene'
          ? logWhereLanguage
          : (getStoredLanguage() ?? 'lucene'),
    },
  });

  const onSubmitFilter = useCallback(
    (data: { logWhere: string; logWhereLanguage: string }) => {
      submitFilters({
        logWhere: data.logWhere,
        logWhereLanguage: data.logWhereLanguage,
      });
    },
    [submitFilters],
  );

  const traceIdExpression = logSource?.traceIdExpression;

  const config = useMemo(() => {
    if (logSource == null || !traceIdExpression) {
      return undefined;
    }
    return {
      connection: logSource.connection,
      from: logSource.from,
      timestampValueExpression: logSource.timestampValueExpression,
      implicitColumnExpression: logSource.implicitColumnExpression,
      bodyExpression: logSource.bodyExpression,
      useTextIndexForImplicitColumn: logSource.useTextIndexForImplicitColumn,
      select: logSource.defaultTableSelectExpression ?? '',
      // The trace scope goes in `filters` so the user's filter keeps the whole
      // `where` slot to itself — the two run in independent languages.
      filters: [
        {
          type: 'sql' as const,
          condition: SqlString.format('?=?', [
            SqlString.raw(traceIdExpression),
            traceId,
          ]),
        },
      ],
      where: logWhere ?? '',
      whereLanguage: logFilterLanguage,
      // Ascending: inside a trace, chronological order is execution order.
      orderBy: `${logSource.timestampValueExpression} ASC`,
      limit: { limit: 200 },
      dateRange,
    };
  }, [
    logSource,
    traceIdExpression,
    traceId,
    logWhere,
    logFilterLanguage,
    dateRange,
  ]);

  const handleRowDetailsClick = useCallback(
    (rowWhere: RowWhereResult, row: Record<string, any>) => {
      // The table selects the source's own columns, so the body lands under
      // its expression rather than a normalized alias.
      const bodyExpression = logSource ? getEventBody(logSource) : undefined;
      const body = bodyExpression ? row[bodyExpression] : undefined;
      onNavigateToLog(
        rowWhere.where,
        rowWhere.aliasWith,
        typeof body === 'string' && body.length > 0 ? body : 'Log',
      );
    },
    [logSource, onNavigateToLog],
  );

  // The logs belong to a different source than the search this panel was
  // opened from, so rebind search-url generation to them and drop the
  // filter/column actions that only make sense against the searched source.
  const parentContext = use(RowSidePanelContext);
  const rowSidePanelContextValue = useMemo(
    () =>
      logSource
        ? deriveRowSidePanelContextForSource(parentContext, logSource)
        : parentContext,
    [parentContext, logSource],
  );

  if (isLoading) {
    return null;
  }

  if (logSource == null) {
    return (
      <EmptyState
        icon={<IconLogs size={24} />}
        title="Correlated log source not found"
        description="The log source linked to this trace source could not be loaded. Pick another one in the trace source's settings."
        variant="card"
        m="sm"
      />
    );
  }

  if (config == null) {
    return (
      <EmptyState
        icon={<IconLogs size={24} />}
        title="No trace ID column configured"
        description={`Set a trace ID expression on the "${logSource.name}" source to correlate its logs with traces.`}
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
        style={{ flexGrow: 1 }}
        data-testid={dataTestId}
      >
        <Box px="sm" py="xs">
          <form onSubmit={handleSubmit(onSubmitFilter)}>
            <SearchWhereInput
              tableConnection={tcFromSource(logSource)}
              sourceId={logSource.id}
              dateRange={dateRange}
              name="logWhere"
              languageName="logWhereLanguage"
              control={control}
              size="xs"
              showLabel={false}
              allowMultiline={false}
              onSubmit={handleSubmit(onSubmitFilter)}
              onLanguageChange={lang =>
                setValue('logWhereLanguage', lang, { shouldDirty: true })
              }
              lucenePlaceholder='Filter logs ex. SeverityText:"error"'
              sqlPlaceholder="Filter logs ex. SeverityText = 'error'"
              data-testid="trace-logs-search-input"
            />
          </form>
        </Box>
        <div style={{ height: '100%', overflow: 'auto' }}>
          <DBSqlRowTable
            sourceId={logSource.id}
            config={config}
            queryKeyPrefix="trace-logs"
            highlightedLineId={highlightedRowId}
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
