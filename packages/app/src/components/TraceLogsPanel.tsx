import { use, useCallback, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import SqlString from 'sqlstring';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { buildSearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  BuilderChartConfigWithDateRange,
  SelectList,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Box, Flex } from '@mantine/core';
import { IconLogs } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';
import { useSource } from '@/source';

import {
  deriveRowSidePanelContextForSource,
  RowSidePanelContext,
} from './DBRowSidePanel';
import { DBSqlRowTable } from './DBRowTable';
import { getTableRowLabel } from './rowLabel';

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
  selectOverride,
  onNavigateToLog,
  'data-testid': dataTestId,
}: {
  logSourceId: string;
  traceId: string;
  dateRange: [Date, Date];
  /** Row id of the log this panel was opened from, when it is one of these logs. */
  highlightedRowId?: string;
  /**
   * The searched table's SELECT, when this panel's logs are that table's rows.
   * Reused so these rows carry the same ids `highlightedRowId` was built from,
   * and so the columns track the ones the reader picked.
   */
  selectOverride?: SelectList;
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

  const urlLanguage =
    logWhereLanguage === 'sql' || logWhereLanguage === 'lucene'
      ? logWhereLanguage
      : undefined;

  // The query language follows the URL alone, defaulting to Lucene, so a filter
  // shared with the waterfall runs the same way in both places even if a link
  // carries `logWhere` without its language.
  const logFilterLanguage: 'lucene' | 'sql' = urlLanguage ?? 'lucene';

  // The input shows the language the filter actually runs in. With no filter
  // there is nothing to interpret, so the user's stored editor preference wins.
  const displayedLanguage =
    urlLanguage ?? (logWhere ? 'lucene' : (getStoredLanguage() ?? 'lucene'));

  const { control, handleSubmit, setValue, reset, getValues } = useForm({
    defaultValues: {
      logWhere: logWhere ?? '',
      logWhereLanguage: displayedLanguage,
    },
  });

  // The filter is URL state, which can change without this form touching it
  // (browser back/forward, a shared link). Re-seed the input so what's on
  // screen is what the table is querying — and so a submit can't write a stale
  // value back over the restored one. Submitting is a no-op here: it moves the
  // URL to what the form already holds.
  //
  // Keyed on the URL alone: the stored language preference changes the moment
  // the reader flips the language switch, and re-seeding on that would blank a
  // filter they are halfway through typing.
  useEffect(() => {
    reset({
      logWhere: logWhere ?? '',
      logWhereLanguage: urlLanguage ?? getValues('logWhereLanguage'),
    });
  }, [logWhere, urlLanguage, reset, getValues]);

  const onSubmitFilter = useCallback(
    (data: { logWhere: string; logWhereLanguage: string }) => {
      submitFilters({
        logWhere: data.logWhere,
        logWhereLanguage: data.logWhereLanguage,
      });
    },
    [submitFilters],
  );

  // Trimmed so a whitespace-only expression falls into the empty state below
  // rather than rendering as a bare `=` in the trace filter. The schema allows
  // it: `min(1)` accepts ' '.
  const traceIdExpression = logSource?.traceIdExpression?.trim();

  const config = useMemo((): BuilderChartConfigWithDateRange | undefined => {
    if (logSource == null || !traceIdExpression) {
      return undefined;
    }
    return {
      // Assembled through the shared builder so this query sees the same row
      // set as the search page and alerts do — it carries the source's
      // `tableFilterExpression`, sample weighting, and `source` id (which is
      // how the source's `querySettings` reach the query).
      ...buildSearchChartConfig(logSource, {
        // The trace scope goes in `filters` so the user's filter keeps the
        // whole `where` slot to itself — the two run in independent languages.
        filters: [
          {
            type: 'sql',
            condition: SqlString.format('?=?', [
              SqlString.raw(traceIdExpression),
              traceId,
            ]),
          },
        ],
        where: logWhere ?? '',
        whereLanguage: logFilterLanguage,
        // Falls back to the source's default columns when these logs aren't
        // the searched table's rows.
        select: selectOverride ?? null,
        // Ascending: inside a trace, chronological order is execution order.
        orderBy: `${logSource.timestampValueExpression} ASC`,
      }),
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
    selectOverride,
  ]);

  const handleRowDetailsClick = useCallback(
    (rowWhere: RowWhereResult, row: Record<string, unknown>) => {
      onNavigateToLog(
        rowWhere.where,
        rowWhere.aliasWith,
        logSource ? getTableRowLabel(logSource, row) : 'Log',
      );
    },
    [logSource, onNavigateToLog],
  );

  // The logs belong to a different source than the search this panel was
  // opened from, so rebind search-url generation to them and drop the
  // filter/column actions that only make sense against the searched source.
  const parentContext = use(RowSidePanelContext);
  const rowSidePanelContextValue = useMemo(() => {
    const derived = logSource
      ? deriveRowSidePanelContextForSource(parentContext, logSource)
      : parentContext;
    if (selectOverride != null) {
      return derived;
    }
    // These columns are this table's own, not the searched table's, so the
    // header's remove-column action would drop whatever column sits at that
    // index in the *search* results. Take it away.
    return { ...derived, displayedColumns: undefined, toggleColumn: undefined };
  }, [parentContext, logSource, selectOverride]);

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
