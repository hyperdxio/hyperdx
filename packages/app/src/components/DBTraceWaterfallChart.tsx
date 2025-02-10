import { useCallback, useMemo, useState } from 'react';
import TimestampNano from 'timestamp-nano';
import {
  ChartConfigWithDateRange,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';

import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import useRowWhere from '@/hooks/useRowWhere';
import {
  getDisplayedTimestampValueExpression,
  getDurationSecondsExpression,
  getSpanEventBody,
} from '@/source';
import TimelineChart from '@/TimelineChart';
import { omit } from '@/utils';

import styles from '@/../styles/LogSidePanel.module.scss';

type SpanRow = {
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
  if (isError) return isHighlighted ? '#FF6E6E' : '#F53749';
  if (isWarn) return isHighlighted ? '#FFE38A' : '#FFC107';
  return isHighlighted ? '#A9AFB7' : '#6A7077';
}

function getTableBody(tableModel: TSource) {
  if (tableModel?.kind === SourceKind.Trace) {
    return getSpanEventBody(tableModel) ?? '';
  } else if (tableModel?.kind === SourceKind.Log) {
    return tableModel.implicitColumnExpression ?? '';
  } else {
    return '';
  }
}

function getFetchConfig(source: TSource, traceId: string) {
  const alias = {
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
  };
  let selectOption: {
    valueExpression: string;
    alias: string;
  }[] = [];

  if (source.kind === SourceKind.Trace) {
    selectOption = [
      {
        valueExpression: alias.Body,
        alias: 'Body',
      },
      {
        valueExpression: alias.Timestamp,
        alias: 'Timestamp',
      },
      {
        // in Seconds, f64 holds ns precision for durations up to ~3 months
        valueExpression: alias.Duration,
        alias: 'Duration',
      },
      {
        valueExpression: alias.SpanId,
        alias: 'SpanId',
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
      ...(alias.ServiceName
        ? [
            {
              valueExpression: alias.ServiceName,
              alias: 'ServiceName',
            },
          ]
        : []),
    ];
  } else if (source.kind === SourceKind.Log) {
    selectOption = [
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
      ...(alias.SeverityText
        ? [
            {
              valueExpression: alias.SeverityText,
              alias: 'SeverityText',
            },
          ]
        : []),
      ...(alias.ServiceName
        ? [
            {
              valueExpression: alias.ServiceName,
              alias: 'ServiceName',
            },
          ]
        : []),
    ];
  }
  const config = {
    select: selectOption,
    from: source.from,
    timestampValueExpression: alias.Timestamp,
    where: `${alias.TraceId} = '${traceId}'`,
    limit: { limit: 10000 },
    connection: source.connection,
  };
  return { config, alias, type: source.kind };
}

function useFetchingData({
  config,
  dateRangeStartInclusive,
  dateRange,
}: {
  config: {
    select: {
      valueExpression: string;
      alias: string;
    }[];
    from: {
      databaseName: string;
      tableName: string;
    };
    timestampValueExpression: string;
    where: string;
    limit: {
      limit: number;
    };
    connection: string;
  };
  dateRangeStartInclusive: boolean;
  dateRange: [Date, Date];
}) {
  const query: ChartConfigWithDateRange = useMemo(() => {
    return {
      ...config,
      dateRange,
      dateRangeStartInclusive,
      orderBy: [
        {
          valueExpression: config.timestampValueExpression,
          ordering: 'ASC',
        },
      ],
    };
  }, [config, dateRange]);
  return useOffsetPaginatedQuery(query);
}

function useSpansAroundFocus({
  tableModel,
  focusDate,
  dateRange,
  traceId,
}: {
  tableModel: TSource;
  focusDate: Date;
  dateRange: [Date, Date];
  traceId: string;
}) {
  let isFetching = false;
  const { config, alias, type } = useMemo(
    () => getFetchConfig(tableModel, traceId),
    [tableModel, traceId],
  );

  const { data: beforeSpanData, isFetching: isBeforeSpanFetching } =
    useFetchingData({
      config,
      dateRangeStartInclusive: true,
      dateRange: [dateRange[0], focusDate],
    });
  const { data: afterSpanData, isFetching: isAfterSpanFetching } =
    useFetchingData({
      config,
      dateRangeStartInclusive: false,
      dateRange: [focusDate, dateRange[1]],
    });
  isFetching = isFetching || isBeforeSpanFetching || isAfterSpanFetching;
  const meta = beforeSpanData?.meta ?? afterSpanData?.meta;
  const rowWhere = useRowWhere({ meta, aliasMap: alias });
  const rows = useMemo(() => {
    // Sometimes meta has not loaded yet
    // DO NOT REMOVE, useRowWhere will error if no meta
    if (!meta || meta.length === 0) return [];
    const concatData = [
      ...(beforeSpanData?.data ?? []),
      ...(afterSpanData?.data ?? []),
    ].map(d => {
      d.HyperDXEventType = 'span';
      return d;
    }) as SpanRow[];
    return concatData.map((cd: SpanRow) => ({
      ...cd,
      id: rowWhere(omit(cd, ['HyperDXEventType'])),
      type,
    }));
  }, [afterSpanData, beforeSpanData]);

  return {
    rows,
    isFetching,
  };
}

// TODO: Optimize with ts lookup tables
export function DBTraceWaterfallChartContainer({
  traceTableModel,
  logTableModel,
  traceId,
  dateRange,
  focusDate,
  onClick,
  highlightedRowWhere,
}: {
  traceTableModel: TSource;
  logTableModel?: TSource;
  traceId: string;
  dateRange: [Date, Date];
  focusDate: Date;
  onClick?: (rowWhere: { id: string; type: string }) => void;
  highlightedRowWhere?: string | null;
}) {
  const { rows: traceRowsData, isFetching: traceIsFetching } =
    useSpansAroundFocus({
      tableModel: traceTableModel,
      focusDate,
      dateRange,
      traceId,
    });
  const { rows: logRowsData, isFetching: logIsFetching } = useSpansAroundFocus({
    // search data if logTableModel exist
    // search invliad date range if no logTableModel(react hook need execute no matter what)
    tableModel: logTableModel || traceTableModel,
    focusDate,
    dateRange: logTableModel ? dateRange : [dateRange[1], dateRange[0]],
    traceId,
  });

  const isFetching = traceIsFetching || logIsFetching;
  const rows = [...traceRowsData, ...logRowsData];

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

  // 3 Edge-cases
  // 1. No spans, just logs (ex. sampling)
  // 2. Spans, but with missing spans inbetween (ex. missing intermediary spans)
  // 3. Spans, with multiple root nodes (ex. somehow disjoint traces fe/be)

  // Parse out a DAG of spans
  type Node = SpanRow & { id: string; parentId: string; children: SpanRow[] };
  const rootNodes: Node[] = [];
  const parentSpanIdsMap = new Map();
  const nodesMap = new Map();
  for (const { ParentSpanId, SpanId } of rows ?? []) {
    if (ParentSpanId && SpanId) parentSpanIdsMap.set(SpanId, ParentSpanId);
  }
  let logSpanCount = -1;
  for (const result of rows ?? []) {
    const { type, HyperDXEventType, SpanId } = result;
    // ignore everything without spanId
    if (!SpanId) continue;
    if (type === SourceKind.Log) logSpanCount += 1;

    // log have dupelicate span id, tag it with -log-couunt
    const nodeSpanId =
      type === SourceKind.Log ? `${SpanId}-log-${logSpanCount}` : SpanId;
    const nodeParentSpanId =
      type === SourceKind.Log ? SpanId : parentSpanIdsMap.get(SpanId) || '';

    const curNode = {
      ...result,
      children: [],
      // In case we were created already previously, inherit the children built so far
      ...(result.HyperDXEventType === 'span' ? nodesMap.get(nodeSpanId) : {}),
    };
    if (!nodesMap.has(nodeSpanId)) {
      nodesMap.set(nodeSpanId, curNode);
    }

    const isRootNode =
      HyperDXEventType !== 'span' || type === SourceKind.Log
        ? // not root if type is log or not span
          false
        : // become root if does not have parent
          !nodeParentSpanId
          ? true
          : false;

    if (isRootNode) {
      rootNodes.push(curNode);
    } else {
      const parentNode = nodesMap.get(nodeParentSpanId) ?? {
        children: [],
      };
      parentNode.children.push(curNode);
      nodesMap.set(nodeParentSpanId, parentNode);
    }
  }

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

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
    arr.push({
      level,
      ...node,
    });
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

  // TODO: Add duration filter?
  // TODO: Add backend filters for duration and collapsing?

  // if (rows != null && flattenedNodes.length < rows.length) {
  //   console.error('Root nodes did not cover all events', rootNodes.length);
  //   flattenedNodes.length = 0;
  //   flattenedNodes.push(
  //     ...(rows?.map(data => ({ ...data, children: [] })) ?? []),
  //   );
  // }

  // All units in ms!
  const foundMinOffset =
    rows?.reduce((acc, result) => {
      return Math.min(acc, new Date(result.Timestamp).getTime());
    }, Number.MAX_SAFE_INTEGER) ?? 0;
  const minOffset =
    foundMinOffset === Number.MAX_SAFE_INTEGER ? 0 : foundMinOffset;

  // console.log(highlightedRowWhere);
  // console.log('f', flattenedNodes, collapsedIds);

  const timelineRows = flattenedNodes.map((result, i) => {
    const tookMs = (result.Duration || 0) * 1000;
    const startOffset = new Date(result.Timestamp).getTime();
    const start = startOffset - minOffset;
    const end = start + tookMs;

    const body = result.Body;
    const serviceName = result.ServiceName;
    const type = result.type;

    const id = result.id;

    const isHighlighted = highlightedRowWhere === id;

    // TODO: Legacy schemas will have STATUS_CODE_ERROR
    // See: https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/34799/files#diff-1ec84547ed93f2c8bfb21c371ca0b5304f01371e748d4b02bf397313a4b1dfa4L197
    const isError =
      result.StatusCode == 'Error' || result.SeverityText === 'error';
    const isWarn = result.SeverityText === 'warn';

    return {
      id,
      type,
      label: (
        <div
          className={`${textColor({ isError, isWarn })} ${
            isHighlighted && styles.traceTimelineLabelHighlighted
          } text-truncate cursor-pointer ps-2 ${styles.traceTimelineLabel}`}
          role="button"
          onClick={() => {
            onClick?.({ id, type: type ?? '' });
          }}
        >
          <div className="d-flex">
            {Array.from({ length: result.level }).map((_, index) => (
              <div
                key={index}
                style={{
                  borderLeft: '1px solid var(--mantine-color-dark-4)',
                  marginLeft: 5,
                  width: 8,
                  minWidth: 8,
                  maxWidth: 8,
                  flexGrow: 1,
                }}
              ></div>
            ))}
            <Text
              c="dark.2"
              span
              me="xxs"
              style={{
                opacity: result.children.length > 0 ? 1 : 0,
              }}
              onClick={() => {
                toggleCollapse(id);
              }}
            >
              <i
                className={`bi bi-chevron-${
                  collapsedIds.has(id) ? 'right' : 'down'
                }`}
              />{' '}
            </Text>
            <Text span size="xxs" c="dark.2" me="xs" pt="2px">
              {result.children.length > 0 ? `(${result.children.length})` : ''}
            </Text>
            <Text
              size="xxs"
              truncate="end"
              // style={{ width: 200 }}
              span
              title={serviceName}
              // onClick={() => {
              //   toggleCollapse(id);
              // }}
              role="button"
            >
              {type === SourceKind.Log ? (
                <i
                  className="bi bi-card-text fs-8 me-2 align-middle"
                  title="Correlated Log Line"
                />
              ) : null}
              {serviceName ? `${serviceName} | ` : ''}
              {body}
            </Text>
          </div>
        </div>
      ),
      style: {
        // paddingTop: 1,
        marginTop: i === 0 ? 32 : 0,
        backgroundColor: isHighlighted ? '#202127' : undefined,
      },
      events: [
        {
          id,
          start,
          end,
          tooltip: `${body} ${
            tookMs >= 0 ? `took ${tookMs.toFixed(4)}ms` : ''
          }`,
          color: barColor({ isError, isWarn, isHighlighted }),
          body: <span style={{ color: '#FFFFFFEE' }}>{body}</span>,
          minWidthPerc: 1,
        },
      ],
    };
  });
  // TODO: Highlighting support
  const initialScrollRowIndex = flattenedNodes.findIndex(v => {
    return v.id === highlightedRowWhere;
  });

  return (
    <>
      {isFetching ? (
        <div className="my-3">Loading Traces...</div>
      ) : rows == null ? (
        <div>An unknown error occurred, please contact support.</div>
      ) : (
        <TimelineChart
          style={{
            overflowY: 'auto',
            maxHeight: 400,
          }}
          scale={1}
          setScale={() => {}}
          rowHeight={22}
          labelWidth={300}
          onClick={ts => {
            // onTimeClick(ts + startedAt);
          }}
          onEventClick={event => {
            onClick?.({ id: event.id, type: event.type ?? '' });
          }}
          cursors={[]}
          rows={timelineRows}
          initialScrollRowIndex={initialScrollRowIndex}
        />
      )}
    </>
  );
}
