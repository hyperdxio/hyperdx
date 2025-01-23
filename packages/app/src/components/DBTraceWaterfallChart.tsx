import { useCallback, useMemo, useState } from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
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
  HyperDXEventType: 'span';
};
function useSpansAroundFocus({
  traceTableModel,
  focusDate,
  dateRange,
  traceId,
}: {
  traceTableModel: TSource;
  focusDate: Date;
  dateRange: [Date, Date];
  traceId: string;
}) {
  // Needed to reverse map alias to valueExpr for useRowWhere
  const aliasMap = useMemo(
    () => ({
      Body: getSpanEventBody(traceTableModel) ?? '',
      Timestamp: getDisplayedTimestampValueExpression(traceTableModel),
      Duration: getDurationSecondsExpression(traceTableModel),
      SpanId: traceTableModel.spanIdExpression ?? '',
      ParentSpanId: traceTableModel.parentSpanIdExpression ?? '',
      StatusCode: traceTableModel.statusCodeExpression,
      ServiceName: traceTableModel.serviceNameExpression,
    }),
    [traceTableModel],
  );

  const config = useMemo(
    () => ({
      select: [
        {
          valueExpression: aliasMap.Body,
          alias: 'Body',
        },
        {
          valueExpression: aliasMap.Timestamp,
          alias: 'Timestamp',
        },
        {
          // in Seconds, f64 holds ns precision for durations up to ~3 months
          valueExpression: aliasMap.Duration,
          alias: 'Duration',
        },
        {
          valueExpression: aliasMap.SpanId,
          alias: 'SpanId',
        },
        {
          valueExpression: aliasMap.ParentSpanId,
          alias: 'ParentSpanId',
        },
        ...(aliasMap.StatusCode
          ? [
              {
                valueExpression: aliasMap.StatusCode,
                alias: 'StatusCode',
              },
            ]
          : []),
        ...(aliasMap.ServiceName
          ? [
              {
                valueExpression: aliasMap.ServiceName,
                alias: 'ServiceName',
              },
            ]
          : []),
      ],
      from: traceTableModel.from,
      timestampValueExpression: traceTableModel.timestampValueExpression,
      where: `${traceTableModel.traceIdExpression} = '${traceId}'`,
      limit: { limit: 10000 },
      connection: traceTableModel.connection,
    }),
    [traceTableModel, traceId, aliasMap],
  );

  const { data: beforeSpanData, isFetching: isBeforeSpanFetching } =
    useOffsetPaginatedQuery(
      useMemo(
        () => ({
          ...config,
          dateRange: [dateRange[0], focusDate],
          orderBy: [
            {
              valueExpression: traceTableModel.timestampValueExpression,
              ordering: 'ASC',
            },
          ],
        }),
        [
          config,
          focusDate,
          dateRange,
          traceTableModel.timestampValueExpression,
        ],
      ),
    );

  const { data: afterSpanData, isFetching: isAfterSpanFetching } =
    useOffsetPaginatedQuery(
      useMemo(
        () => ({
          ...config,
          dateRange: [focusDate, dateRange[1]],
          dateRangeStartInclusive: false,
          orderBy: [
            {
              valueExpression: traceTableModel.timestampValueExpression,
              ordering: 'ASC',
            },
          ],
        }),
        [
          config,
          focusDate,
          dateRange,
          traceTableModel.timestampValueExpression,
        ],
      ),
    );

  const data = useMemo(() => {
    return {
      meta: beforeSpanData?.meta ?? afterSpanData?.meta,
      data: [
        ...(beforeSpanData?.data ?? []),
        ...(afterSpanData?.data ?? []),
      ].map(d => {
        d.HyperDXEventType = 'span';
        return d;
      }) as SpanRow[],
    }; // TODO: Type useOffsetPaginatedQuery instead
  }, [afterSpanData, beforeSpanData]);

  const isSearchResultsFetching = isBeforeSpanFetching || isAfterSpanFetching;

  return {
    data,
    isFetching: isSearchResultsFetching,
    aliasMap,
  };
}

