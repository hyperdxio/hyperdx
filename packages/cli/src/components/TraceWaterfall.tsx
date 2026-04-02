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

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import SqlString from 'sqlstring';

import type { ProxyClickhouseClient, SourceResponse } from '@/api/client';
import { buildTraceSpansSql, buildTraceLogsSql } from '@/api/eventQuery';
import ColumnValues from '@/components/ColumnValues';

// ---- Types ---------------------------------------------------------

export interface SpanRow {
  Timestamp: string;
  TraceId: string;
  SpanId: string;
  ParentSpanId: string;
  SpanName: string;
  ServiceName: string;
  Duration: number;
  StatusCode: string;
}

/** Extends SpanRow with a kind marker for distinguishing spans from logs */
interface TaggedSpanRow extends SpanRow {
  kind: 'span' | 'log';
}

interface SpanNode extends TaggedSpanRow {
  children: SpanNode[];
  level: number;
}

interface TraceWaterfallProps {
  clickhouseClient: ProxyClickhouseClient;
  source: SourceResponse;
  /** Correlated log source (optional) */
  logSource?: SourceResponse | null;
  traceId: string;
  /** Fuzzy filter query for span/log names */
  searchQuery?: string;
  /** Hint to identify the initial row to highlight in the waterfall */
  highlightHint?: {
    spanId: string;
    kind: 'span' | 'log';
  };
  /** Currently selected row index (controlled by parent via j/k) */
  selectedIndex?: number | null;
  /** Callback when the selected index should change (e.g. clamping) */
  onSelectedIndexChange?: (index: number | null) => void;
  /** Toggle line wrap in Event Details */
  wrapLines?: boolean;
  /** Scroll offset for Event Details */
  detailScrollOffset?: number;
  /** Max visible rows for Event Details */
  detailMaxRows?: number;
  /** Available width for the chart (characters) */
  width?: number;
  /** Max visible rows before truncation */
  maxRows?: number;
}

// ---- Duration formatting -------------------------------------------

function durationMs(
  durationRaw: number,
  precision: number | undefined,
): number {
  const p = precision ?? 3;
  if (p === 9) return durationRaw / 1_000_000;
  if (p === 6) return durationRaw / 1_000;
  return durationRaw;
}

function formatDuration(
  durationRaw: number,
  precision: number | undefined,
): string {
  const ms = durationMs(durationRaw, precision);
  if (ms === 0) return '0ms';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  if (ms >= 0.001) return `${(ms * 1000).toFixed(1)}μs`;
  return `${(ms * 1_000_000).toFixed(0)}ns`;
}

// ---- Status helpers ------------------------------------------------

function getStatusLabel(node: SpanNode): string {
  if (node.kind === 'log') {
    const sev = node.StatusCode?.toLowerCase();
    if (sev === 'error' || sev === 'fatal' || sev === 'critical') return 'ERR';
    if (sev === 'warn' || sev === 'warning') return 'WARN';
    return '';
  }
  if (node.StatusCode === '2' || node.StatusCode === 'Error') return 'ERR';
  if (node.StatusCode === '1') return 'WARN';
  return '';
}

function getStatusColor(node: SpanNode): 'red' | 'yellow' | undefined {
  if (node.kind === 'log') {
    const sev = node.StatusCode?.toLowerCase();
    if (sev === 'error' || sev === 'fatal' || sev === 'critical') return 'red';
    if (sev === 'warn' || sev === 'warning') return 'yellow';
    return undefined;
  }
  if (node.StatusCode === '2' || node.StatusCode === 'Error') return 'red';
  if (node.StatusCode === '1') return 'yellow';
  return undefined;
}

function getBarColor(node: SpanNode): string {
  if (node.kind === 'log') return 'green';
  if (node.StatusCode === '2' || node.StatusCode === 'Error') return 'red';
  if (node.StatusCode === '1') return 'yellow';
  return 'cyan';
}

// ---- Tree building -------------------------------------------------

/**
 * Build a tree from trace spans and (optionally) correlated log events.
 *
 * Mirrors the web frontend's DBTraceWaterfallChart DAG logic:
 * - All rows (traces + logs) are merged and sorted by timestamp
 * - Single pass builds the tree:
 *   - Trace spans use ParentSpanId for parent-child
 *   - Log events use `SpanId-log` as their node key and attach to
 *     the trace span with matching SpanId
 * - Placeholder mechanism: if a child arrives before its parent,
 *   a placeholder is created; when the parent arrives it inherits
 *   the placeholder's children
 * - Children appear in insertion order (already chronological
 *   because input is time-sorted), so DFS produces a timeline
 */
