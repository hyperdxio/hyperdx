import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import _, { omit } from 'lodash';
import { useForm } from 'react-hook-form';
import SqlString from 'sqlstring';
import TimestampNano from 'timestamp-nano';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  ChartConfig,
  ChartConfigWithDateRange,
  SelectList,
  SourceKind,
  TLogSource,
  TSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
  Box,
  Center,
  Chip,
  Code,
  Group,
  Text,
  Tooltip,
} from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import {
  IconAlertCircleFilled,
  IconAlertTriangleFilled,
  IconChevronDown,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsRight,
  IconLogs,
} from '@tabler/icons-react';

import { ContactSupportText } from '@/components/ContactSupportText';
import SearchWhereInput, {
  getStoredLanguage,
} from '@/components/SearchInput/SearchWhereInput';
import {
  TimelineChart,
  TimelineMinimap,
  type TimelineViewportController,
} from '@/components/TimelineChart';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import useRowWhere, { WithClause } from '@/hooks/useRowWhere';
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';
import {
  getDisplayedTimestampValueExpression,
  getDurationSecondsExpression,
  getEventBody,
  getSpanEventBody,
} from '@/source';
import { useFormatTime } from '@/useFormatTime';
import {
  CATEGORICAL_PALETTE_TOKENS,
  COLORS,
  getChartColorError,
  getChartColorSuccess,
  getChartColorSuccessHighlight,
  getChartColorWarning,
  parseTimestampToMs,
} from '@/utils';
import {
  getHighlightedAttributesFromData,
  getSelectExpressionsForHighlightedAttributes,
} from '@/utils/highlightedAttributes';

import { DBHighlightedAttributesList } from './DBHighlightedAttributesList';

import styles from '@/../styles/LogSidePanel.module.scss';

export type SpanRow = {
  Body: string;
  Timestamp: string;
  Duration: number; // seconds
  SpanId: string;
  ParentSpanId: string;
  StatusCode?: string;
  ServiceName?: string;
  SeverityText?: string;
  HyperDXEventType: 'span';
  type?: string;
  SpanAttributes?: Record<string, any>;
  SpanEvents?: Array<{
    Timestamp: string;
    Name: string;
    Attributes: Record<string, any>;
  }>;
  __hdx_hidden?: boolean | 1 | 0;
};

type TimestampedRow = {
  Timestamp: string;
};

// Bar background color. Correlated log rows are always green (success), error
// spans are always red, and every other span takes its per-service color.
function barColor(condition: {
  isHighlighted: boolean;
  isError?: boolean;
  type: string | undefined;
  serviceColor?: string;
}) {
  const { isHighlighted, isError, type, serviceColor } = condition;

  if (type === SourceKind.Log) {
    return isHighlighted
      ? getChartColorSuccessHighlight()
      : getChartColorSuccess();
  }

  if (isError) {
    return isHighlighted
      ? `color-mix(in srgb, ${getChartColorError()} 60%, white)`
      : getChartColorError();
  }

  if (serviceColor) {
    return isHighlighted
      ? `color-mix(in srgb, ${serviceColor} 60%, white)`
      : serviceColor;
  }

  return isHighlighted ? '#A9AFB7' : '#6A7077';
}

// Per-service span palette: the full categorical palette minus the two hues we
// reserve for semantics — green (correlated log rows) and red (error spans) —
// so a service color is never confused with a log or an error. Index-aligned
// with CATEGORICAL_PALETTE_TOKENS, so filtering by token survives reordering.
const SERVICE_COLORS = COLORS.filter(
  (_color, i) =>
    CATEGORICAL_PALETTE_TOKENS[i] !== 'chart-green' &&
    CATEGORICAL_PALETTE_TOKENS[i] !== 'chart-red',
);

function getTableBody(tableModel: TSource) {
  if (tableModel?.kind === SourceKind.Trace) {
    return getSpanEventBody(tableModel) ?? '';
  } else if (tableModel?.kind === SourceKind.Log) {
    return getEventBody(tableModel) ?? '';
  } else {
    return '';
  }
}

