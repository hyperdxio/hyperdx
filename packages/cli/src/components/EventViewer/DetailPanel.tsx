import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';

import type { SourceResponse, ProxyClickhouseClient } from '@/api/client';
import { ROW_DATA_ALIASES } from '@/shared/rowDataPanel';
import { getDisplayedTimestampValueExpression } from '@/shared/source';
import ColumnValues from '@/components/ColumnValues';
import ErrorDisplay from '@/components/ErrorDisplay';
import RowOverview from '@/components/RowOverview';
import TraceWaterfall from '@/components/TraceWaterfall';

import type { FormattedRow } from './types';
import { SearchBar } from './SubComponents';
import { flatten } from './utils';

type DetailTab = 'overview' | 'columns' | 'trace';

type DetailPanelProps = {
  source: SourceResponse;
  sources: SourceResponse[];
  clickhouseClient: ProxyClickhouseClient;
  metadata: Metadata;
  detailTab: DetailTab;
  expandedRowData: Record<string, unknown> | null;
  expandedRowLoading: boolean;
  expandedRowError: Error | null;
  expandedTraceId: string | null;
  expandedSpanId: string | null;
  traceSelectedIndex: number | null;
  onTraceSelectedIndexChange: (index: number | null) => void;
  detailSearchQuery: string;
  focusDetailSearch: boolean;
  onDetailSearchQueryChange: (v: string) => void;
  onDetailSearchSubmit: () => void;
  wrapLines: boolean;
  termHeight: number;
  fullDetailMaxRows: number;
  detailMaxRows: number;
  columnValuesScrollOffset: number;
  traceDetailScrollOffset: number;
  /** The formatted row for the summary header */
  expandedFormattedRow?: FormattedRow & {
    raw: Record<string, string | number>;
  };
  scrollOffset: number;
  expandedRow: number;
  /** Callback when the trace tab's SQL changes */
  onTraceChSqlChange?: (
    chSql: { sql: string; params: Record<string, unknown> } | null,
  ) => void;
};