/**
 * Build a tree from trace spans and (optionally) correlated log events.
 *
 * This is a direct port of DBTraceWaterfallChart's DAG builder.
 */
function buildTree(
  traceSpans: TaggedSpanRow[],
  logEvents: TaggedSpanRow[],
): SpanNode[] {
  const validSpanIds = new Set(
    traceSpans.filter(s => s.SpanId).map(s => s.SpanId),
  );

  const rootNodes: SpanNode[] = [];
  const nodesMap = new Map<string, SpanNode>(); // Maps nodeId → Node
  const spanIdMap = new Map<string, string>(); // Maps SpanId → nodeId of FIRST node

  // Merge and sort by timestamp (matches web frontend)
  const allRows: TaggedSpanRow[] = [...traceSpans, ...logEvents];
  allRows.sort(
    (a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime(),
  );

  let idCounter = 0;
  for (const row of allRows) {
    const { kind, SpanId, ParentSpanId } = row;
    if (!SpanId) continue;

    const nodeSpanId = kind === 'log' ? `${SpanId}-log` : SpanId;
    const nodeParentSpanId = kind === 'log' ? SpanId : ParentSpanId || '';

    const nodeId = `n-${idCounter++}`;
    const curNode: SpanNode = { ...row, children: [], level: 0 };

    if (kind === 'span') {
      if (!spanIdMap.has(nodeSpanId)) {
        spanIdMap.set(nodeSpanId, nodeId);

        // Inherit children from placeholder if one was created earlier
        const placeholderId = `placeholder-${nodeSpanId}`;
        const placeholder = nodesMap.get(placeholderId);
        if (placeholder) {
          curNode.children = placeholder.children || [];
          nodesMap.delete(placeholderId);
        }
      }
      // Always add to nodesMap with unique nodeId
      nodesMap.set(nodeId, curNode);
    }

    const isRootNode =
      kind === 'span' &&
      (!nodeParentSpanId || !validSpanIds.has(nodeParentSpanId));

    if (isRootNode) {
      rootNodes.push(curNode);
    } else {
      const parentNodeId = spanIdMap.get(nodeParentSpanId);
      let parentNode = parentNodeId ? nodesMap.get(parentNodeId) : undefined;

      if (!parentNode) {
        const placeholderId = `placeholder-${nodeParentSpanId}`;
        parentNode = nodesMap.get(placeholderId);
        if (!parentNode) {
          parentNode = { children: [] } as unknown as SpanNode;
          nodesMap.set(placeholderId, parentNode);
        }
      }

      parentNode.children.push(curNode);
    }
  }

  // Flatten via in-order DFS traversal
  const flattenNode = (node: SpanNode, result: SpanNode[], level: number) => {
    node.level = level;
    result.push(node);
    for (const child of node.children) {
      flattenNode(child, result, level + 1);
    }
  };

  const flattened: SpanNode[] = [];
  for (const root of rootNodes) {
    flattenNode(root, flattened, 0);
  }

  return flattened;
}

// ---- Bar rendering -------------------------------------------------

function renderBar(
  startMs: number,
  durMs: number,
  minMs: number,
  maxMs: number,
  barWidth: number,
): string {
  const totalMs = maxMs - minMs;
  if (totalMs <= 0 || barWidth <= 0) return '';

  const startFrac = (startMs - minMs) / totalMs;
  const durFrac = durMs / totalMs;

  const startCol = Math.round(startFrac * barWidth);
  const barLen = Math.max(1, Math.round(durFrac * barWidth));
  const endCol = Math.min(startCol + barLen, barWidth);

  const leading = ' '.repeat(Math.max(0, startCol));
  const bar = '█'.repeat(Math.max(1, endCol - Math.max(0, startCol)));
  return (leading + bar).slice(0, barWidth);
}

// ---- Component -----------------------------------------------------

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

  const [traceSpans, setTraceSpans] = useState<TaggedSpanRow[]>([]);
  const [logEvents, setLogEvents] = useState<TaggedSpanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Fetch trace spans
        const traceQuery = buildTraceSpansSql({ source, traceId });
        const traceResultSet = await clickhouseClient.query({
          query: traceQuery.sql,
          format: 'JSON',
          connectionId: traceQuery.connectionId,
        });
        const traceJson = await traceResultSet.json<SpanRow>();
        const spans = ((traceJson.data ?? []) as SpanRow[]).map(r => ({
          ...r,
          kind: 'span' as const,
        }));

        // Fetch correlated log events (if log source exists)
        let logs: TaggedSpanRow[] = [];
        if (logSource) {
          const logQuery = buildTraceLogsSql({
            source: logSource,
            traceId,
          });
          const logResultSet = await clickhouseClient.query({
            query: logQuery.sql,
            format: 'JSON',
            connectionId: logQuery.connectionId,
          });
          const logJson = await logResultSet.json<SpanRow>();
          logs = ((logJson.data ?? []) as SpanRow[]).map(r => ({
            ...r,
            Duration: 0, // Logs have no duration
            kind: 'log' as const,
          }));
        }

        if (!cancelled) {
          setTraceSpans(spans);
          setLogEvents(logs);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clickhouseClient, source, logSource, traceId]);

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

  // Fetch SELECT * for the selected span/log.
  // Use stable scalar deps (SpanId, Timestamp, kind) instead of the
  // visibleNodesForIndex array ref to avoid infinite re-fetch loops.
  const [selectedRowData, setSelectedRowData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [selectedRowLoading, setSelectedRowLoading] = useState(false);

  const selectedNode =
    effectiveIndex != null ? visibleNodesForIndex[effectiveIndex] : null;
  const selectedNodeSpanId = selectedNode?.SpanId ?? null;
  const selectedNodeTimestamp = selectedNode?.Timestamp ?? null;
  const selectedNodeKind = selectedNode?.kind ?? null;

  const fetchIdRef = React.useRef(0);

  useEffect(() => {
    if (!selectedNodeTimestamp || !selectedNodeKind) {
      // Don't clear existing data — keep showing old data while
      // transitioning between spans to avoid flashing
      return;
    }

    const isLog = selectedNodeKind === 'log';
    const rowSource = isLog && logSource ? logSource : source;

    const db = rowSource.from.databaseName;
    const table = rowSource.from.tableName;
    const spanIdExpr = rowSource.spanIdExpression ?? 'SpanId';
    const tsExpr =
      rowSource.displayedTimestampValueExpression ??
      rowSource.timestampValueExpression ??
      'TimestampTime';

    const traceIdExpr = rowSource.traceIdExpression ?? 'TraceId';
    const escapedTs = SqlString.escape(selectedNodeTimestamp);
    const escapedTraceId = SqlString.escape(traceId);

    // Build WHERE: always use TraceId + Timestamp; add SpanId if available
    const clauses = [
      `${traceIdExpr} = ${escapedTraceId}`,
      `${tsExpr} = parseDateTime64BestEffort(${escapedTs}, 9)`,
    ];
    if (selectedNodeSpanId) {
      clauses.push(`${spanIdExpr} = ${SqlString.escape(selectedNodeSpanId)}`);
    }
    const where = clauses.join(' AND ');
    const sql = `SELECT * FROM ${db}.${table} WHERE ${where} LIMIT 1`;

    const fetchId = ++fetchIdRef.current;
    // Don't clear existing data or set loading — keep old data visible
    // while fetching to avoid flashing

    (async () => {
      try {
        const resultSet = await clickhouseClient.query({
          query: sql,
          format: 'JSON',
          connectionId: rowSource.connection,
        });
        const json = await resultSet.json<Record<string, unknown>>();
        const row = (json.data as Record<string, unknown>[])?.[0];
        if (fetchId === fetchIdRef.current) {
          setSelectedRowData(row ?? null);
          setSelectedRowLoading(false);
        }
      } catch {
        if (fetchId === fetchIdRef.current) {
          setSelectedRowData(null);
          setSelectedRowLoading(false);
        }
      }
    })();

    return () => {
      // Stale fetch — don't update state (fetchId check handles this)
    };
  }, [
    selectedNodeSpanId,
    selectedNodeTimestamp,
    selectedNodeKind,
    source,
    logSource,
    clickhouseClient,
    traceId,
  ]);

  if (loading) {
    return (
      <Text>
        <Spinner type="dots" /> Loading trace spans…
      </Text>
    );
  }

  if (error) {
    return <Text color="red">Error loading trace: {error}</Text>;
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