function getConfig(
  source: TTraceSource | TLogSource,
  traceId: string,
  hiddenRowExpression?: string,
  hiddenRowExpressionLanguage: 'lucene' | 'sql' = 'lucene',
) {
  const alias: Record<string, string> = {
    Body: getTableBody(source),
    Timestamp: getDisplayedTimestampValueExpression(source),
    Duration:
      source.kind === SourceKind.Trace && source.durationExpression
        ? getDurationSecondsExpression(source)
        : '',
    TraceId: source.traceIdExpression ?? '',
    SpanId: source.spanIdExpression ?? '',
    ParentSpanId:
      source.kind === SourceKind.Trace
        ? (source.parentSpanIdExpression ?? '')
        : '',
    StatusCode:
      source.kind === SourceKind.Trace
        ? (source.statusCodeExpression ?? '')
        : '',
    ServiceName: source.serviceNameExpression ?? '',
    SeverityText:
      source.kind === SourceKind.Log
        ? (source.severityTextExpression ?? '')
        : '',
    SpanAttributes: source.eventAttributesExpression ?? '',
    SpanEvents:
      source.kind === SourceKind.Trace
        ? (source.spanEventsValueExpression ?? '')
        : '',
  };

  // Aliases for trace attributes must be added here to ensure
  // the returned `alias` object includes them and useRowWhere works.
  if (source.highlightedTraceAttributeExpressions) {
    for (const expr of source.highlightedTraceAttributeExpressions) {
      if (expr.alias) {
        alias[expr.alias] = expr.sqlExpression;
      }
    }
  }

  const select: SelectList = [
    {
      valueExpression: alias.Body,
      alias: 'Body',
    },
    {
      valueExpression: alias.Timestamp,
      alias: 'Timestamp',
    },
    {
      valueExpression: alias.SpanId,
      alias: 'SpanId',
    },
    ...(alias.ServiceName
      ? [
          {
            valueExpression: alias.ServiceName,
            alias: 'ServiceName',
          },
        ]
      : []),
    ...(hiddenRowExpression
      ? [
          {
            valueExpression: hiddenRowExpression,
            valueExpressionLanguage: hiddenRowExpressionLanguage,
            alias: '__hdx_hidden',
          },
        ]
      : []),
  ];

  if (source.kind === SourceKind.Trace || source.kind === SourceKind.Log) {
    select.push(
      ...getSelectExpressionsForHighlightedAttributes(
        source.highlightedTraceAttributeExpressions,
      ),
    );
  }

  if (hiddenRowExpression) {
    alias['__hdx_hidden'] = hiddenRowExpression;
  }

  if (source.kind === SourceKind.Trace) {
    select.push(
      ...[
        {
          // in Seconds, f64 holds ns precision for durations up to ~3 months
          valueExpression: alias.Duration,
          alias: 'Duration',
        },
        {
          valueExpression: alias.ParentSpanId,
          alias: 'ParentSpanId',
        },
        ...(alias.StatusCode
          ? [
              {
                valueExpression: alias.StatusCode,
                alias: 'StatusCode',
              },
            ]
          : []),
        ...(alias.SpanAttributes
          ? [
              {
                valueExpression: alias.SpanAttributes,
                alias: 'SpanAttributes',
              },
            ]
          : []),
        ...(alias.SpanEvents
          ? [
              {
                valueExpression: alias.SpanEvents,
                alias: 'SpanEvents',
              },
            ]
          : []),
      ],
    );
  } else if (source.kind === SourceKind.Log) {
    select.push(
      ...[
        ...(alias.SeverityText
          ? [
              {
                valueExpression: alias.SeverityText,
                alias: 'SeverityText',
              },
            ]
          : []),
      ],
    );
  }
  const config = {
    select,
    from: source.from,
    timestampValueExpression: source.timestampValueExpression,
    where: `${alias.TraceId} = ${SqlString.escape(traceId)}`,
    limit: { limit: 50000 },
    connection: source.connection,
  };
  return { config, alias, type: source.kind };
}

export function useEventsData({
  config,
  dateRangeStartInclusive,
  dateRange,
  enabled,
}: {
  config: ChartConfig;
  dateRangeStartInclusive: boolean;
  dateRange: [Date, Date];
  enabled: boolean;
}) {
  const query: ChartConfigWithDateRange = useMemo(() => {
    return {
      ...config,
      dateRange,
      dateRangeStartInclusive,
    };
  }, [config, dateRange, dateRangeStartInclusive]);
  return useOffsetPaginatedQuery(query, { enabled });
}

export function useEventsAroundFocus({
  tableSource,
  focusDate,
  dateRange,
  traceId,
  enabled,
  hiddenRowExpression,
  hiddenRowExpressionLanguage = 'lucene',
}: {
  tableSource: TTraceSource | TLogSource;
  focusDate: Date;
  dateRange: [Date, Date];
  traceId: string;
  enabled: boolean;
  /** An expression (in `hiddenRowExpressionLanguage`) that identifies rows to be hidden. Hidden rows will be returned with a `__hdx_hidden: true` column. */
  hiddenRowExpression?: string;
  hiddenRowExpressionLanguage?: 'lucene' | 'sql';
}) {
  const { config, alias, type } = useMemo(
    () =>
      getConfig(
        tableSource,
        traceId,
        hiddenRowExpression,
        hiddenRowExpressionLanguage,
      ),
    [tableSource, traceId, hiddenRowExpression, hiddenRowExpressionLanguage],
  );

  const {
    data: beforeSpanData,
    isFetching: isBeforeSpanFetching,
    error: beforeSpanError,
  } = useEventsData({
    config,
    dateRangeStartInclusive: true,
    dateRange: [dateRange[0], focusDate],
    enabled,
  });

  const {
    data: afterSpanData,
    isFetching: isAfterSpanFetching,
    error: afterSpanError,
  } = useEventsData({
    config,
    dateRangeStartInclusive: false,
    dateRange: [focusDate, dateRange[1]],
    enabled,
  });

  const isFetching = isBeforeSpanFetching || isAfterSpanFetching;
  const meta = beforeSpanData?.meta ?? afterSpanData?.meta;
  const error = beforeSpanError || afterSpanError;

  const getRowWhere = useRowWhere({ meta, aliasMap: alias });
  const rows = useMemo(() => {
    // Sometimes meta has not loaded yet
    // DO NOT REMOVE, useRowWhere will error if no meta
    if (!meta || meta.length === 0) return [];
    return [
      ...(beforeSpanData?.data ?? []),
      ...(afterSpanData?.data ?? []),
    ].map(cd => {
      // Omit SpanAttributes, SpanEvents and __hdx_hidden from rowWhere id generation.
      // SpanAttributes and SpanEvents can be large objects, and __hdx_hidden may be a lucene expression.
      const rowWhereResult = getRowWhere(
        omit(cd, ['SpanAttributes', 'SpanEvents', '__hdx_hidden']),
      );

      return {
        // Keep all fields available for display
        ...cd,
        // Added for typing
        Timestamp: cd?.Timestamp,
        SpanId: cd?.SpanId,
        __hdx_hidden: cd?.__hdx_hidden,
        type,
        id: rowWhereResult.where,
        // Don't pass aliasWith for trace waterfall chart - the WHERE clause already uses
        // raw column expressions (e.g., SpanName='value'), and the aliasMap creates
        // redundant WITH clauses like (Timestamp) AS Timestamp that interfere with queries.
        aliasWith: [],
      };
    });
  }, [afterSpanData, beforeSpanData, meta, getRowWhere, type]);

  return {
    rows,
    meta,
    isFetching,
    error,
  };
}