export function DetailPanel({
  source,
  sources,
  clickhouseClient,
  metadata,
  detailTab,
  expandedRowData,
  expandedRowLoading,
  expandedRowError,
  expandedTraceId,
  expandedSpanId,
  traceSelectedIndex,
  onTraceSelectedIndexChange,
  detailSearchQuery,
  focusDetailSearch,
  onDetailSearchQueryChange,
  onDetailSearchSubmit,
  wrapLines,
  termHeight,
  fullDetailMaxRows,
  detailMaxRows,
  columnValuesScrollOffset,
  traceDetailScrollOffset,
  expandedFormattedRow,
  scrollOffset,
  expandedRow,
  onTraceChSqlChange,
}: DetailPanelProps) {
  // Extract the event timestamp from the full row data (or the raw
  // table row) so we can scope the trace waterfall date range tightly
  // for partition pruning.
  const eventTimestamp = (() => {
    const tsExpr = getDisplayedTimestampValueExpression(source);
    const data = expandedRowData ?? expandedFormattedRow?.raw;
    if (!data) return undefined;
    const val = data[ROW_DATA_ALIASES.TIMESTAMP] ?? data[tsExpr] ?? undefined;
    return val != null ? String(val) : undefined;
  })();

  const hasTrace =
    source.kind === 'trace' || (source.kind === 'log' && source.traceSourceId);

  const tabs: Array<{ key: DetailTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'columns', label: 'Column Values' },
    ...(hasTrace ? [{ key: 'trace' as const, label: 'Trace' }] : []),
  ];

  return (
    <Box flexDirection="column" marginTop={1} flexGrow={1} overflowY="hidden">
      {/* Back hint */}
      <Text dimColor>esc=back to table</Text>
      {/* Summary header */}
      <Box marginTop={1} marginBottom={1}>
        <Text color="cyan" bold>
          {(() => {
            if (!expandedFormattedRow) return '';
            return source.kind === 'trace'
              ? `${expandedFormattedRow.cells[1] || ''} > ${expandedFormattedRow.cells[2] || ''}`
              : flatten(
                  String(
                    expandedFormattedRow.raw[source.bodyExpression ?? 'Body'] ??
                      '',
                  ),
                ).slice(0, 200);
          })()}
        </Text>
      </Box>
      {/* Detail tab bar */}
      <Box marginBottom={1}>
        {tabs.map(tab => (
          <Box key={tab.key} marginRight={2}>
            <Text
              color={detailTab === tab.key ? 'cyan' : undefined}
              bold={detailTab === tab.key}
              dimColor={detailTab !== tab.key}
            >
              {detailTab === tab.key ? '▸ ' : '  '}
              {tab.label}
            </Text>
          </Box>
        ))}
        <Text dimColor>(tab to switch)</Text>
      </Box>
      {/* Detail search bar — only show when focused or has a query */}
      {(focusDetailSearch || detailSearchQuery) && (
        <SearchBar
          focused={focusDetailSearch}
          query={detailSearchQuery}
          onChange={onDetailSearchQueryChange}
          onSubmit={onDetailSearchSubmit}
        />
      )}
      <Text dimColor>{'─'.repeat(80)}</Text>

      {/* Tab content */}
      {detailTab === 'overview' && (
        /* ---- Overview tab ---- */
        <Box
          flexDirection="column"
          height={fullDetailMaxRows}
          overflowY="hidden"
        >
          {expandedRowLoading ? (
            <Text>
              <Spinner type="dots" /> Loading…
            </Text>
          ) : expandedRowData ? (
            <>
              {expandedRowError && (
                <Box marginBottom={1}>
                  <ErrorDisplay
                    error={expandedRowError}
                    severity="warning"
                    detail="Showing partial row data — full row fetch failed."
                  />
                </Box>
              )}
              <RowOverview
                source={source}
                rowData={expandedRowData}
                searchQuery={detailSearchQuery}
                wrapLines={wrapLines}
                maxRows={fullDetailMaxRows}
                scrollOffset={columnValuesScrollOffset}
              />
            </>
          ) : null}
        </Box>
      )}

      {detailTab === 'trace' &&
        /* ---- Trace waterfall tab ---- */
        (() => {
          if (!expandedTraceId) {
            return expandedRowLoading ? (
              <Text>
                <Spinner type="dots" /> Loading trace ID…
              </Text>
            ) : (
              <Text dimColor>No trace ID found for this row.</Text>
            );
          }

          const findSource = (id: string | undefined) =>
            id
              ? (sources.find(s => s.id === id || s._id === id) ?? null)
              : null;

          const traceSource =
            source.kind === 'trace' ? source : findSource(source.traceSourceId);
          const logSource =
            source.kind === 'log' ? source : findSource(source.logSourceId);

          if (!traceSource) {
            return <Text dimColor>No correlated trace source found.</Text>;
          }

          // Reserve lines for: header, tab bar, search, separator,
          // summary, col headers, separator, Event Details header +
          // separator + content (~15 lines overhead)
          const waterfallMaxRows = Math.max(10, termHeight - 15);

          return (
            <TraceWaterfall
              clickhouseClient={clickhouseClient}
              metadata={metadata}
              source={traceSource}
              logSource={logSource}
              traceId={expandedTraceId}
              eventTimestamp={eventTimestamp}
              searchQuery={detailSearchQuery}
              selectedIndex={traceSelectedIndex}
              onSelectedIndexChange={onTraceSelectedIndexChange}
              maxRows={waterfallMaxRows}
              highlightHint={
                expandedSpanId
                  ? {
                      spanId: expandedSpanId,
                      kind: source.kind === 'log' ? 'log' : 'span',
                    }
                  : undefined
              }
              wrapLines={wrapLines}
              detailScrollOffset={traceDetailScrollOffset}
              detailMaxRows={detailMaxRows}
              onChSqlChange={onTraceChSqlChange}
            />
          );
        })()}

      {detailTab === 'columns' && (
        /* ---- Column Values tab ---- */
        <Box
          flexDirection="column"
          height={fullDetailMaxRows}
          overflowY="hidden"
        >
          {expandedRowLoading ? (
            <Text>
              <Spinner type="dots" /> Loading all fields…
            </Text>
          ) : expandedRowData ? (
            <>
              {expandedRowError && (
                <Box marginBottom={1}>
                  <ErrorDisplay
                    error={expandedRowError}
                    severity="warning"
                    detail="Showing partial row data — full row fetch failed."
                  />
                </Box>
              )}
              <ColumnValues
                data={expandedRowData}
                searchQuery={detailSearchQuery}
                wrapLines={wrapLines}
                maxRows={fullDetailMaxRows}
                scrollOffset={columnValuesScrollOffset}
              />
            </>
          ) : null}
        </Box>
      )}
    </Box>
  );
}