// TODO: Optimize with ts lookup tables
export function DBTraceWaterfallChartContainer({
  traceTableModel,
  traceId,
  dateRange,
  focusDate,
  onClick,
  highlightedRowWhere,
}: {
  traceTableModel: TSource;
  traceId: string;
  dateRange: [Date, Date];
  focusDate: Date;
  onClick?: (rowWhere: string) => void;
  highlightedRowWhere?: string | null;
}) {
  const { data, isFetching, aliasMap } = useSpansAroundFocus({
    traceTableModel,
    focusDate,
    dateRange,
    traceId,
  });

  const rowWhere = useRowWhere({ meta: data?.meta, aliasMap });

  const rows = useMemo(
    () =>
      data?.meta != null && data.meta.length > 0 // Sometimes meta has not loaded yet
        ? data?.data?.map(row => {
            return {
              ...row,
              id: rowWhere(omit(row, ['HyperDXEventType'])),
            };
          })
        : undefined,
    [data, rowWhere],
  );

  // 3 Edge-cases
  // 1. No spans, just logs (ex. sampling)
  // 2. Spans, but with missing spans inbetween (ex. missing intermediary spans)
  // 3. Spans, with multiple root nodes (ex. somehow disjoint traces fe/be)

  const spanIds = useMemo(() => {
    return new Set(
      rows
        ?.filter(result => result.HyperDXEventType === 'span')
        .map(result => result.SpanId) ?? [],
    );
  }, [rows]);

  // Parse out a DAG of spans
  type Node = SpanRow & { id: string; children: SpanRow[] };
  const rootNodes: Node[] = [];
  const nodes: { [SpanId: string]: any } = {};
  for (const result of rows ?? []) {
    const curNode = {
      ...result,
      children: [],
      // In case we were created already previously, inherit the children built so far
      ...(result.HyperDXEventType === 'span' ? nodes[result.SpanId] : {}),
    };
    if (result.HyperDXEventType === 'span') {
      nodes[result.SpanId] = curNode;
    }

    if (
      result.HyperDXEventType === 'span' &&
      // If there's no parent defined, or if the parent doesn't exist, we're a root
      (result.ParentSpanId === '' || !spanIds.has(result.ParentSpanId))
    ) {
      rootNodes.push(curNode);
    } else {
      // Otherwise, link the parent node to us
      const ParentSpanId =
        result.HyperDXEventType === 'span'
          ? result.ParentSpanId
          : result.SpanId;
      const parentNode = nodes[ParentSpanId] ?? {
        children: [],
      };
      parentNode.children.push(curNode);
      nodes[ParentSpanId] = parentNode;
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
    const tookMs = result.Duration * 1000;
    const startOffset = new Date(result.Timestamp).getTime();
    const start = startOffset - minOffset;
    const end = start + tookMs;

    const body = result.Body;
    const serviceName = result.ServiceName;

    const id = result.id;

    const isHighlighted = highlightedRowWhere === id;

    // TODO: Legacy schemas will have STATUS_CODE_ERROR
    // See: https://github.com/open-telemetry/opentelemetry-collector-contrib/pull/34799/files#diff-1ec84547ed93f2c8bfb21c371ca0b5304f01371e748d4b02bf397313a4b1dfa4L197
    const isError = result.StatusCode == 'Error';

    return {
      id,
      label: (
        <div
          className={`${isError && 'text-danger'} ${
            isHighlighted && styles.traceTimelineLabelHighlighted
          } text-truncate cursor-pointer ps-2 ${styles.traceTimelineLabel}`}
          role="button"
          onClick={() => {
            onClick?.(id);
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
          color: isError
            ? isHighlighted
              ? '#FF6E6E'
              : '#f53749'
            : isHighlighted
              ? '#A9AFB7'
              : '#6a7077',
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
            onClick?.(event.id);
          }}
          cursors={[]}
          rows={timelineRows}
          initialScrollRowIndex={initialScrollRowIndex}
        />
      )}
    </>
  );
}
