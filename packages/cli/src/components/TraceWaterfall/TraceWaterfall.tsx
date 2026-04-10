/**
 * Trace waterfall chart for the TUI.
 *
 * Displays all spans for a given traceId as a tree with horizontal
 * timing bars, similar to the web frontend's DBTraceWaterfallChart.
 *
 * When a correlated log source is provided, log events are fetched
 * and merged into the tree as children of the matching trace span
 * (linked via SpanId), shown with 0ms duration and a log icon.
 *
 * Layout per row:
 *   [indent] ServiceName > SpanName  [===bar===]  12.3ms
 */

import React, { useEffect, useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';

import ColumnValues from '@/components/ColumnValues';
import ErrorDisplay from '@/components/ErrorDisplay';

import type { TraceWaterfallProps } from './types';
import {
  durationMs,
  formatDuration,
  getStatusLabel,
  getStatusColor,
  getBarColor,
  renderBar,
} from './utils';
import { buildTree } from './buildTree';
import { useTraceData } from './useTraceData';

export default function TraceWaterfall({
  clickhouseClient,
  metadata,
  source,
  logSource,
  traceId,
  eventTimestamp,
  searchQuery,
  highlightHint,
  selectedIndex,
  onSelectedIndexChange,
  detailExpanded = false,
  wrapLines,
  detailScrollOffset = 0,
  detailMaxRows,
  width: propWidth,
  maxRows: propMaxRows,
  onChSqlChange,
}: TraceWaterfallProps) {
  const { stdout } = useStdout();
  const termWidth = propWidth ?? stdout?.columns ?? 80;
  const maxRows = propMaxRows ?? 50;

  // ---- Data fetching -----------------------------------------------

  const {
    traceSpans,
    logEvents,
    loading,
    error,
    selectedRowData,
    selectedRowLoading,
    selectedRowError,
    lastTraceChSql,
    fetchSelectedRow,
  } = useTraceData({
    clickhouseClient,
    metadata,
    source,
    logSource,
    traceId,
    eventTimestamp,
  });

  // Notify parent when the trace SQL changes
  useEffect(() => {
    onChSqlChange?.(lastTraceChSql);
  }, [lastTraceChSql, onChSqlChange]);

  // ---- Derived computations ----------------------------------------

  const flatNodes = useMemo(
    () => buildTree(traceSpans, logEvents),
    [traceSpans, logEvents],
  );

  // Filter nodes by search query (fuzzy match on ServiceName + SpanName)
  const filteredNodes = useMemo(() => {
    if (!searchQuery) return flatNodes;
    const q = searchQuery.toLowerCase();
    return flatNodes.filter(node => {
      const name = (node.SpanName || '').toLowerCase();
      const svc = (node.ServiceName || '').toLowerCase();
      return name.includes(q) || svc.includes(q);
    });
  }, [flatNodes, searchQuery]);

  // Compute global min/max timestamps for bar positioning
  // (use all nodes for consistent bar positions regardless of filter)
  const { minMs, maxMs } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const node of flatNodes) {
      const startMs = new Date(node.Timestamp).getTime();
      const dur =
        node.kind === 'log'
          ? 0
          : durationMs(node.Duration || 0, source.durationPrecision);
      min = Math.min(min, startMs);
      max = Math.max(max, startMs + dur);
    }
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 0;
    return { minMs: min, maxMs: max };
  }, [flatNodes, source.durationPrecision]);

  const totalDurationMs = maxMs - minMs;

  // Determine the effective selected index over ALL filtered nodes:
  // - If selectedIndex is set (j/k navigation), use it (clamped)
  // - Otherwise, find the highlightHint row
  const effectiveIndex = useMemo(() => {
    if (selectedIndex != null) {
      return Math.max(0, Math.min(selectedIndex, filteredNodes.length - 1));
    }
    if (highlightHint) {
      const idx = filteredNodes.findIndex(
        n => n.SpanId === highlightHint.spanId && n.kind === highlightHint.kind,
      );
      return idx >= 0 ? idx : null;
    }
    return null;
  }, [selectedIndex, highlightHint, filteredNodes]);

  // Clamp selectedIndex if it exceeds bounds
  useEffect(() => {
    if (
      selectedIndex != null &&
      filteredNodes.length > 0 &&
      selectedIndex >= filteredNodes.length
    ) {
      onSelectedIndexChange?.(filteredNodes.length - 1);
    }
  }, [selectedIndex, filteredNodes.length, onSelectedIndexChange]);

  // Derive scroll offset so the selected row stays in the viewport.
  // The viewport shows `maxRows` rows starting at `scrollOffset`.
  const scrollOffset = useMemo(() => {
    if (effectiveIndex == null) return 0;
    // Keep the selected row visible — scroll just enough
    if (effectiveIndex < maxRows) return 0;
    // Centre-ish: put selected row near the middle of the viewport
    return Math.min(
      effectiveIndex - Math.floor(maxRows / 2),
      Math.max(0, filteredNodes.length - maxRows),
    );
  }, [effectiveIndex, maxRows, filteredNodes.length]);

  // The visible window of nodes for rendering
  const visibleNodes = useMemo(
    () => filteredNodes.slice(scrollOffset, scrollOffset + maxRows),
    [filteredNodes, scrollOffset, maxRows],
  );

  // Fetch SELECT * for the selected span/log
  const selectedNode =
    effectiveIndex != null ? filteredNodes[effectiveIndex] : null;

  useEffect(() => {
    fetchSelectedRow(selectedNode);
  }, [selectedNode?.SpanId, selectedNode?.Timestamp, selectedNode?.kind]);

  // ---- Render ------------------------------------------------------

  if (loading) {
    return (
      <Text>
        <Spinner type="dots" /> Loading trace spans…
      </Text>
    );
  }

  if (error) {
    return <ErrorDisplay error={error} severity="error" />;
  }

  if (flatNodes.length === 0) {
    return <Text dimColor>No spans found for this trace.</Text>;
  }

  // Layout: [label (40%)] [bar (50%)] [duration (10%)]
  const labelWidth = Math.max(20, Math.floor(termWidth * 0.38));
  const durationColWidth = 10;
  const barWidth = Math.max(10, termWidth - labelWidth - durationColWidth - 4); // 4 for spacing

  const spanCount = filteredNodes.filter(n => n.kind === 'span').length;
  const logCount = filteredNodes.filter(n => n.kind === 'log').length;
  const errorCount = filteredNodes.filter(n => {
    if (n.kind === 'log') {
      const sev = n.StatusCode?.toLowerCase();
      return sev === 'error' || sev === 'fatal' || sev === 'critical';
    }
    return n.StatusCode === '2' || n.StatusCode === 'Error';
  }).length;
  const truncated = filteredNodes.length > maxRows;

  // ---- Waterfall view ----------------------------------------------

  const waterfallView = (
    <Box flexDirection="column">
      {/* Summary */}
      <Box>
        <Text dimColor>
          {spanCount} span{spanCount !== 1 ? 's' : ''}
        </Text>
        {logCount > 0 && (
          <Text dimColor>
            , {logCount} log{logCount !== 1 ? 's' : ''}
          </Text>
        )}
        {errorCount > 0 && (
          <Text color="red">
            {' '}
            ({errorCount} error{errorCount !== 1 ? 's' : ''})
          </Text>
        )}
        <Text dimColor> | total {totalDurationMs.toFixed(1)}ms</Text>
      </Box>

      {/* Header */}
      <Box>
        <Box width={labelWidth}>
          <Text bold dimColor>
            Span
          </Text>
        </Box>
        <Box width={barWidth + 2}>
          <Text bold dimColor>
            Timeline
          </Text>
        </Box>
        <Box width={durationColWidth}>
          <Text bold dimColor>
            Duration
          </Text>
        </Box>
      </Box>
      <Text dimColor>{'─'.repeat(termWidth - 2)}</Text>

      {/* Span rows */}
      {visibleNodes.map((node, i) => {
        const indent = '  '.repeat(Math.min(node.level, 8));
        const isLog = node.kind === 'log';
        const icon = isLog ? '[] ' : '';
        const svc = node.ServiceName ? `${node.ServiceName} > ` : '';
        const name = node.SpanName || '(unknown)';
        const label = `${indent}${icon}${svc}${name}`;

        // Truncate label to fit
        const displayLabel =
          label.length > labelWidth - 1
            ? label.slice(0, labelWidth - 2) + '…'
            : label.padEnd(labelWidth);

        const startMs = new Date(node.Timestamp).getTime();
        const dur = isLog
          ? 0
          : durationMs(node.Duration || 0, source.durationPrecision);
        const bar = renderBar(startMs, dur, minMs, maxMs, barWidth);
        const durStr = isLog
          ? '0ms'
          : formatDuration(node.Duration || 0, source.durationPrecision);
        const statusLabel = getStatusLabel(node);
        const statusColor = getStatusColor(node);
        const barClr = getBarColor(node);

        const isHighlighted = effectiveIndex === scrollOffset + i;

        return (
          <Box key={`${node.SpanId}-${node.kind}-${i}`} overflowX="hidden">
            <Box width={labelWidth} overflowX="hidden">
              <Text
                wrap="truncate"
                color={isHighlighted ? 'white' : isLog ? 'green' : statusColor}
                bold={!!statusColor}
                inverse={isHighlighted}
              >
                {displayLabel}
              </Text>
            </Box>
            <Box width={barWidth + 2} overflowX="hidden">
              <Text color={barClr} wrap="truncate">
                {bar}
              </Text>
            </Box>
            <Box width={durationColWidth} overflowX="hidden">
              <Text
                dimColor={!isHighlighted}
                color={isHighlighted ? 'white' : undefined}
                inverse={isHighlighted}
              >
                {durStr}
              </Text>
              {statusLabel ? (
                <Text
                  color={isHighlighted ? 'white' : statusColor}
                  bold
                  inverse={isHighlighted}
                >
                  {' '}
                  {statusLabel}
                </Text>
              ) : null}
            </Box>
          </Box>
        );
      })}

      {truncated && (
        <Text dimColor>
          {scrollOffset + maxRows < filteredNodes.length
            ? `↓ ${filteredNodes.length - scrollOffset - maxRows} more below`
            : ''}
          {scrollOffset > 0
            ? `${scrollOffset + maxRows < filteredNodes.length ? ' | ' : ''}↑ ${scrollOffset} above`
            : ''}
          {` (${filteredNodes.length} total)`}
        </Text>
      )}

      {/* Hint for entering detail view */}
      {effectiveIndex != null && !detailExpanded && (
        <Text dimColor>l=expand details</Text>
      )}
    </Box>
  );

  // ---- Detail view (full-page Event Details) -----------------------

  const detailView = (
    <Box flexDirection="column">
      <Text dimColor>h=back to waterfall</Text>
      <Box marginTop={1}>
        <Text bold>Event Details</Text>
        {selectedNode && (
          <Text dimColor>
            {' '}
            — {selectedNode.ServiceName ? `${selectedNode.ServiceName} > ` : ''}
            {selectedNode.SpanName || '(unknown)'}
          </Text>
        )}
      </Box>
      <Text dimColor>{'─'.repeat(termWidth - 2)}</Text>
      {selectedRowLoading ? (
        <Text>
          <Spinner type="dots" /> Loading event details…
        </Text>
      ) : selectedRowError ? (
        <ErrorDisplay
          error={selectedRowError}
          severity="warning"
          detail="Could not load event details for this span."
        />
      ) : selectedRowData ? (
        <ColumnValues
          data={selectedRowData}
          searchQuery={searchQuery}
          wrapLines={wrapLines}
          maxRows={detailMaxRows}
          scrollOffset={detailScrollOffset}
        />
      ) : (
        <Text dimColor>No details available.</Text>
      )}
    </Box>
  );

  return detailExpanded ? detailView : waterfallView;
}
