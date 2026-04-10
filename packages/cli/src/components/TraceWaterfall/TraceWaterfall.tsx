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
  source,
  logSource,
  traceId,
  searchQuery,
  highlightHint,
  selectedIndex,
  onSelectedIndexChange,
  wrapLines,
  detailScrollOffset = 0,
  detailMaxRows,
  width: propWidth,
  maxRows: propMaxRows,
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
    fetchSelectedRow,
  } = useTraceData({ clickhouseClient, source, logSource, traceId });

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

  const visibleNodesForIndex = useMemo(
    () => filteredNodes.slice(0, propMaxRows ?? 50),
    [filteredNodes, propMaxRows],
  );

  // Determine the effective highlighted index:
  // - If selectedIndex is set (j/k navigation), use it (clamped)
  // - Otherwise, find the highlightHint row
  const effectiveIndex = useMemo(() => {
    if (selectedIndex != null) {
      return Math.max(
        0,
        Math.min(selectedIndex, visibleNodesForIndex.length - 1),
      );
    }
    if (highlightHint) {
      const idx = visibleNodesForIndex.findIndex(
        n => n.SpanId === highlightHint.spanId && n.kind === highlightHint.kind,
      );
      return idx >= 0 ? idx : null;
    }
    return null;
  }, [selectedIndex, highlightHint, visibleNodesForIndex]);

  // Clamp selectedIndex if it exceeds bounds
  useEffect(() => {
    if (
      selectedIndex != null &&
      visibleNodesForIndex.length > 0 &&
      selectedIndex >= visibleNodesForIndex.length
    ) {
      onSelectedIndexChange?.(visibleNodesForIndex.length - 1);
    }
  }, [selectedIndex, visibleNodesForIndex.length, onSelectedIndexChange]);

  // Fetch SELECT * for the selected span/log
  const selectedNode =
    effectiveIndex != null ? visibleNodesForIndex[effectiveIndex] : null;

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
  const visibleNodes = filteredNodes.slice(0, maxRows);
  const truncated = filteredNodes.length > maxRows;

  return (
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

        const isHighlighted = effectiveIndex === i;

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
          … and {filteredNodes.length - maxRows} more (showing first {maxRows})
        </Text>
      )}

      {/* Event Details for selected span/log — fixed height viewport */}
      <Box
        flexDirection="column"
        marginTop={1}
        height={(detailMaxRows ?? 10) + 3}
        overflowY="hidden"
      >
        <Text bold>Event Details</Text>
        <Text dimColor>{'─'.repeat(termWidth - 2)}</Text>
        {selectedRowLoading ? (
          <Text>
            <Spinner type="dots" /> Loading event details…
          </Text>
        ) : selectedRowData ? (
          <ColumnValues
            data={selectedRowData}
            searchQuery={searchQuery}
            wrapLines={wrapLines}
            maxRows={detailMaxRows}
            scrollOffset={detailScrollOffset}
          />
        ) : effectiveIndex == null ? (
          <Text dimColor>Use j/k to select a span or log event.</Text>
        ) : (
          <Text dimColor>No details available.</Text>
        )}
      </Box>
    </Box>
  );
}
