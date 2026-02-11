import { useCallback, useEffect, useMemo, useState } from 'react';
import _, { omit } from 'lodash';
import { useForm } from 'react-hook-form';
import TimestampNano from 'timestamp-nano';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  ChartConfig,
  ChartConfigWithDateRange,
  SelectList,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Box,
  Center,
  Checkbox,
  Code,
  Divider,
  Group,
  Text,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconLogs,
} from '@tabler/icons-react';

import { ContactSupportText } from '@/components/ContactSupportText';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import useResizable from '@/hooks/useResizable';
import useRowWhere, { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import useWaterfallSearchState from '@/hooks/useWaterfallSearchState';
import SearchInputV2 from '@/SearchInputV2';
import {
  getDisplayedTimestampValueExpression,
  getDurationSecondsExpression,
  getEventBody,
  getSpanEventBody,
} from '@/source';
import TimelineChart from '@/TimelineChart';
import { useFormatTime } from '@/useFormatTime';
import {
  getChartColorError,
  getChartColorErrorHighlight,
  getChartColorWarning,
  getChartColorWarningHighlight,
} from '@/utils';
import {
  getHighlightedAttributesFromData,
  getSelectExpressionsForHighlightedAttributes,
} from '@/utils/highlightedAttributes';

import { DBHighlightedAttributesList } from './DBHighlightedAttributesList';

import styles from '@/../styles/LogSidePanel.module.scss';
import resizeStyles from '@/../styles/ResizablePanel.module.scss';

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

function textColor(condition: { isError: boolean; isWarn: boolean }): string {
  const { isError, isWarn } = condition;
  if (isError) return 'text-danger';
  if (isWarn) return 'text-warning';
  return '';
}

function barColor(condition: {
  isError: boolean;
  isWarn: boolean;
  isHighlighted: boolean;
}) {
  const { isError, isWarn, isHighlighted } = condition;
  if (isError)
    return isHighlighted ? getChartColorErrorHighlight() : getChartColorError();
  if (isWarn)
    return isHighlighted
      ? getChartColorWarningHighlight()
      : getChartColorWarning();
  return isHighlighted ? '#A9AFB7' : '#6A7077';
}

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
  source: TSource,
  traceId: string,
  hiddenRowExpression?: string,
) {
  const alias: Record<string, string> = {
    Body: getTableBody(source),
    Timestamp: getDisplayedTimestampValueExpression(source),
    Duration: source.durationExpression
      ? getDurationSecondsExpression(source)
      : '',
    TraceId: source.traceIdExpression ?? '',
    SpanId: source.spanIdExpression ?? '',
    ParentSpanId: source.parentSpanIdExpression ?? '',
    StatusCode: source.statusCodeExpression ?? '',
    ServiceName: source.serviceNameExpression ?? '',
    SeverityText: source.severityTextExpression ?? '',
    SpanAttributes: source.eventAttributesExpression ?? '',
    SpanEvents: source.spanEventsValueExpression ?? '',
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
            valueExpressionLanguage: 'lucene' as const,
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
    where: `${alias.TraceId} = '${traceId}'`,
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
}: {
  tableSource: TSource;
  focusDate: Date;
  dateRange: [Date, Date];
  traceId: string;
  enabled: boolean;
  /** A lucene expression that identifies rows to be hidden. Hidden rows will be returned with a `__hdx_hidden: true` column. */
  hiddenRowExpression?: string;
}) {
  const { config, alias, type } = useMemo(
    () => getConfig(tableSource, traceId, hiddenRowExpression),
    [tableSource, traceId, hiddenRowExpression],
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
}: {
  traceTableSource: TSource;
  logTableSource: TSource | null;
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
}) {
  const { size, startResize } = useResizable(30, 'bottom');
  const formatTime = useFormatTime();

  const {
    traceWhere,
    logWhere,
    clear: clearFilters,
    isFilterActive,
    isFilterExpanded,
    setIsFilterExpanded,
    onSubmit: onSubmitFilters,
  } = useWaterfallSearchState({
    hasLogSource: !!logTableSource,
  });

  const { control, handleSubmit, setValue } = useForm({
    defaultValues: {
      traceWhere: traceWhere ?? '',
      logWhere: logWhere ?? '',
    },
  });

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
    enabled: logTableSource ? true : false, // disable fire query if logSource is not exist
  });

  const isFetching = traceIsFetching || logIsFetching;
  const error = traceError || logError;

  const rows: any[] = useMemo(
    () => [...traceRowsData, ...logRowsData],
    [traceRowsData, logRowsData],
  );

  rows.sort((a, b) => {
    const aDate = TimestampNano.fromString(a.Timestamp);
    const bDate = TimestampNano.fromString(b.Timestamp);
    const secDiff = aDate.getTimeT() - bDate.getTimeT();
    if (secDiff === 0) {
      return aDate.getNano() - bDate.getNano();
    } else {
      return secDiff;
    }
  });

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

  useEffect(() => {
    if (initialRowHighlightHint && onClick && highlightedRowWhere == null) {
      const initialRowHighlightIndex = rows.findIndex(row => {
        return (
          row.Timestamp === initialRowHighlightHint.timestamp &&
          row.SpanId === initialRowHighlightHint.spanId &&
          row.Body === initialRowHighlightHint.body
        );
      });

      if (initialRowHighlightIndex !== -1) {
        onClick?.({
          id: rows[initialRowHighlightIndex].id,
          type: rows[initialRowHighlightIndex].type ?? '',
          aliasWith: rows[initialRowHighlightIndex].aliasWith,
        });
      }
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

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [showSpanEvents, setShowSpanEvents] = useState(true);

  const toggleCollapse = useCallback(
    (id: string) => {
      setCollapsedIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        return newSet;
      });
    },
    [setCollapsedIds],
  );

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

  const spanCount = flattenedNodes.length;
  const errorCount = flattenedNodes.filter(
    node =>
      node.StatusCode === 'Error' ||
      node.SeverityText?.toLowerCase() === 'error',
  ).length;

  const spanCountString = `${spanCount} span${spanCount !== 1 ? 's' : ''}`;
  const errorCountString = `${errorCount} error${errorCount !== 1 ? 's' : ''}`;

  // TODO: Add duration filter?
  // TODO: Add backend filters for duration and collapsing?

  // All units in ms!
  const foundMinOffset =
    rows?.reduce((acc, result) => {
      return Math.min(acc, new Date(result.Timestamp).getTime());
    }, Number.MAX_SAFE_INTEGER) ?? 0;
  const minOffset =
    foundMinOffset === Number.MAX_SAFE_INTEGER ? 0 : foundMinOffset;

  const timelineRows = flattenedNodes.map((result, i) => {
    const tookMs = (result.Duration || 0) * 1000;
    const startOffset = new Date(result.Timestamp).getTime();
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
      console.warn("DBTraceWaterfallChart: Couldn't JSON stringify Body", e);
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
            timestamp: new Date(spanEvent.Timestamp).getTime() - minOffset,
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

    return {
      id,
      type,
      aliasWith,
      label: (
        <div
          className={`${textColor({ isError, isWarn })} ${
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
              onClick={() => {
                toggleCollapse(id);
              }}
            >
              {collapsedIds.has(id) ? (
                <IconChevronRight size={16} className="me-1 text-muted-hover" />
              ) : (
                <IconChevronDown size={16} className="me-1 text-muted-hover" />
              )}{' '}
            </Center>
            {!isFilterActive && (
              <Text span size="xxs" me="xs" pt="2px">
                {result.children.length > 0
                  ? `(${result.children.length})`
                  : ''}
              </Text>
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
                // style={{ width: 200 }}
                span
                // onClick={() => {
                //   toggleCollapse(id);
                // }}
                title={`${serviceName}${hasHttpAttributes && httpUrl ? ` | ${displayText}` : ''}`}
                role="button"
              >
                {serviceName ? `${serviceName} | ` : ''}
                {displayText}
              </Text>
            </Group>
          </div>
        </div>
      ),
      style: {
        // paddingTop: 1,
        marginTop: i === 0 ? 32 : 0,
      },
      isActive: isHighlighted,
      events: [
        {
          id,
          type,
          aliasWith,
          start,
          end,
          tooltip: `${displayText} ${tookMs >= 0 ? `took ${tookMs.toFixed(4)}ms` : ''} ${status ? `| Status: ${status}` : ''}${!isNaN(startOffset) ? ` | Started at ${formatTime(new Date(startOffset), { format: 'withMs' })}` : ''}`,
          color: barColor({ isError, isWarn, isHighlighted }),
          body: <span>{displayText}</span>,
          minWidthPerc: 1,
          isError,
          markers,
        },
      ],
    };
  });
  // TODO: Highlighting support
  const initialScrollRowIndex = flattenedNodes.findIndex(v => {
    return v.id === highlightedRowWhere;
  });

  const heightPx = (size / 100) * window.innerHeight;

  return (
    <>
      {isFilterExpanded && (
        <form onSubmit={handleSubmit(onSubmitFilters)}>
          <Box
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <Text size="xs">Spans filter</Text>
            <SearchInputV2
              tableConnection={tcFromSource(traceTableSource)}
              placeholder={
                'Search trace spans w/ Lucene ex. StatusCode:"Error"'
              }
              language="lucene"
              name="traceWhere"
              control={control}
              size="xs"
              onSubmit={handleSubmit(onSubmitFilters)}
              data-testid="trace-search-input"
            />

            {logTableSource && (
              <>
                <Text size="xs">Logs filter</Text>
                <SearchInputV2
                  tableConnection={tcFromSource(logTableSource)}
                  placeholder={
                    'Search trace logs w/ Lucene ex. SeverityText:"error"'
                  }
                  language="lucene"
                  name="logWhere"
                  control={control}
                  size="xs"
                  onSubmit={handleSubmit(onSubmitFilters)}
                  data-testid="log-search-input"
                />
              </>
            )}
          </Box>
        </form>
      )}
      <Group my="xs" justify="space-between">
        <Group gap="md">
          <Text size="xs">
            {spanCountString},{' '}
            <span className={errorCount ? 'text-danger' : ''}>
              {errorCountString}
            </span>
          </Text>
          <Checkbox
            size="xs"
            label="Show span events"
            checked={showSpanEvents}
            onChange={() => setShowSpanEvents(!showSpanEvents)}
          />
        </Group>
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
      {!isFetching && !error && (
        <DBHighlightedAttributesList attributes={highlightedAttributeValues} />
      )}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          maxHeight: `${heightPx}px`,
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
        ) : flattenedNodes.length === 0 ? (
          <div className="my-3">No matching spans or logs found</div>
        ) : (
          <>
            <TimelineChart
              style={{
                overflowY: 'auto',
                maxHeight: `${heightPx}px`,
              }}
              scale={1}
              setScale={() => {}}
              rowHeight={22}
              labelWidth={300}
              onClick={ts => {
                // onTimeClick(ts + startedAt);
              }}
              onEventClick={(event: {
                id: string;
                type?: string;
                aliasWith?: WithClause[];
              }) => {
                onClick?.({
                  id: event.id,
                  type: event.type ?? '',
                  aliasWith: event.aliasWith ?? [],
                });
              }}
              cursors={[]}
              rows={timelineRows}
              initialScrollRowIndex={initialScrollRowIndex}
            />
          </>
        )}
      </div>
      <Divider
        mt="md"
        className={resizeStyles.resizeYHandle}
        onMouseDown={startResize}
        style={{ position: 'relative', bottom: 0 }}
      />
    </>
  );
}