export function getDescendantIds(node: {
  id?: string;
  children?: Array<{ id?: string; children?: any[] }>;
}): string[] {
  const ids: string[] = [];

  if (!node.children?.length) {
    return ids;
  }

  for (const child of node.children) {
    if (child.id) {
      ids.push(child.id);
    }

    ids.push(...getDescendantIds(child));
  }

  return ids;
}

/** "Collapse all": every collapsible parent, at every level, becomes collapsed. */
export function computeCollapseAll(
  parentIdsByLevel: Map<number, Set<string>>,
): Set<string> {
  const allParentIds = new Set<string>();
  parentIdsByLevel.forEach(ids => {
    ids.forEach(id => allParentIds.add(id));
  });
  return allParentIds;
}

/**
 * "Expand one level": expand the shallowest level that still has any collapsed
 * parents.
 */
export function computeExpandOneLevel(
  collapsedIds: Set<string>,
  parentIdsByLevel: Map<number, Set<string>>,
): Set<string> {
  if (collapsedIds.size === 0) return collapsedIds;
  const newSet = new Set(collapsedIds);
  // Shallowest first: expanding starts at the top of the tree.
  const sortedLevels = [...parentIdsByLevel.keys()].sort((a, b) => a - b);
  for (const level of sortedLevels) {
    const ids = parentIdsByLevel.get(level)!;
    const collapsedAtLevel = [...ids].filter(id => newSet.has(id));
    if (collapsedAtLevel.length > 0) {
      collapsedAtLevel.forEach(id => newSet.delete(id));
      break;
    }
  }
  return newSet;
}

export function computeCollapseOneLevel(
  collapsedIds: Set<string>,
  parentIdsByLevel: Map<number, Set<string>>,
): Set<string> {
  const newSet = new Set(collapsedIds);
  // Deepest first: collapsing starts at the bottom of the tree.
  const sortedLevels = [...parentIdsByLevel.keys()].sort((a, b) => b - a);
  for (const level of sortedLevels) {
    const ids = parentIdsByLevel.get(level)!;
    const expandedAtLevel = [...ids].filter(id => !newSet.has(id));
    if (expandedAtLevel.length > 0) {
      expandedAtLevel.forEach(id => newSet.add(id));
      break;
    }
  }
  return newSet;
}

export function computeToggleCollapse(
  collapsedIds: Set<string>,
  id: string,
  node:
    | { id?: string; children?: Array<{ id?: string; children?: any[] }> }
    | undefined,
  includeDescendants: boolean,
): Set<string> {
  const next = new Set(collapsedIds);
  const wasCollapsed = next.has(id);

  if (wasCollapsed) {
    next.delete(id);
  } else {
    next.add(id);
  }

  if (includeDescendants && node?.children?.length) {
    // Match every descendant to the node's new state.
    const descendantIds = getDescendantIds(node);
    if (wasCollapsed) {
      descendantIds.forEach(descId => next.delete(descId));
    } else {
      descendantIds.forEach(descId => next.add(descId));
    }
  }

  return next;
}

// TODO: Optimize with ts lookup tables
export function DBTraceWaterfallChartContainer({
  traceTableSource,
  logTableSource,
  traceId,
  dateRange,
  focusDate,
  onClick,
  highlightedRowWhere,
  initialRowHighlightHint,
  emptyState,
  controlsExtra,
}: {
  traceTableSource: TTraceSource;
  logTableSource: TLogSource | null;
  traceId: string;
  dateRange: [Date, Date];
  focusDate: Date;
  onClick?: (rowWhere: {
    id: string;
    type: string;
    aliasWith: WithClause[];
  }) => void;
  highlightedRowWhere?: string | null;
  initialRowHighlightHint?: {
    timestamp: string;
    spanId: string;
    body: string;
  };
  emptyState?: ReactNode;
  /** Extra controls rendered in the waterfall controls bar (e.g. the correlated logs source selector). */
  controlsExtra?: ReactNode;
}) {
  const formatTime = useFormatTime();

  const {
    traceWhere,
    logWhere,
    whereLanguage,
    clear: clearFilters,
    isFilterActive,
    isFilterExpanded,
    setIsFilterExpanded,
    onSubmit: submitFilters,
  } = useWaterfallSearchState({
    hasLogSource: !!logTableSource,
  });

  const filterLanguage: 'lucene' | 'sql' =
    whereLanguage === 'sql' ? 'sql' : 'lucene';

  const { control, handleSubmit, setValue } = useForm({
    defaultValues: {
      traceWhere: traceWhere ?? '',
      logWhere: logWhere ?? '',
      traceWhereLanguage: getStoredLanguage() ?? 'lucene',
    },
  });

  // The combined input writes a single value; apply it to both the trace and
  // log WHERE clauses, and persist the chosen language for query rebuilds.
  const onSubmitFilters = useCallback(
    (data: { traceWhere: string; traceWhereLanguage: string }) => {
      submitFilters({
        traceWhere: data.traceWhere,
        logWhere: data.traceWhere,
        whereLanguage: data.traceWhereLanguage,
      });
    },
    [submitFilters],
  );

  const onClearFilters = useCallback(() => {
    setValue('traceWhere', '');
    setValue('logWhere', '');
    clearFilters();
  }, [clearFilters, setValue]);

  const {
    rows: traceRowsData,
    isFetching: traceIsFetching,
    meta: traceRowsMeta,
    error: traceError,
  } = useEventsAroundFocus({
    tableSource: traceTableSource,
    focusDate,
    dateRange,
    traceId,
    hiddenRowExpression: traceWhere ? `NOT (${traceWhere})` : undefined,
    hiddenRowExpressionLanguage: filterLanguage,
    enabled: true,
  });
  const {
    rows: logRowsData,
    isFetching: logIsFetching,
    meta: logRowsMeta,
    error: logError,
  } = useEventsAroundFocus({
    // search data if logTableModel exist
    // search invalid date range if no logTableModel(react hook need execute no matter what)
    tableSource: logTableSource ? logTableSource : traceTableSource,
    focusDate,
    dateRange: logTableSource ? dateRange : [dateRange[1], dateRange[0]], // different query to prevent cache
    traceId,
    hiddenRowExpression: logWhere ? `NOT (${logWhere})` : undefined,
    hiddenRowExpressionLanguage: filterLanguage,
    enabled: logTableSource ? true : false, // disable fire query if logSource is not exist
  });

  const isFetching = traceIsFetching || logIsFetching;
  const error = traceError || logError;

  const rows: any[] = useMemo(() => {
    const nextRows: Array<(typeof traceRowsData)[number] & TimestampedRow> = [
      ...traceRowsData,
      ...logRowsData,
    ];
    nextRows.sort((a, b) => {
      const aDate = TimestampNano.fromString(a.Timestamp);
      const bDate = TimestampNano.fromString(b.Timestamp);
      const secDiff = aDate.getTimeT() - bDate.getTimeT();
      if (secDiff === 0) {
        return aDate.getNano() - bDate.getNano();
      } else {
        return secDiff;
      }
    });

    return nextRows;
  }, [traceRowsData, logRowsData]);

  // Map each distinct span service to a stable color. Sorting the names first
  // keeps a service's color stable across renders regardless of row ordering.
  const serviceColorMap = useMemo(() => {
    const serviceNames = [
      ...new Set(
        rows
          .filter(
            r =>
              r.ServiceName &&
              r.type !== SourceKind.Log &&
              typeof r.ServiceName === 'string',
          )
          .map(r => r.ServiceName),
      ),
    ].sort();

    const map = new Map<string, string>();
    serviceNames.forEach((name, i) => {
      map.set(name, SERVICE_COLORS[i % SERVICE_COLORS.length]);
    });
    return map;
  }, [rows]);

  const highlightedAttributeValues = useMemo(() => {
    const visibleTraceRowsData = traceRowsData?.filter(
      row => !row.__hdx_hidden,
    );

    const attributes = getHighlightedAttributesFromData(
      traceTableSource,
      traceTableSource.highlightedTraceAttributeExpressions,
      visibleTraceRowsData,
      traceRowsMeta,
    );

    if (logTableSource && logRowsData && logRowsMeta) {
      const visibleLogRowsData = logRowsData?.filter(row => !row.__hdx_hidden);

      attributes.push(
        ...getHighlightedAttributesFromData(
          logTableSource,
          logTableSource.highlightedTraceAttributeExpressions,
          visibleLogRowsData,
          logRowsMeta,
        ),
      );
    }

    return attributes.sort(
      (a, b) =>
        a.displayedKey.localeCompare(b.displayedKey) ||
        a.value.localeCompare(b.value),
    );
  }, [
    traceTableSource,
    traceRowsData,
    traceRowsMeta,
    logTableSource,
    logRowsData,
    logRowsMeta,
  ]);

  // Auto-select the originating span once when the panel opens — but only if
  // nothing is already selected. Two cases must NOT trigger a (re-)select:
  //   - the user explicitly cleared the selection (closing the span detail), and
  //   - a selection was restored from the URL on load (deep link / reload).
  // We mark the hint applied as soon as a selection exists or we apply it
  // ourselves, so it never fires twice for the same hint; it re-fires only when
  // the hint genuinely changes (different originating span / trace).
  const appliedHighlightHintRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialRowHighlightHint || !onClick) {
      return;
    }

    const hintKey = `${initialRowHighlightHint.timestamp}|${initialRowHighlightHint.spanId}|${initialRowHighlightHint.body}`;
    if (appliedHighlightHintRef.current === hintKey) {
      return;
    }

    // A selection already exists (restored from the URL, or user-chosen). Honor
    // it and record the hint so we never override it — now or later.
    if (highlightedRowWhere != null) {
      appliedHighlightHintRef.current = hintKey;
      return;
    }

    const initialRowHighlightIndex = rows.findIndex(row => {
      return (
        row.Timestamp === initialRowHighlightHint.timestamp &&
        row.SpanId === initialRowHighlightHint.spanId &&
        row.Body === initialRowHighlightHint.body
      );
    });

    if (initialRowHighlightIndex !== -1) {
      appliedHighlightHintRef.current = hintKey;
      onClick({
        id: rows[initialRowHighlightIndex].id,
        type: rows[initialRowHighlightIndex].type ?? '',
        aliasWith: rows[initialRowHighlightIndex].aliasWith,
      });
    }
  }, [initialRowHighlightHint, rows, onClick, highlightedRowWhere]);

  // 3 Edge-cases
  // 1. No spans, just logs (ex. sampling)
  // 2. Spans, but with missing spans inbetween (ex. missing intermediary spans)
  // 3. Spans, with multiple root nodes (ex. somehow disjoint traces fe/be)

  // Parse out a DAG of spans
  type Node = SpanRow & {
    id: string;
    parentId: string;
    children: SpanRow[];
    aliasWith: WithClause[];
  };
  const validSpanIDs = useMemo(() => {
    return new Set(
      traceRowsData // only spans in traces can define valid span ids
        ?.filter(row => _.isString(row.SpanId) && row.SpanId.length > 0)
        .map(row => row.SpanId) ?? [],
    );
  }, [traceRowsData]);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [showSpanEvents, setShowSpanEvents] = useState(true);
  const [showSpans, setShowSpans] = useState(true);
  const [showLogs, setShowLogs] = useState(true);

  const { nodesMap, flattenedNodes, parentIdsByLevel } = useMemo(() => {
    const rootNodes: Node[] = [];
    const nodesMap = new Map(); // Maps result.id (or placeholder id) -> Node
    const spanIdMap = new Map(); // Maps SpanId -> result.id of FIRST node with that SpanId

    for (const result of rows ?? []) {
      const { type, SpanId, ParentSpanId } = result;
      // ignore everything without spanId
      if (!SpanId) continue;

      // log have duplicate span id, tag it with -log
      const nodeSpanId = type === SourceKind.Log ? `${SpanId}-log` : SpanId; // prevent log spanId overwrite trace spanId
      const nodeParentSpanId =
        type === SourceKind.Log ? SpanId : ParentSpanId || '';

      const curNode = {
        ...result,
        children: [],
      };

      if (type === SourceKind.Trace) {
        // Check if this is the first node with this SpanId
        if (!spanIdMap.has(nodeSpanId)) {
          // First occurrence - this becomes the canonical node for this SpanId
          spanIdMap.set(nodeSpanId, result.id);

          // Check if there's a placeholder parent waiting for this SpanId
          const placeholderId = `placeholder-${nodeSpanId}`;
          const placeholder = nodesMap.get(placeholderId);
          if (placeholder) {
            // Inherit children from placeholder
            curNode.children = placeholder.children || [];
            // Remove placeholder
            nodesMap.delete(placeholderId);
          }
        }
        // Always add to nodesMap with unique result.id
        nodesMap.set(result.id, curNode);
      }

      // root if: is trace event, and (has no parent or parent id is not valid)
      const isRootNode =
        type === SourceKind.Trace &&
        (!nodeParentSpanId || !validSpanIDs.has(nodeParentSpanId));

      if (isRootNode) {
        rootNodes.push(curNode);
      } else {
        // Look up parent by SpanId
        const parentResultId = spanIdMap.get(nodeParentSpanId);
        let parentNode = parentResultId
          ? nodesMap.get(parentResultId)
          : undefined;

        if (!parentNode) {
          // Parent doesn't exist yet, create placeholder
          const placeholderId = `placeholder-${nodeParentSpanId}`;
          parentNode = nodesMap.get(placeholderId);
          if (!parentNode) {
            parentNode = { children: [] } as any;
            nodesMap.set(placeholderId, parentNode);
          }
        }

        parentNode.children.push(curNode);
      }
    }

    // Build a map of level → parent node IDs (nodes that have children) so the
    // depth controls can expand/collapse a whole level at a time.
    const parentIdsByLevel = new Map<number, Set<string>>();
    const collectParents = (node: any, level: number) => {
      if (node.children?.length > 0 && node.id) {
        if (!parentIdsByLevel.has(level)) {
          parentIdsByLevel.set(level, new Set());
        }
        parentIdsByLevel.get(level)!.add(node.id);
      }
      node.children?.forEach((child: any) => collectParents(child, level + 1));
    };
    rootNodes.forEach(root => collectParents(root, 0));

    type NodeWithLevel = Node & { level: number };
    // flatten the rootnode dag into an array via in-order traversal
    const traverse = (node: Node, arr: NodeWithLevel[], level = 0) => {
      // Filter out hidden nodes, but still traverse their (non-hidden) descendants
      if (!node.__hdx_hidden) {
        arr.push({
          level,
          ...node,
        });
      }

      // Filter out collapsed nodes
      if (collapsedIds.has(node.id)) {
        return;
      }
      node?.children?.forEach((child: any) => traverse(child, arr, level + 1));
    };

    const flattenedNodes: NodeWithLevel[] = [];
    if (rootNodes.length > 0) {
      rootNodes.forEach(rootNode => traverse(rootNode, flattenedNodes));
    }

    return { nodesMap, flattenedNodes, parentIdsByLevel };
  }, [collapsedIds, rows, validSpanIDs]);

  const toggleCollapse = useCallback(
    (id: string, event: React.MouseEvent) => {
      event.stopPropagation(); // prevent collapsing from selecting row
      // Alt/Option-click toggles the whole subtree along with the node.
      setCollapsedIds(prev =>
        computeToggleCollapse(prev, id, nodesMap.get(id), event.altKey),
      );
    },
    [nodesMap],
  );

  const expandAll = useCallback(() => {
    setCollapsedIds(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedIds(computeCollapseAll(parentIdsByLevel));
  }, [parentIdsByLevel]);

  const expandOneLevel = useCallback(() => {
    setCollapsedIds(prev => computeExpandOneLevel(prev, parentIdsByLevel));
  }, [parentIdsByLevel]);

  const collapseOneLevel = useCallback(() => {
    setCollapsedIds(prev => computeCollapseOneLevel(prev, parentIdsByLevel));
  }, [parentIdsByLevel]);

  const hasCollapsibleNodes = parentIdsByLevel.size > 0;

  const visibleNodes = useMemo(() => {
    if (showSpans && showLogs) return flattenedNodes;
    return flattenedNodes.filter(node => {
      if (node.type === SourceKind.Log) return showLogs;
      return showSpans;
    });
  }, [flattenedNodes, showSpans, showLogs]);

  const spanCount = visibleNodes.filter(
    node => node.type !== SourceKind.Log,
  ).length;
  const logCount = visibleNodes.filter(
    node => node.type === SourceKind.Log,
  ).length;
  const errorCount = visibleNodes.filter(
    node =>
      node.StatusCode === 'Error' ||
      node.SeverityText?.toLowerCase() === 'error',
  ).length;

  const countParts: string[] = [];
  if (spanCount > 0) {
    countParts.push(`${spanCount} span${spanCount !== 1 ? 's' : ''}`);
  }
  if (logCount > 0) {
    countParts.push(`${logCount} log${logCount !== 1 ? 's' : ''}`);
  }
  const itemCountString = countParts.join(', ') || '0 items';
  const errorCountString = `${errorCount} error${errorCount !== 1 ? 's' : ''}`;

  // TODO: Add duration filter?
  // TODO: Add backend filters for duration and collapsing?

  // All units in ms!
  const foundMinOffset =
    rows?.reduce((acc, result) => {
      return Math.min(acc, parseTimestampToMs(result.Timestamp));
    }, Number.MAX_SAFE_INTEGER) ?? 0;
  const minOffset =
    foundMinOffset === Number.MAX_SAFE_INTEGER ? 0 : foundMinOffset;

  const timelineRows = useMemo(
    () =>
      visibleNodes.map(result => {
        const tookMs = (result.Duration || 0) * 1000;
        const startOffset = parseTimestampToMs(result.Timestamp);
        const start = startOffset - minOffset;
        const end = start + tookMs;

        const {
          Body: _body,
          ServiceName: serviceName,
          id,
          type,
          aliasWith,
        } = result;
        let body = `${_body}`;
        try {
          body = typeof _body === 'string' ? _body : JSON.stringify(_body);
        } catch (e) {
          console.warn(
            "DBTraceWaterfallChart: Couldn't JSON stringify Body",
            e,
          );
        }

        // Extract HTTP-related logic
        const eventAttributes = result.SpanAttributes || {};
        const hasHttpAttributes =
          eventAttributes['http.url'] || eventAttributes['http.method'];
        const httpUrl = eventAttributes['http.url'];

        const displayText =
          hasHttpAttributes && httpUrl ? `${body} ${httpUrl}` : body;

        // Process span events into markers (only if showSpanEvents is enabled)
        const markers =
          showSpanEvents && result.SpanEvents
            ? result.SpanEvents.map(spanEvent => ({
                timestamp: parseTimestampToMs(spanEvent.Timestamp) - minOffset,
                name: spanEvent.Name,
                attributes: spanEvent.Attributes || {},
              }))
            : [];

        // Extract status logic
        // TODO: Legacy schemas will have STATUS_CODE_ERROR
        // See: https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/34799/files#diff-1ec84547ed93f2c8bfb21c371ca0b5304f01371e748d4b02bf397313a4b1dfa4L197
        const isError =
          result.StatusCode == 'Error' || result.SeverityText === 'error';
        const status = result.StatusCode || result.SeverityText;
        const isWarn = result.SeverityText === 'warn';
        const isHighlighted = highlightedRowWhere === id;

        const barBackgroundColor =
          type === SourceKind.Log
            ? getChartColorSuccess()
            : serviceName
              ? (serviceColorMap.get(serviceName) ?? '#6A7077')
              : '#6A7077';

        return {
          id,
          type,
          aliasWith,
          label: (
            <div
              className={`${
                isHighlighted && styles.traceTimelineLabelHighlighted
              } text-truncate cursor-pointer ps-2 ${styles.traceTimelineLabel}`}
              role="button"
              onClick={() => {
                onClick?.({ id, type: type ?? '', aliasWith });
              }}
            >
              <div className="d-flex align-items-center" style={{ height: 24 }}>
                {Array.from({ length: result.level }).map((_, index) => (
                  <div
                    key={index}
                    style={{
                      borderLeft: '1px solid var(--color-border)',
                      marginLeft: 7,
                      width: 8,
                      minWidth: 8,
                      maxWidth: 8,
                      flexGrow: 1,
                      flexShrink: 0,
                      height: '100%',
                    }}
                  ></div>
                ))}

                <Center
                  style={{
                    opacity: result.children.length > 0 ? 1 : 0,
                  }}
                  onClick={
                    result.children.length > 0
                      ? e => {
                          toggleCollapse(id, e);
                        }
                      : undefined
                  }
                >
                  {collapsedIds.has(id) ? (
                    <IconChevronRight size={16} className="me-1" />
                  ) : (
                    <IconChevronDown size={16} className="me-1" />
                  )}{' '}
                </Center>

                <div
                  style={{
                    width: 3,
                    minWidth: 3,
                    height: 14,
                    backgroundColor: barBackgroundColor,
                    borderRadius: 1,
                    flexShrink: 0,
                    marginRight: 6,
                  }}
                />

                {result.children.length > 0 && (
                  <Text
                    span
                    size="xxs"
                    c="dimmed"
                    me={4}
                    style={{ flexShrink: 0 }}
                  >
                    ({result.children.length})
                  </Text>
                )}

                {isError && (
                  <IconAlertCircleFilled
                    size={12}
                    className="me-1 flex-shrink-0"
                    style={{ color: getChartColorError() }}
                    aria-label="Error"
                  />
                )}
                {isWarn && !isError && (
                  <IconAlertTriangleFilled
                    size={12}
                    className="me-1 flex-shrink-0"
                    style={{ color: getChartColorWarning() }}
                    aria-label="Warning"
                  />
                )}

                <Group gap={0} wrap="nowrap">
                  {type === SourceKind.Log ? (
                    <IconLogs
                      size={14}
                      className="align-middle me-2"
                      aria-label="Correlated Log Line"
                    />
                  ) : null}
                  <Text
                    size="xxs"
                    truncate="end"
                    span
                    title={`${serviceName}${hasHttpAttributes && httpUrl ? ` ${displayText}` : ''}`}
                    role="button"
                  >
                    {serviceName && <>{serviceName} </>}
                    <Text span inherit c="dimmed">
                      {displayText}
                    </Text>
                  </Text>
                </Group>
              </div>
            </div>
          ),
          isActive: isHighlighted,
          events: [
            {
              id,
              type,
              aliasWith,
              start,
              end,
              tooltip: `${displayText} ${tookMs >= 0 ? `took ${tookMs.toFixed(4)}ms` : ''} ${status ? `| Status: ${status}` : ''}${!isNaN(startOffset) ? ` | Started at ${formatTime(new Date(startOffset), { format: 'withMs' })}` : ''}`,
              color: 'var(--color-text-inverted)',
              backgroundColor: barColor({
                isHighlighted,
                isError,
                type,
                serviceColor: serviceName
                  ? serviceColorMap.get(serviceName)
                  : undefined,
              }),
              body: <span>{displayText}</span>,
              minWidthPx: type === SourceKind.Log ? 10 : 2,
              isError,
              markers,
              showDuration: type !== SourceKind.Log,
            },
          ],
        };
      }),
    [
      collapsedIds,
      visibleNodes,
      formatTime,
      highlightedRowWhere,
      minOffset,
      onClick,
      serviceColorMap,
      showSpanEvents,
      toggleCollapse,
    ],
  );
  const initialScrollRowIndex = visibleNodes.findIndex(v => {
    return v.id === highlightedRowWhere;
  });

  const { ref: timelineWrapperRef, height: timelineWrapperHeight } =
    useElementSize();

  const [viewportController, setViewportController] =
    useState<TimelineViewportController | null>(null);

  const showMinimap =
    !isFetching && !error && rows != null && visibleNodes.length > 0;

  return (
    <>
      {showMinimap && (
        <Box mb="md">
          <TimelineMinimap
            rows={timelineRows}
            controller={viewportController}
          />
        </Box>
      )}
      {isFilterExpanded && (
        <form onSubmit={handleSubmit(onSubmitFilters)}>
          <Box mt="xs">
            <SearchWhereInput
              tableConnection={tcFromSource(traceTableSource)}
              name="traceWhere"
              languageName="traceWhereLanguage"
              control={control}
              size="xs"
              showLabel={false}
              allowMultiline={false}
              onSubmit={handleSubmit(onSubmitFilters)}
              onLanguageChange={lang =>
                setValue('traceWhereLanguage', lang, { shouldDirty: true })
              }
              lucenePlaceholder='Filter spans & logs ex. StatusCode:"Error"'
              sqlPlaceholder="Filter spans & logs ex. StatusCode = 'Error'"
              data-testid="trace-search-input"
              // The waterfall lives inside an `overflow: hidden` column, which
              // clips the SQL editor's autocomplete tooltip. Portal it to the
              // document body so suggestions aren't cut off (Lucene mode already
              // renders its dropdown in a portal).
              parentRef={typeof document !== 'undefined' ? document.body : null}
            />
          </Box>
        </form>
      )}
      <Group my="xs" justify="space-between">
        <Group gap="md">
          {hasCollapsibleNodes && (
            <Group gap={2}>
              <Tooltip label="Expand +1 level" position="bottom">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={expandOneLevel}
                  aria-label="Expand one level"
                >
                  <IconChevronDown size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Collapse +1 level" position="bottom">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={collapseOneLevel}
                  aria-label="Collapse one level"
                >
                  <IconChevronRight size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Expand all" position="bottom">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={expandAll}
                  aria-label="Expand all"
                >
                  <IconChevronsDown size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Collapse all" position="bottom">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={collapseAll}
                  aria-label="Collapse all"
                >
                  <IconChevronsRight size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
          <Text size="xs">
            {itemCountString},{' '}
            <span className={errorCount ? 'text-danger' : ''}>
              {errorCountString}
            </span>
          </Text>
          <Group gap="xs" align="center">
            <Text size="xs" c="dimmed">
              Show:
            </Text>
            <Group gap={4}>
              <Chip
                size="xs"
                color="gray"
                checked={showSpans}
                onChange={() => setShowSpans(!showSpans)}
                data-testid="show-spans-chip"
                styles={{
                  label: { paddingInline: 8, height: 22, minHeight: 22 },
                }}
              >
                Spans
              </Chip>
              {logTableSource && (
                <Chip
                  size="xs"
                  color="gray"
                  checked={showLogs}
                  onChange={() => setShowLogs(!showLogs)}
                  data-testid="show-logs-chip"
                  styles={{
                    label: { paddingInline: 8, height: 22, minHeight: 22 },
                  }}
                >
                  Logs
                </Chip>
              )}
              <Chip
                size="xs"
                color="gray"
                checked={showSpanEvents}
                onChange={() => setShowSpanEvents(!showSpanEvents)}
                disabled={!showSpans}
                data-testid="show-span-events-chip"
                styles={{
                  label: { paddingInline: 8, height: 22, minHeight: 22 },
                }}
              >
                Span events
              </Chip>
            </Group>
          </Group>
        </Group>
        <Group gap="sm">
          {controlsExtra}
          <span>
            <Anchor
              underline="always"
              onClick={() => setIsFilterExpanded(prev => !prev)}
              size="xs"
            >
              {isFilterExpanded ? 'Hide Filters' : 'Show Filters'}{' '}
              {isFilterActive && '(active)'}
            </Anchor>
            {isFilterActive && (
              <Anchor
                underline="always"
                onClick={onClearFilters}
                size="xs"
                ms="xs"
              >
                Clear Filters
              </Anchor>
            )}
          </span>
        </Group>
      </Group>
      {!isFetching && !error && highlightedAttributeValues?.length > 0 && (
        <DBHighlightedAttributesList attributes={highlightedAttributeValues} />
      )}
      <div
        ref={timelineWrapperRef}
        style={{
          position: 'relative',
          overflow: 'hidden',
          flex: 1,
        }}
      >
        {isFetching ? (
          <div className="my-3">Loading Traces...</div>
        ) : error ? (
          <Box mt="lg">
            <Text my="sm" size="sm">
              An error occurred while fetching trace data:
            </Text>
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
              }}
            >
              {error.message}
            </Code>
          </Box>
        ) : rows == null ? (
          <div>
            An unknown error occurred. <ContactSupportText />
          </div>
        ) : visibleNodes.length === 0 ? (
          flattenedNodes.length > 0 ? (
            <div className="my-3">All items are hidden by filters</div>
          ) : (
            (emptyState ?? (
              <div className="my-3">No matching spans or logs found</div>
            ))
          )
        ) : (
          <TimelineChart
            maxHeight={timelineWrapperHeight}
            rowHeight={22}
            labelWidth={300}
            onEventClick={event => {
              onClick?.({
                id: event.id,
                type: event.type ?? '',
                aliasWith: [],
              });
            }}
            rows={timelineRows}
            initialScrollRowIndex={initialScrollRowIndex}
            onReady={setViewportController}
          />
        )}
      </div>
    </>
  );
}
