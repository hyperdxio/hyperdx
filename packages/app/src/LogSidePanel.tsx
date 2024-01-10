import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import cx from 'classnames';
import { add, format, sub } from 'date-fns';
import Fuse from 'fuse.js';
import get from 'lodash/get';
import isPlainObject from 'lodash/isPlainObject';
import pickBy from 'lodash/pickBy';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import Button from 'react-bootstrap/Button';
import CopyToClipboard from 'react-copy-to-clipboard';
import { ErrorBoundary } from 'react-error-boundary';
import { useHotkeys } from 'react-hotkeys-hook';
import { JSONTree } from 'react-json-tree';
import Drawer from 'react-modern-drawer';
import { toast } from 'react-toastify';
import { StringParam, withDefault } from 'serialize-query-params';
import stripAnsi from 'strip-ansi';
import Timestamp from 'timestamp-nano';
import { useQueryParam } from 'use-query-params';
import {
  ActionIcon,
  Group,
  Menu,
  SegmentedControl,
  TextInput,
} from '@mantine/core';

import HyperJson, { GetLineActions, LineAction } from './components/HyperJson';
import { Table } from './components/Table';
import api from './api';
import {
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_FILESYSTEM_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
  K8S_NETWORK_NUMBER_FORMAT,
} from './ChartUtils';
import { K8S_METRICS_ENABLED } from './config';
import { CurlGenerator } from './curlGenerator';
import HDXLineChart from './HDXLineChart';
import LogLevel from './LogLevel';
import {
  breadcrumbColumns,
  CollapsibleSection,
  headerColumns,
  LogSidePanelKbdShortcuts,
  NetworkBody,
  networkColumns,
  SectionWrapper,
  stacktraceColumns,
  StacktraceValue,
  useShowMoreRows,
} from './LogSidePanelElements';
import SearchInput from './SearchInput';
import SessionSubpanel from './SessionSubpanel';
import TabBar from './TabBar';
import TimelineChart from './TimelineChart';
import { dateRangeToString } from './timeQuery';
import type { StacktraceBreadcrumb, StacktraceFrame } from './types';
import { Dictionary } from './types';
import {
  formatDistanceToNowStrictShort,
  useFirstNonNullValue,
  useLocalStorage,
  useWindowSize,
} from './utils';
import { useZIndex, ZIndexContext } from './zIndex';

import 'react-bootstrap-range-slider/dist/react-bootstrap-range-slider.css';
import 'react-modern-drawer/dist/index.css';
import styles from '../styles/LogSidePanel.module.scss';

const HDX_BODY_FIELD = '_hdx_body';

// https://github.com/reduxjs/redux-devtools/blob/f11383d294c1139081f119ef08aa1169bd2ad5ff/packages/react-json-tree/src/createStylingFromTheme.ts
const JSON_TREE_THEME = {
  base00: '#00000000',
  base01: '#383830',
  base02: '#49483e',
  base03: '#75715e',
  base04: '#a59f85',
  base05: '#f8f8f2',
  base06: '#f5f4f1',
  base07: '#f9f8f5',
  base08: '#f92672',
  base09: '#fd971f',
  base0A: '#f4bf75',
  base0B: '#a6e22e',
  base0C: '#a1efe4',
  base0D: '#8378FF', // Value Labels
  base0E: '#ae81ff',
  base0F: '#cc6633',
};

// Converts an ISO string timestmap with ns precision into a timestamp with
// lossless ns precision, but with base unit of 1 ms.
// It truncates the first 3 digits of a timestamp, (I think 115 days of range)
function isoToNsOffset(iso: string) {
  const ts = Timestamp.fromString(iso);
  return (ts.getTimeT() % 10000000) * 1000 + ts.getNano() / 1000000;
}

function useParsedLogProperties(logData: any): { [key: string]: any } {
  return useMemo(() => {
    if (logData == null) {
      return {};
    }
    const { span_id, trace_id, parent_span_id, span_name, duration } = logData;

    const addIfTruthy = (key: string, value: any) => {
      return value != null && value != '' ? { [key]: value } : {};
    };

    const mergedKvPairs = mergeKeyValuePairs(logData);

    return {
      // TODO: Users can't search on this via property search so we need to figure out a nice way to handle those search actions...
      ...mergedKvPairs,
      ...addIfTruthy('span_id', span_id),
      ...addIfTruthy('trace_id', trace_id),
      ...addIfTruthy('parent_span_id', parent_span_id),
      ...addIfTruthy('span_name', span_name),
      ...(duration >= 0 ? { duration } : {}), // duration is non-nullable, but can be negative meaning there is no duration
    };
  }, [logData]);
}

function useTraceSpans(
  {
    where,
    startDate,
    endDate,
    order,
    limit,
  }: {
    where: string;
    startDate: Date;
    endDate: Date;
    order: 'asc' | 'desc';
    limit: number;
  },
  {
    enabled = true,
  }: {
    enabled?: boolean;
  },
) {
  const { data: searchResultsPages, isFetching } = api.useLogBatch(
    {
      q: where,
      startDate,
      endDate,
      extraFields: [
        'end_timestamp',
        'parent_span_id',
        'rum_session_id',
        'span_id',
        'teamName',
        'trace_id',
        'userEmail',
        'userName',
      ],
      order,
      limit,
    },
    {
      enabled,
      refetchOnWindowFocus: false,
      getNextPageParam: (lastPage: any, allPages) => {
        if (lastPage.rows === 0) return undefined;
        return allPages.flatMap(page => page.data).length;
      },
    },
  );

  const data = useMemo(() => {
    return searchResultsPages?.pages
      .flatMap(page => page.data)
      .map(result => {
        return {
          ...result,
          startOffset: isoToNsOffset(result.timestamp),
          endOffset: isoToNsOffset(
            result.type === 'log' ? result.timestamp : result.end_timestamp,
          ),
        };
      })
      .sort((a, b) => parseInt(a.sort_key) - parseInt(b.sort_key));
  }, [searchResultsPages]);

  return {
    data,
    isFetching,
  };
}

function useTraceSpansAroundHighlight({
  where,
  dateRange,
  initialHighlightedResult,
  enabled,
}: {
  where: string;
  dateRange: [Date, Date];
  initialHighlightedResult:
    | {
        id: string;
        sortKey: string;
      }
    | undefined;
  enabled?: boolean;
}) {
  const hasHighlightedResult = initialHighlightedResult != null;
  const aboveSpanEndDate =
    initialHighlightedResult != null
      ? new Date(Number.parseInt(initialHighlightedResult.sortKey.slice(0, 13)))
      : dateRange[1] ?? new Date();

  const { data: aboveSpanData, isFetching: isAboveSpanFetching } =
    useTraceSpans(
      {
        where,
        startDate: dateRange?.[0] ?? new Date(),
        endDate: aboveSpanEndDate,
        order: 'desc',
        limit: 1500,
      },
      {
        enabled: enabled ?? true,
      },
    );

  const { data: belowSpanData, isFetching: isBelowSpanFetching } =
    useTraceSpans(
      {
        where,
        startDate: aboveSpanEndDate,
        endDate: dateRange?.[1] ?? new Date(),
        order: 'asc',
        limit: 1500,
      },
      {
        enabled: hasHighlightedResult,
      },
    );

  const results = useMemo(() => {
    return aboveSpanData != null && belowSpanData != null
      ? [...aboveSpanData, ...belowSpanData]
      : aboveSpanData != null && hasHighlightedResult === false
      ? aboveSpanData
      : [];
  }, [aboveSpanData, belowSpanData, hasHighlightedResult]);

  const isSearchResultsFetching = isAboveSpanFetching || isBelowSpanFetching;

  return {
    results,
    isFetching: isSearchResultsFetching,
  };
}

function TraceChart({
  config: { where, dateRange },
  onClick,
  highlightedResult,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
  };
  highlightedResult:
    | {
        id: string;
        sortKey: string;
      }
    | undefined;
  onClick: (logId: string, sortKey: string) => void;
}) {
  // When we change highlighted span due to navigation, we don't want to
  // reload everything, so we'll just use the first highlighted result as
  // our API call reference
  const initialHighlightedResult = useFirstNonNullValue(highlightedResult);
  const { results, isFetching: isSearchResultsFetching } =
    useTraceSpansAroundHighlight({
      where,
      dateRange,
      initialHighlightedResult,
    });

  // 3 Edge-cases
  // 1. No spans, just logs (ex. sampling)
  // 2. Spans, but with missing spans inbetween (ex. missing intermediary spans)
  // 3. Spans, with multiple root nodes (ex. somehow disjoint traces fe/be)

  const spanIds = useMemo(() => {
    return new Set(
      results
        ?.filter(result => result.type === 'span')
        .map(result => result.span_id) ?? [],
    );
  }, [results]);

  // Parse out a DAG of spans
  const rootNodes: any[] = [];
  const nodes: { [span_id: string]: any } = {};
  for (const result of results ?? []) {
    const curNode = {
      ...result,
      children: [],
      // In case we were created already previously, inherit the children built so far
      ...(result.type === 'span' ? nodes[result.span_id] : {}),
    };
    if (result.type === 'span') {
      nodes[result.span_id] = curNode;
    }

    if (
      result.type === 'span' &&
      // If there's no parent defined, or if the parent doesn't exist, we're a root
      (result.parent_span_id === '' || !spanIds.has(result.parent_span_id))
    ) {
      rootNodes.push(curNode);
    } else {
      // Otherwise, link the parent node to us
      const parent_span_id =
        result.type === 'span' ? result.parent_span_id : result.span_id;
      const parentNode = nodes[parent_span_id] ?? {
        children: [],
      };
      parentNode.children.push(curNode);
      nodes[parent_span_id] = parentNode;
    }
  }

  // flatten the rootnode dag into an array via in-order traversal
  const traverse = (node: any, arr: any[]) => {
    arr.push(node);
    node?.children?.forEach((child: any) => traverse(child, arr));
  };
  const flattenedNodes: any[] = [];
  if (rootNodes.length > 0) {
    rootNodes.forEach(rootNode => traverse(rootNode, flattenedNodes));
  }

  if (results != null && flattenedNodes.length < results.length) {
    console.error('Root nodes did not cover all events', rootNodes.length);
    flattenedNodes.length = 0;
    flattenedNodes.push(...(results ?? []));
  }

  const foundMinOffset =
    results?.reduce((acc, result) => {
      return Math.min(acc, result.startOffset);
    }, Number.MAX_SAFE_INTEGER) ?? 0;
  const minOffset =
    foundMinOffset === Number.MAX_SAFE_INTEGER ? 0 : foundMinOffset;
  const maxVal =
    results?.reduce((acc, result) => {
      return Math.max(acc, result.endOffset - minOffset);
    }, 0) ?? 0;

  const rows = flattenedNodes.map((result, i) => {
    const { startOffset, endOffset } = result;
    const tookMs = endOffset - startOffset;

    const isHighlighted = result.id === highlightedResult?.id;
    const isError = result.severity_text === 'error';

    return {
      id: result.id,
      label: (
        <div
          className={`${
            isHighlighted
              ? 'text-success'
              : isError
              ? 'text-danger'
              : 'text-muted-hover'
          } text-truncate cursor-pointer`}
          role="button"
          onClick={() => {
            onClick(result.id, result.sort_key);
          }}
        >
          {result._platform === 'sentry' ? (
            <i
              className="bi bi-bug text-gray-600 fs-8 me-2 align-middle"
              title="Correlated Exception"
            />
          ) : result.type === 'log' ? (
            <i
              className="bi bi-card-text text-gray-600 fs-8 me-2 align-middle"
              title="Correlated Log Line"
            />
          ) : null}
          {result.body}
        </div>
      ),
      style: {
        paddingTop: i === 0 ? 32 : 4,
        paddingBottom: 4,
      },
      events: [
        {
          id: result.id,
          start: startOffset - minOffset,
          end: endOffset - minOffset,
          tooltip: `${result.body} ${
            tookMs >= 0 ? `took ${tookMs.toFixed(4)}ms` : ''
          }`,
          color: isHighlighted ? '#50FA7B' : isError ? '#dc3545' : '#21262C',
          body: (
            <span
              className={cx({
                'text-dark': isHighlighted,
                'text-white': !isHighlighted,
              })}
            >
              {result.body}
            </span>
          ),
          minWidthPerc: 1,
        },
      ],
    };
  });
  const initialScrollRowIndex = flattenedNodes.findIndex(v => {
    return v.id === highlightedResult?.id;
  });

  return (
    <>
      {isSearchResultsFetching ? (
        <div className="my-3">Loading Traces...</div>
      ) : results == null ? (
        <div>An unknown error occured, please contact support.</div>
      ) : (
        <TimelineChart
          style={{
            overflowY: 'auto',
            maxHeight: 400,
          }}
          scale={1}
          setScale={() => {}}
          maxVal={maxVal + 10 /* Add 10ms padding */}
          // scale={scale}
          // setScale={setScale}
          // scaleWithScroll={scrollToZoom}
          // maxVal={maxVal}
          rowHeight={24}
          labelWidth={240}
          onClick={ts => {
            // onTimeClick(ts + startedAt);
          }}
          onEventClick={event => {
            const result = results?.find(result => result.id === event.id);
            onClick(event.id, result.sort_key);
          }}
          cursors={[]}
          rows={rows}
          initialScrollRowIndex={initialScrollRowIndex}
        />
      )}
    </>
  );
}

function isNetworkRequestSpan({ logData }: { logData: any }) {
  const spanKind =
    logData?.['string.values']?.[
      logData?.['string.names']?.indexOf('span.kind')
    ];
  return (
    !!logData?.['string.values']?.[
      logData?.['string.names']?.indexOf('http.url')
    ] &&
    (spanKind === 'client' || spanKind === 'server')
  );
}

function isExceptionSpan({ logData }: { logData: any }) {
  return (
    logData?._platform === 'sentry' &&
    Boolean(
      logData?.['string.values']?.[
        logData?.['string.names']?.indexOf('exception.values')
      ],
    )
  );
}

function TraceSubpanel({
  logData,
  onClose,
  onPropertyAddClick,
  generateChartUrl,
  generateSearchUrl,
  displayedColumns,
  toggleColumn,
}: {
  logData: any;
  onClose: () => void;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
  generateChartUrl: (config: {
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;

  onPropertyAddClick?: (name: string, value: string) => void;
  displayedColumns?: string[];
  toggleColumn?: (column: string) => void;
}) {
  const date = new Date(logData.timestamp);
  const start = add(date, { minutes: -240 });
  const end = add(date, { minutes: 240 });

  const [selectedLog, setSelectedLog] = useState<{
    id: string;
    sortKey: string;
  }>({
    id: logData.id,
    sortKey: logData.sort_key,
  });

  const { data: selectedLogDataRaw, isLoading } = api.useLogDetails(
    selectedLog.id,
    selectedLog.sortKey,
    {
      enabled: selectedLog.id != null,
    },
  );

  const selectedLogData = useMemo(
    () => selectedLogDataRaw?.data[0],
    [selectedLogDataRaw],
  );

  // Event Filter Input =========================
  const inputRef = useRef<HTMLInputElement>(null);
  const [_inputQuery, setInputQuery] = useState<string | undefined>(undefined);
  const inputQuery = _inputQuery ?? '';
  const [_searchedQuery, setSearchedQuery] = useQueryParam(
    'trace_q',
    withDefault(StringParam, undefined),
    {
      updateType: 'pushIn',
      // Workaround for qparams not being set properly: https://github.com/pbeshai/use-query-params/issues/233
      enableBatching: true,
    },
  );
  // Hacky way to set the input query when we search
  useEffect(() => {
    if (_searchedQuery != null && _inputQuery == null) {
      setInputQuery(_searchedQuery);
    }
  }, [_searchedQuery, _inputQuery]);
  // Allows us to determine if the user has changed the search query
  const searchedQuery = _searchedQuery ?? '';

  const exceptionBreadcrumbs = useMemo<StacktraceBreadcrumb[]>(() => {
    try {
      return JSON.parse(
        selectedLogData?.['string.values']?.[
          selectedLogData?.['string.names']?.indexOf('breadcrumbs')
        ] ?? '[]',
      );
    } catch (e) {
      return [];
    }
  }, [selectedLogData]);

  const exceptionValues = useMemo<any[]>(() => {
    try {
      return JSON.parse(
        selectedLogData?.['string.values']?.[
          selectedLogData?.['string.names']?.indexOf('exception.values')
        ] ?? '[]',
      );
    } catch (e) {
      return [];
    }
  }, [selectedLogData]);

  const isSelectedLogDataException = useMemo(
    () => isExceptionSpan({ logData: selectedLogData }),
    [selectedLogData],
  );

  // Clear search query when we close the panel
  // TODO: This doesn't work because it breaks navigation to things like the sessions page,
  // probably due to a race condition. Need to fix later.
  // useEffect(() => {
  //   return () => {
  //     setSearchedQuery(undefined, 'pushIn');
  //   };
  // }, [setSearchedQuery]);

  return (
    <>
      <form
        className="mb-1"
        style={{ zIndex: 100 }}
        onSubmit={e => {
          e.preventDefault();
          setSearchedQuery(inputQuery);
        }}
      >
        <SearchInput
          inputRef={inputRef}
          value={inputQuery}
          onChange={value => setInputQuery(value)}
          onSearch={() => {}}
          placeholder="Filter spans by name, property, etc..."
          showHotkey={false}
          size="sm"
        />
        <button
          type="submit"
          style={{
            width: 0,
            height: 0,
            border: 0,
            padding: 0,
          }}
        />
      </form>
      <TraceChart
        config={{
          where: `trace_id:"${logData.trace_id}" ${searchedQuery}`,
          dateRange: [start, end],
        }}
        highlightedResult={selectedLog}
        onClick={(id, sortKey) => {
          setSelectedLog({ id, sortKey });
        }}
      />

      <div className="border-top border-dark mb-4">
        {selectedLogData != null ? (
          <>
            <div className="my-3 text-break">
              <div className="text-slate-200 fs-7 mb-2 mt-3">
                {selectedLogData.type === 'span' ? 'Span' : 'Log'} Details
              </div>
              <span>
                [<LogLevel level={selectedLogData.severity_text} />]
              </span>{' '}
              {selectedLogData.body}{' '}
              {isoToNsOffset(selectedLogData.end_timestamp) > 0 && (
                <>
                  <span className="text-muted">took</span>{' '}
                  {(
                    isoToNsOffset(selectedLogData.end_timestamp) -
                    isoToNsOffset(selectedLogData.timestamp)
                  ).toFixed(4)}
                  ms{' '}
                </>
              )}
              <span className="text-muted">at</span>{' '}
              {format(
                new Date(selectedLogData.timestamp),
                'MMM d HH:mm:ss.SSS',
              )}
            </div>
            {isNetworkRequestSpan({ logData: selectedLogData }) && (
              <ErrorBoundary
                onError={err => {
                  console.error(err);
                }}
                fallbackRender={() => (
                  <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
                    An error occurred while rendering this network event.
                  </div>
                )}
              >
                <NetworkPropertySubpanel
                  logData={selectedLogData}
                  onPropertyAddClick={onPropertyAddClick}
                  generateSearchUrl={generateSearchUrl}
                  onClose={onClose}
                  generateChartUrl={generateChartUrl}
                />
              </ErrorBoundary>
            )}
            {isSelectedLogDataException && (
              <ErrorBoundary
                onError={err => {
                  console.error(err);
                }}
                fallbackRender={() => (
                  <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
                    An error occurred while rendering this exception event.
                  </div>
                )}
              >
                <ExceptionSubpanel
                  breadcrumbs={exceptionBreadcrumbs}
                  exceptionValues={exceptionValues}
                  logData={selectedLogData}
                />
              </ErrorBoundary>
            )}
            {!isSelectedLogDataException && (
              <ErrorBoundary
                onError={err => {
                  console.error(err);
                }}
                fallbackRender={() => (
                  <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
                    An error occurred while rendering event properties.
                  </div>
                )}
              >
                <PropertySubpanel
                  logData={selectedLogData}
                  onPropertyAddClick={onPropertyAddClick}
                  generateSearchUrl={generateSearchUrl}
                  onClose={onClose}
                  generateChartUrl={generateChartUrl}
                  displayedColumns={displayedColumns}
                  toggleColumn={toggleColumn}
                />
              </ErrorBoundary>
            )}
            <ErrorBoundary
              onError={err => {
                console.error(err);
              }}
              fallbackRender={() => (
                <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
                  An error occurred while rendering event tags.
                </div>
              )}
            >
              <EventTagSubpanel
                generateSearchUrl={generateSearchUrl}
                logData={selectedLogData}
                onPropertyAddClick={onPropertyAddClick}
              />
            </ErrorBoundary>
          </>
        ) : (
          <div className="m-3">Loading Span Details...</div>
        )}
      </div>
    </>
  );
}

// 🤮🤮🤮🤮🤮🤮🤮🤮
const mergeKeyValuePairs = (log: any) => {
  const output: any = {};
  for (const fieldType of ['string', 'number', 'bool']) {
    for (const [idx, key] of log[`${fieldType}.names`].entries()) {
      if (![HDX_BODY_FIELD].includes(key)) {
        output[key] = log[`${fieldType}.values`][idx];
      }
    }
  }
  return output;
};

function EventTag({
  displayedKey,
  name,
  value,
  onPropertyAddClick,
  generateSearchUrl,
}: {
  displayedKey?: string;
  name: string;
  value: string;
  onPropertyAddClick?: (key: string, value: string) => void;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
}) {
  return (
    <OverlayTrigger
      key={name}
      trigger="click"
      overlay={
        <Tooltip id={`tooltip`}>
          <span className="me-2" />
          {onPropertyAddClick != null ? (
            <Button
              className="p-0 fs-8 text-muted-hover child-hover-trigger me-2"
              variant="link"
              title="Add to search"
              onClick={() => {
                onPropertyAddClick(name, value);
              }}
            >
              <i className="bi bi-plus-circle" /> Add to Search
            </Button>
          ) : null}
          <span>
            <Link
              href={generateSearchUrl(
                `${name}:${typeof value === 'string' ? `"${value}"` : value}`,
              )}
              passHref
            >
              <Button
                className="fs-8 text-muted-hover child-hover-trigger py-0"
                variant="link"
                as="a"
                title="Search for this value only"
              >
                <i className="bi bi-search" /> Search This Value
              </Button>
            </Link>
          </span>
        </Tooltip>
      }
    >
      <div
        key={name}
        className="text-muted-hover bg-hdx-dark px-2 py-0.5 me-1 my-1 cursor-pointer"
      >
        {displayedKey || name}
        {': '}
        {value}
      </div>
    </OverlayTrigger>
  );
}

function EventTagSubpanel({
  generateSearchUrl,
  logData,
  onPropertyAddClick,
}: {
  logData: any;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
  onPropertyAddClick?: (key: string, value: string) => void;
}) {
  const properties = {
    service: logData._service,
    ...pickBy(mergeKeyValuePairs(logData), (value, key) => {
      return (
        key.startsWith('process.tag.') ||
        key.startsWith('otel.library.') ||
        // exception
        key.startsWith('contexts.os.') ||
        key.startsWith('contexts.runtime.') ||
        key.startsWith('contexts.device.') ||
        key.startsWith('contexts.app.')
      );
    }),
  };

  return (
    <div className="my-3">
      <div className="fw-bold mb-1 mt-2">Event Tags</div>
      <div className="d-flex flex-wrap">
        {Object.entries(properties).map(([key, value]) => {
          let commandArgs = '';
          if (key === 'process.tag.process.command_args') {
            try {
              commandArgs = JSON.parse(value).join(' ');
            } catch (e) {
              commandArgs = value;
            }
          }

          const shortKey = key
            .replace('process.tag.telemetry.', '')
            .replace('process.tag.', '')
            .replace('otel.library.', 'library.')
            .replace('process.pid', 'pid')
            .replace('contexts.', '');

          return (
            <EventTag
              key={key}
              onPropertyAddClick={onPropertyAddClick}
              generateSearchUrl={generateSearchUrl}
              displayedKey={shortKey}
              name={key}
              value={
                key === 'process.tag.process.command_args' ? commandArgs : value
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function ExceptionEvent({
  type,
  message,
  stacktrace,
}: {
  type?: string;
  message?: string;
  stacktrace?: string;
}) {
  const isMessageInStacktrace = stacktrace?.includes(message ?? '');

  return (
    <div className="my-3">
      <div className="fw-bold text-danger mb-1">{type}</div>
      {message != null && isMessageInStacktrace === false && (
        <div>{message}</div>
      )}
      {stacktrace != null && (
        <pre
          className="d-inline text-break text-muted"
          style={{
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
          }}
        >
          {stacktrace}
        </pre>
      )}
    </div>
  );
}

const parseHeaders = (
  keyPrefix: string,
  parsedProperties: any,
): [string, string][] => {
  const reqHeaderObj: Dictionary<string | string[] | Dictionary<string>> =
    pickBy(parsedProperties, (value, key) => key.startsWith(keyPrefix));

  return Object.entries(reqHeaderObj).flatMap(([fullKey, _value]) => {
    let value = _value;
    try {
      if (typeof _value === 'string') {
        value = JSON.parse(_value);
      }
    } catch (e) {
      // ignore
    }

    // Replacing _ -> - is part of the otel spec, idk why
    const key = fullKey.replace(keyPrefix, '').replace('_', '-');

    let keyVal = [[key, `${value}`]] as [string, string][];

    if (Array.isArray(value)) {
      keyVal = value.map(value => [key, `${value}`] as [string, string]);
    } else if (typeof value === 'object' && Object.keys(value).length > 0) {
      try {
        // TODO: We actually shouldn't be re-serializing this as it may mess with the original value
        keyVal = [[key, `${JSON.stringify(value)}`]] as [string, string][];
      } catch (e) {
        console.error(e);
      }
    }

    return keyVal;
  });
};

function generateEndpointTrendsDashboardUrl({
  url,
  spanKind,
}: {
  url: string;
  spanKind: string;
}) {
  const encodedConfig = JSON.stringify({
    id: '',
    name: 'Request Trend',
    charts: [
      {
        id: '312739',
        name: 'P95 Latency by Endpoint',
        x: 0,
        y: 2,
        w: 6,
        h: 2,
        series: [
          {
            type: 'time',
            aggFn: 'p95',
            field: 'duration',
            where: '',
            groupBy: ['http.route'],
          },
        ],
      },
      {
        id: '434437',
        name: 'HTTP Status Codes',
        x: 0,
        y: 0,
        w: 6,
        h: 2,
        series: [
          {
            type: 'time',
            aggFn: 'count',
            where: '',
            groupBy: ['http.status_code'],
          },
        ],
      },
      {
        id: '69137',
        name: 'HTTP 4xx, 5xx',
        x: 6,
        y: 2,
        w: 6,
        h: 2,
        series: [
          {
            type: 'time',
            aggFn: 'count',
            where: 'http.status_code:>=400',
            groupBy: ['http.status_code'],
          },
        ],
      },
      {
        id: '34708',
        name: 'HTTP 5xx by Endpoint',
        x: 6,
        y: 0,
        w: 6,
        h: 2,
        series: [
          {
            type: 'time',
            aggFn: 'count',
            where: 'http.status_code:>=500',
            groupBy: ['http.route'],
          },
        ],
      },
      {
        id: '58773',
        name: 'Request Volume by Endpoint',
        x: 0,
        y: 4,
        w: 6,
        h: 2,
        series: [
          {
            type: 'time',
            aggFn: 'count',
            where: '',
            groupBy: ['http.route'],
          },
        ],
      },
    ],
  });
  return `/dashboards?${new URLSearchParams({
    // TODO: Time range
    q: `http.url:${url.replace(/:/g, '\\:')} span.kind:${spanKind}`,
    config: encodedConfig,
  }).toString()}`;
}

function NetworkPropertySubpanel({
  logData,
  onPropertyAddClick,
  generateSearchUrl,
  onClose,
  generateChartUrl,
}: {
  logData: any;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
  onClose: () => void;
  generateChartUrl: (config: {
    table: string;
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;
  onPropertyAddClick?: (key: string, value: string) => void;
}) {
  const parsedProperties = useParsedLogProperties(logData);

  const requestHeaders = useMemo(() => {
    return parseHeaders('http.request.header.', parsedProperties);
  }, [parsedProperties]);

  const responseHeaders = useMemo(() => {
    return parseHeaders('http.response.header.', parsedProperties);
  }, [parsedProperties]);

  const url = parsedProperties['http.url'];
  const remoteAddress = parsedProperties['net.peer.ip'];
  const statusCode = parsedProperties['http.status_code'];
  const method = parsedProperties['http.method'];
  const spanKind = parsedProperties['span.kind'];
  const requestBody = parsedProperties['http.request.body'];
  const responseBody = parsedProperties['http.response.body'];

  const curl = CurlGenerator({
    method,
    headers: requestHeaders,
    url,
    body: requestBody,
  });

  const trendsDashboardUrl = generateEndpointTrendsDashboardUrl({
    url,
    spanKind,
  });

  return (
    <div>
      <div className="mb-3">
        <CopyToClipboard
          text={curl}
          onCopy={() => {
            toast.success('Curl command copied to clipboard');
          }}
        >
          <Button
            variant="dark"
            className="text-muted-hover fs-8 me-2"
            size="sm"
          >
            <i className="bi bi-terminal-plus me-2" />
            Copy Request as Curl
          </Button>
        </CopyToClipboard>
        <Link href={trendsDashboardUrl} passHref>
          <Button
            variant="dark"
            className="text-muted-hover fs-8"
            size="sm"
            as="a"
          >
            <i className="bi bi-graph-up me-2" />
            Endpoint Trends
          </Button>
        </Link>
      </div>

      <SectionWrapper>
        <Table
          borderless
          density="compact"
          columns={networkColumns}
          data={[
            url && { label: 'URL', value: url },
            method && { label: 'Method', value: method },
            remoteAddress && { label: 'Remote Address', value: remoteAddress },
            statusCode && {
              label: 'Status',
              value: `${statusCode} ${
                parsedProperties['http.status_text'] ?? ''
              }`,
              className:
                statusCode >= 500
                  ? 'text-danger'
                  : statusCode >= 400
                  ? 'text-warning'
                  : 'text-success',
            },
          ].filter(Boolean)}
          hideHeader
        />
      </SectionWrapper>

      {requestHeaders.length > 0 && (
        <CollapsibleSection
          title={`Request Headers (${requestHeaders.length})`}
          initiallyCollapsed
        >
          <SectionWrapper>
            <Table
              borderless
              hideHeader
              density="compact"
              columns={headerColumns}
              data={requestHeaders}
              emptyMessage="No request headers collected"
            />
          </SectionWrapper>
        </CollapsibleSection>
      )}

      {requestBody != null && (
        <CollapsibleSection title="Request Body">
          <SectionWrapper>
            <NetworkBody
              body={requestBody}
              theme={JSON_TREE_THEME}
              emptyMessage="Empty request"
              notCollectedMessage="No request body collected"
            />
          </SectionWrapper>
        </CollapsibleSection>
      )}
      {responseHeaders.length > 0 && (
        <CollapsibleSection
          title={`Response Headers (${responseHeaders.length})`}
          initiallyCollapsed
        >
          <SectionWrapper>
            <Table
              borderless
              hideHeader
              density="compact"
              columns={headerColumns}
              data={responseHeaders}
              emptyMessage="No response headers collected"
            />
          </SectionWrapper>
        </CollapsibleSection>
      )}
      {responseBody != null && (
        <CollapsibleSection title="Response Body">
          <SectionWrapper>
            <NetworkBody
              body={responseBody}
              theme={JSON_TREE_THEME}
              emptyMessage="Empty response"
              notCollectedMessage="No response body collected"
            />
          </SectionWrapper>
        </CollapsibleSection>
      )}
    </div>
  );
}

function PropertySubpanel({
  logData,
  onPropertyAddClick,
  generateSearchUrl,
  onClose,
  generateChartUrl,
  displayedColumns,
  toggleColumn,
}: {
  logData: any;
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
  onClose: () => void;
  generateChartUrl: (config: {
    table: string;
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;

  onPropertyAddClick?: (key: string, value: string) => void;
  displayedColumns?: string[];
  toggleColumn?: (column: string) => void;
}) {
  const router = useRouter();
  const [propertySearchValue, setPropertySearchValue] = useState('');
  const [isNestedView, setIsNestedView] = useLocalStorage(
    'propertySubPanelNestedView',
    false,
  );

  const parsedProperties = useParsedLogProperties(logData);
  // turn flattened key value object into a nested object with key paths separated by '.'
  const nestedProperties = useMemo(() => {
    const nestedProperties: Record<string, any> = {};
    for (const [key, value] of Object.entries(parsedProperties)) {
      const keyParts = key.split('.');
      let current = nestedProperties;
      for (let i = 0; i < keyParts.length; i++) {
        const keyPart = keyParts[i];
        // key conflicts
        // for example: [["lodash", "1.0.0"], ["lodash.emit", "1.0.0"]]
        if (!isPlainObject(current)) {
          break;
        }
        if (i === keyParts.length - 1) {
          current[keyPart] = value;
        } else {
          if (current[keyPart] == null) {
            current[keyPart] = {};
          }
          current = current[keyPart];
        }
      }
    }
    return nestedProperties;
  }, [parsedProperties]);

  const isNetworkReq = isNetworkRequestSpan({ logData });
  const displayedParsedProperties = pickBy(parsedProperties, (value, key) => {
    return (
      !key.startsWith('process.tag.') &&
      !key.startsWith('otel.library.') &&
      !(key.startsWith('http.request.header.') && isNetworkReq) &&
      !(key.startsWith('http.response.header.') && isNetworkReq) &&
      key != '__events' &&
      !(key == 'error' && value === 1) &&
      !(key == 'otel.status_code' && value === 'ERROR') &&
      !(key === 'http.response.body' && isNetworkReq) &&
      !(key === 'http.request.body' && isNetworkReq)
    );
  });

  // index parsedProperties into fuse with key value pairs
  const fuse = useMemo(() => {
    return new Fuse(
      Object.entries(displayedParsedProperties).map(([key, value]) => {
        return {
          key,
          value,
        };
      }),
      {
        keys: ['key', 'value'],
        threshold: 0,
        // minMatchCharLength: 2,
        ignoreLocation: true,
        distance: 120,
        shouldSort: false,
      },
    );
  }, [displayedParsedProperties]);

  const search = useCallback(
    (query: string) => {
      const tokens = query.trim().split(' ');
      return fuse.search({
        // @ts-ignore
        $and: tokens.map(token => {
          return {
            $or: [
              {
                key: token,
              },
              {
                value: token,
              },
            ],
          };
        }),
      });
    },
    [fuse],
  );

  const filteredProperties = useMemo(() => {
    if (propertySearchValue === '') {
      return displayedParsedProperties;
    }
    return search(propertySearchValue).reduce((acc, result) => {
      const { key, value } = result.item;
      acc[key] = value;
      return acc;
    }, {} as any);
  }, [displayedParsedProperties, propertySearchValue, search]);

  let events: any[] | undefined;
  if (parsedProperties?.__events) {
    try {
      events = JSON.parse(parsedProperties?.__events);
    } catch (e) {
      console.warn(e);
    }
  }

  const searchInputRef = useRef<HTMLInputElement>(null);

  const [jsonOptions, setJsonOptions] = useLocalStorage(
    'logviewer.jsonviewer.options',
    {
      normallyExpanded: true,
      tabulate: true,
      lineWrap: true,
      useLegacyViewer: false,
    },
  );

  const getLineActions = useCallback<GetLineActions>(
    ({ keyPath, value }) => {
      const actions: LineAction[] = [];

      if (onPropertyAddClick != null && typeof value !== 'object') {
        actions.push({
          key: 'add-to-search',
          label: <i className="bi bi-plus-circle" />,
          title: 'Add to Search',
          onClick: () => {
            onPropertyAddClick(`${keyPath.join('.')}`, value);
          },
        });
      }

      if (typeof value !== 'object') {
        actions.push({
          key: 'search',
          label: <i className="bi bi-search" />,
          title: 'Search for this value only',
          onClick: () => {
            router.push(
              generateSearchUrl(
                `${keyPath.join('.')}:${
                  typeof value === 'string' ? `"${value}"` : value
                }`,
              ),
            );
          },
        });
      }

      /* TODO: Handle bools properly (they show up as number...) */
      if (typeof value === 'number') {
        actions.push({
          key: 'chart',
          label: <i className="bi bi-graph-up" />,
          title: 'Chart',
          onClick: () => {
            router.push(
              generateChartUrl({
                aggFn: 'avg',
                field: `${keyPath.join('.')}`,
                groupBy: [],
                table: 'logs',
              }),
            );
          },
        });
      }

      if (toggleColumn && typeof value !== 'object') {
        const keyPathString = keyPath.join('.');
        actions.push({
          key: 'toggle-column',
          label: <i className="bi bi-table" />,
          title: displayedColumns?.includes(keyPathString)
            ? `Remove ${keyPathString} column from results table`
            : `Add ${keyPathString} column to results table`,
          onClick: () => toggleColumn(keyPathString),
        });
      }

      const handleCopyObject = () => {
        const shouldCopyParent = !isNestedView;
        const parentKeyPath = keyPath.slice(0, -1);
        const copiedObj = shouldCopyParent
          ? parentKeyPath.length === 0
            ? nestedProperties
            : get(nestedProperties, parentKeyPath)
          : keyPath.length === 0
          ? nestedProperties
          : get(nestedProperties, keyPath);
        window.navigator.clipboard.writeText(
          JSON.stringify(copiedObj, null, 2),
        );
        toast.success(
          `Copied ${shouldCopyParent ? 'parent' : 'object'} to clipboard`,
        );
      };

      if (typeof value === 'object') {
        actions.push(
          isNestedView
            ? {
                key: 'copy-object',
                label: 'Copy Object',
                onClick: handleCopyObject,
              }
            : {
                key: 'copy-parent',
                label: 'Copy Parent',
                onClick: handleCopyObject,
              },
        );
      } else {
        if (!isNestedView) {
          actions.push({
            key: 'copy-parent',
            label: 'Copy Parent',
            onClick: handleCopyObject,
          });
        }
        actions.push({
          key: 'copy-value',
          label: 'Copy Value',
          onClick: () => {
            window.navigator.clipboard.writeText(
              JSON.stringify(value, null, 2),
            );
            toast.success(`Value copied to clipboard`);
          },
        });
      }

      return actions;
    },
    [
      onPropertyAddClick,
      toggleColumn,
      isNestedView,
      router,
      generateSearchUrl,
      generateChartUrl,
      displayedColumns,
      nestedProperties,
    ],
  );

  return (
    <div>
      {events != null && events.length > 0 && (
        <>
          <div className="fw-bold fs-8 mt-4">Span Events</div>
          {events.map((event: any, i) => {
            const eventObj = event.fields.reduce(
              (acc: any, { key, value }: { key: string; value: string }) => {
                acc[key] = value;
                return acc;
              },
              {},
            );

            const isException = eventObj.event === 'exception';

            return (
              <div
                key={i}
                className={cx({
                  'd-flex align-items-center':
                    Object.keys(eventObj).length === 1,
                })}
              >
                <div className="text-muted mt-3 mb-1">
                  {isException && (
                    <span className="text-danger me-2">Exception</span>
                  )}
                  {format(
                    new Date(event.timestamp / 1000),
                    'MMM d HH:mm:ss.SSS',
                  )}
                </div>
                {isException ? (
                  <ExceptionEvent
                    type={eventObj['exception.type']}
                    message={eventObj['exception.message']}
                    stacktrace={eventObj['exception.stacktrace']}
                  />
                ) : (
                  <JSONTree
                    hideRoot
                    invertTheme={false}
                    shouldExpandNode={() => true}
                    data={eventObj}
                    theme={JSON_TREE_THEME}
                    valueRenderer={(raw, value, ...keyPath) => {
                      return (
                        <pre
                          className="d-inline text-break"
                          style={{
                            whiteSpace: 'pre-wrap',
                            wordWrap: 'break-word',
                          }}
                        >
                          {raw}
                        </pre>
                      );
                    }}
                  />
                )}
              </div>
            );
          })}
        </>
      )}

      <CollapsibleSection title="Properties" initiallyCollapsed={false}>
        <SectionWrapper>
          <div
            className="px-3 py-1"
            style={{
              borderBottom: '1px solid #21262C',
            }}
          >
            <Group align="center" position="apart">
              <SegmentedControl
                size="sm"
                data={[
                  {
                    label: 'Flat view',
                    value: 'flat',
                  },
                  {
                    label: 'Nested view',
                    value: 'nested',
                  },
                ]}
                value={isNestedView ? 'nested' : 'flat'}
                onChange={value => {
                  setIsNestedView(value === 'nested');
                }}
              />

              <Group position="right" spacing="xs" style={{ flex: 1 }}>
                {isNestedView === false && (
                  <TextInput
                    style={{ flex: 1 }}
                    maw={400}
                    ref={searchInputRef}
                    size="xs"
                    variant="filled"
                    type="text"
                    placeholder={'Search properties by key or value'}
                    value={propertySearchValue}
                    onChange={e => setPropertySearchValue(e.target.value)}
                    // autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Escape') {
                        searchInputRef.current?.blur();
                      }
                    }}
                  />
                )}
                <Menu width={240}>
                  <Menu.Target>
                    <ActionIcon size="md" variant="filled">
                      <i className="bi bi-gear" />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label lh={1} py={6}>
                      Properties view options
                    </Menu.Label>
                    <Menu.Item
                      disabled={jsonOptions.useLegacyViewer}
                      onClick={() =>
                        setJsonOptions({
                          ...jsonOptions,
                          normallyExpanded: !jsonOptions.normallyExpanded,
                        })
                      }
                      lh="1"
                      py={8}
                      rightSection={
                        jsonOptions.normallyExpanded ? (
                          <i className="ps-2 bi bi-check2" />
                        ) : null
                      }
                    >
                      Expand all properties
                    </Menu.Item>
                    <Menu.Item
                      disabled={jsonOptions.useLegacyViewer}
                      onClick={() =>
                        setJsonOptions({
                          ...jsonOptions,
                          lineWrap: !jsonOptions.lineWrap,
                        })
                      }
                      lh="1"
                      py={8}
                      rightSection={
                        jsonOptions.lineWrap ? (
                          <i className="ps-2 bi bi-check2" />
                        ) : null
                      }
                    >
                      Preserve line breaks
                    </Menu.Item>
                    <Menu.Item
                      lh="1"
                      py={8}
                      disabled={jsonOptions.useLegacyViewer}
                      rightSection={
                        jsonOptions.tabulate ? (
                          <i className="ps-2 bi bi-check2" />
                        ) : null
                      }
                      onClick={() =>
                        setJsonOptions({
                          ...jsonOptions,
                          tabulate: !jsonOptions.tabulate,
                        })
                      }
                    >
                      Tabulate
                    </Menu.Item>
                    <Menu.Item
                      lh="1"
                      py={8}
                      rightSection={
                        jsonOptions.useLegacyViewer ? (
                          <i className="ps-2 bi bi-check2" />
                        ) : null
                      }
                      onClick={() =>
                        setJsonOptions({
                          ...jsonOptions,
                          useLegacyViewer: !jsonOptions.useLegacyViewer,
                        })
                      }
                    >
                      Use legacy viewer
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
          </div>
          <div
            className="d-flex flex-wrap react-json-tree p-3"
            style={{ overflowX: 'hidden' }}
          >
            {/* TODO: Remove old viewer once it passes the test of time... */}
            {jsonOptions.useLegacyViewer ? (
              <JSONTree
                hideRoot={true}
                shouldExpandNode={() => true}
                data={isNestedView ? nestedProperties : filteredProperties}
                invertTheme={false}
                labelRenderer={keyPath => {
                  const shouldCopyParent = !isNestedView;

                  const [key] = keyPath;
                  const parsedKeyPath = isNestedView
                    ? keyPath
                        .slice()
                        .reverse()
                        .flatMap(key => {
                          return `${key}`.split('.');
                        })
                    : keyPath;

                  const parentKeyPath = parsedKeyPath.slice(0, -1);
                  const copiedObj = shouldCopyParent
                    ? parentKeyPath.length === 0
                      ? nestedProperties
                      : get(nestedProperties, parentKeyPath)
                    : parsedKeyPath.length === 0
                    ? nestedProperties
                    : get(nestedProperties, parsedKeyPath);

                  return (
                    <OverlayTrigger
                      trigger="click"
                      overlay={
                        <Tooltip id={`tooltip`}>
                          <CopyToClipboard
                            text={JSON.stringify(copiedObj, null, 2)}
                            onCopy={() => {
                              toast.success(
                                `${
                                  shouldCopyParent ? 'Parent object' : 'Object'
                                } copied to clipboard`,
                              );
                            }}
                          >
                            <Button
                              className="p-0 fs-8 text-muted-hover child-hover-trigger me-2"
                              variant="link"
                              title={`Copy ${
                                shouldCopyParent ? 'parent' : ''
                              } object`}
                            >
                              <i className="bi bi-clipboard" /> Copy{' '}
                              {shouldCopyParent ? 'Parent ' : ''}Object (
                              {(shouldCopyParent
                                ? parentKeyPath
                                : parsedKeyPath
                              ).join('.')}
                              )
                            </Button>
                          </CopyToClipboard>
                        </Tooltip>
                      }
                    >
                      <span className="cursor-pointer">{key}</span>
                    </OverlayTrigger>
                  );
                }}
                valueRenderer={(raw, value, ...rawKeyPath) => {
                  const keyPath = rawKeyPath.slice().reverse();
                  const keyPathString = keyPath.join('.');

                  return (
                    <div className="parent-hover-trigger d-inline-block px-2">
                      <pre
                        className="d-inline text-break"
                        style={{
                          whiteSpace: 'pre-wrap',
                          wordWrap: 'break-word',
                        }}
                      >
                        {raw}
                      </pre>
                      <span className="me-2" />
                      {onPropertyAddClick != null ? (
                        <Button
                          className="p-0 fs-8 text-muted-hover child-hover-trigger me-2"
                          variant="link"
                          title="Add to search"
                          onClick={() => {
                            onPropertyAddClick(`${keyPath.join('.')}`, value);
                          }}
                          style={{ width: 20 }}
                        >
                          <i className="bi bi-plus-circle" />
                        </Button>
                      ) : null}
                      {/* The styling here is a huge mess and I'm not sure why its not working */}
                      <Link
                        href={generateSearchUrl(
                          `${keyPath.join('.')}:${
                            typeof value === 'string' ? `"${value}"` : value
                          }`,
                        )}
                        passHref
                      >
                        <Button
                          className="fs-8 text-muted-hover child-hover-trigger p-0"
                          variant="link"
                          as="a"
                          title="Search for this value only"
                          style={{ width: 22 }}
                        >
                          <i className="bi bi-search" />
                        </Button>
                      </Link>
                      {/* TODO: Handle bools properly (they show up as number...) */}
                      {typeof value === 'number' ? (
                        <Link
                          href={generateChartUrl({
                            aggFn: 'avg',
                            field: `${keyPath.join('.')}`,
                            groupBy: [],
                            table: 'logs',
                          })}
                          passHref
                        >
                          <Button
                            className="fs-8 text-muted-hover child-hover-trigger p-0"
                            variant="link"
                            as="a"
                            title="Chart this value"
                            style={{ width: 20 }}
                          >
                            <i className="bi bi-graph-up" />
                          </Button>
                        </Link>
                      ) : null}

                      {!!toggleColumn && keyPath.length === 1 ? (
                        <Button
                          className="fs-8 text-muted-hover child-hover-trigger p-0"
                          variant="link"
                          as="a"
                          title={
                            displayedColumns?.includes(keyPathString)
                              ? `Remove ${keyPathString} column from results table`
                              : `Add ${keyPathString} column to results table`
                          }
                          style={{ width: 20 }}
                          onClick={() => toggleColumn(keyPathString)}
                        >
                          <i className="bi bi-table" />
                        </Button>
                      ) : null}

                      <CopyToClipboard
                        text={value}
                        onCopy={() => {
                          toast.success(`Value copied to clipboard`);
                        }}
                      >
                        <Button
                          className="fs-8 text-muted-hover child-hover-trigger p-0"
                          title="Copy value to clipboard"
                          variant="link"
                        >
                          <i className="bi bi-clipboard" />
                        </Button>
                      </CopyToClipboard>
                    </div>
                  );
                }}
                theme={JSON_TREE_THEME}
              />
            ) : (
              <HyperJson
                data={isNestedView ? nestedProperties : filteredProperties}
                normallyExpanded={jsonOptions.normallyExpanded}
                tabulate={jsonOptions.tabulate}
                lineWrap={jsonOptions.lineWrap}
                getLineActions={getLineActions}
              />
            )}
          </div>
        </SectionWrapper>
      </CollapsibleSection>
    </div>
  );
}

function useTraceProperties({
  traceId,
  dateRange,
  initialHighlightedResult,
  enabled,
}: {
  traceId: string;
  dateRange: [Date, Date];
  initialHighlightedResult:
    | {
        id: string;
        sortKey: string;
      }
    | undefined;
  enabled: boolean;
}) {
  const { results: spans, isFetching: isSpansFetching } =
    // This should use the trace panel cache
    useTraceSpansAroundHighlight({
      where: `trace_id:"${traceId}" `,
      dateRange,
      initialHighlightedResult,
      enabled,
    });

  const { userName, userEmail, teamName, sessionId } = useMemo(() => {
    let userName = '';
    let userEmail = '';
    let teamName = '';
    let sessionId: undefined | string;
    if (spans) {
      for (let i = 0; i < spans.length; i++) {
        const traceResult = spans[i];
        if (traceResult.userName) {
          userName = traceResult.userName;
        }
        if (traceResult.userEmail) {
          userEmail = traceResult.userEmail;
        }
        if (traceResult.teamName) {
          teamName = traceResult.teamName;
        }
        if (traceResult.rum_session_id) {
          sessionId = traceResult.rum_session_id;
        }
      }
    }

    return { userName, userEmail, teamName, sessionId };
  }, [spans]);

  return {
    userName,
    userEmail,
    teamName,
    sessionId,
  };
}

function SidePanelHeader({
  logData,
  onPropertyAddClick,
  generateSearchUrl,
  onClose,
}: {
  logData: any;
  onClose: VoidFunction;
  onPropertyAddClick?: (name: string, value: string) => void;
  generateSearchUrl: (
    query?: string,
    timeRange?: [Date, Date],
    lid?: string,
  ) => string;
}) {
  const parsedProperties = useParsedLogProperties(logData);

  const date = new Date(logData.timestamp);
  const start = add(date, { minutes: -240 });
  const end = add(date, { minutes: 240 });

  const traceId = logData.trace_id;

  const { userName, userEmail, teamName, sessionId } = useTraceProperties({
    traceId,
    dateRange: [start, end],
    initialHighlightedResult: {
      id: logData.id,
      sortKey: logData.sort_key,
    },
    enabled: !!traceId,
  });

  // TODO: use rum_session_id instead ?
  const rumSessionId: string | undefined =
    parsedProperties?.['rum.sessionId'] ??
    parsedProperties?.['process.tag.rum.sessionId'] ??
    sessionId;

  const headerEventTags = useMemo(() => {
    return [
      ['service', logData._service],
      ['host', logData._host],
      ['k8s.node.name', parsedProperties['k8s.node.name']],
      ['k8s.pod.name', parsedProperties['k8s.pod.name']],
      ['k8s.statefulset.name', parsedProperties['k8s.statefulset.name']],
      ['k8s.container.name', parsedProperties['k8s.container.name']],
      ['userEmail', userEmail],
      ['userName', userName],
      ['teamName', teamName],
    ].filter(([, value]) => !!value);
  }, [
    logData._host,
    logData._service,
    parsedProperties,
    teamName,
    userEmail,
    userName,
  ]);

  return (
    <div>
      <div className={styles.panelHeader}>
        <div>
          {logData.severity_text != null ? (
            <span className={styles.severityChip}>
              <LogLevel level={logData?.severity_text ?? ''} />
            </span>
          ) : null}
          {logData.took ? (
            <span className="me-2">
              <span className="text-muted">Took</span> {logData.took.toFixed(4)}
              ms
            </span>
          ) : null}
          <span className="me-2">
            <span className="text-muted">at</span>{' '}
            {format(new Date(logData.timestamp), 'MMM d HH:mm:ss.SSS')}{' '}
            <span className="text-muted">
              &middot;{' '}
              {formatDistanceToNowStrictShort(new Date(logData.timestamp))} ago
            </span>
          </span>
        </div>
        <div className="d-flex">
          {rumSessionId != null && (
            <div className="me-1">
              <Link
                href={`/sessions?${new URLSearchParams({
                  sid: rumSessionId,
                  sfrom: start.getTime().toString(),
                  sto: end.getTime().toString(),
                  ts: date.getTime().toString(),
                  q: `rum_session_id:"${rumSessionId}"`,
                  tq: dateRangeToString([start, end], false),
                  from: start.getTime().toString(),
                  to: end.getTime().toString(),
                }).toString()}`}
                passHref
              >
                <Button
                  variant="dark"
                  className="text-muted-hover fs-8"
                  size="sm"
                >
                  <i className="bi bi-tv me-2 fs-7.5" />
                  View Client Session
                </Button>
              </Link>
            </div>
          )}
          <CopyToClipboard
            text={window.location.href}
            onCopy={() => {
              toast.success('Copied link to clipboard');
            }}
          >
            <Button
              variant="dark"
              className="text-muted-hover mx-2 d-flex align-items-center fs-8"
              size="sm"
            >
              <i className="bi bi-link-45deg me-2 fs-7.5" />
              Share Event
            </Button>
          </CopyToClipboard>
          <Button
            variant="dark"
            className="text-muted-hover d-flex align-items-center"
            size="sm"
            onClick={onClose}
          >
            <i className="bi bi-x-lg" />
          </Button>
        </div>
      </div>
      <div className={styles.panelDetails}>
        <div>
          <div
            className="bg-hdx-dark p-3 overflow-auto"
            style={{ maxHeight: 300 }}
          >
            {stripAnsi(logData.body)}
          </div>
        </div>
        <div className="d-flex flex-wrap">
          {headerEventTags.map(([name, value]) => (
            <EventTag
              key={name}
              onPropertyAddClick={onPropertyAddClick}
              generateSearchUrl={generateSearchUrl}
              name={name}
              value={value}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const ExceptionSubpanel = ({
  logData,
  breadcrumbs,
  exceptionValues,
}: {
  logData?: any;
  breadcrumbs?: StacktraceBreadcrumb[];
  exceptionValues: {
    type: string;
    value: string;
    mechanism?: {
      type: string;
      handled: boolean;
      data?: {
        // TODO: Are these fields dynamic?
        function?: string;
        handler?: string;
        target?: string;
      };
    };
    stacktrace?: {
      frames: StacktraceFrame[];
    };
  }[];
}) => {
  const firstException = exceptionValues[0];

  const stacktraceFrames = useMemo(
    () => firstException.stacktrace?.frames.reverse() ?? [],
    [firstException.stacktrace?.frames],
  );

  const chronologicalBreadcrumbs = useMemo<StacktraceBreadcrumb[]>(() => {
    return [
      {
        category: 'exception',
        timestamp: new Date(logData?.timestamp ?? 0).getTime() / 1000,
        message: `${firstException.type}: ${firstException.value} `,
      },
      ...(breadcrumbs?.slice().reverse() ?? []),
    ];
  }, [
    breadcrumbs,
    firstException.type,
    firstException.value,
    logData?.timestamp,
  ]);

  const {
    handleToggleMoreRows: handleStacktraceToggleMoreRows,
    hiddenRowsCount: stacktraceHiddenRowsCount,
    visibleRows: stacktraceVisibleRows,
    isExpanded: stacktraceExpanded,
  } = useShowMoreRows({
    rows: stacktraceFrames,
  });

  const {
    handleToggleMoreRows: handleBreadcrumbToggleMoreRows,
    hiddenRowsCount: breadcrumbHiddenRowsCount,
    visibleRows: breadcrumbVisibleRows,
    isExpanded: breadcrumbExpanded,
  } = useShowMoreRows({
    rows: chronologicalBreadcrumbs,
  });

  // TODO: show all frames (stackable)
  return (
    <div>
      <CollapsibleSection title="Stack Trace">
        <SectionWrapper
          title={
            <>
              <div className="pb-3">
                <div className="fw-bold fs-8">{firstException.type}</div>
                <div className="text-muted">{firstException.value}</div>
              </div>
              <div className="d-flex gap-2 flex-wrap">
                <StacktraceValue
                  label="mechanism"
                  value={firstException.mechanism?.type}
                />
                <StacktraceValue
                  label="handled"
                  value={
                    firstException.mechanism?.handled ? (
                      <span className="text-success">true</span>
                    ) : (
                      <span className="text-danger">false</span>
                    )
                  }
                />
                {firstException.mechanism?.data?.function ? (
                  <StacktraceValue
                    label="function"
                    value={firstException.mechanism.data.function}
                  />
                ) : null}
                {firstException.mechanism?.data?.handler ? (
                  <StacktraceValue
                    label="handler"
                    value={firstException.mechanism.data.handler}
                  />
                ) : null}
                {firstException.mechanism?.data?.target ? (
                  <StacktraceValue
                    label="target"
                    value={firstException.mechanism.data.target}
                  />
                ) : null}
              </div>
            </>
          }
        >
          <Table
            hideHeader
            columns={stacktraceColumns}
            data={stacktraceVisibleRows}
            emptyMessage="No stack trace found"
          />

          {stacktraceHiddenRowsCount ? (
            <Button
              variant="dark"
              className="text-muted-hover fs-8 mx-4 mt-1 mb-3"
              size="sm"
              as="a"
              onClick={handleStacktraceToggleMoreRows}
            >
              {stacktraceExpanded ? (
                <>
                  <i className="bi bi-chevron-up me-2" /> Hide stack trace
                </>
              ) : (
                <>
                  <i className="bi bi-chevron-down me-2" />
                  Show {stacktraceHiddenRowsCount} more frames
                </>
              )}
            </Button>
          ) : null}
        </SectionWrapper>
      </CollapsibleSection>

      <CollapsibleSection title="Breadcrumbs">
        <SectionWrapper>
          <Table
            columns={breadcrumbColumns}
            data={breadcrumbVisibleRows}
            emptyMessage="No breadcrumbs found"
          />
          {breadcrumbHiddenRowsCount ? (
            <Button
              variant="dark"
              className="text-muted-hover fs-8 mx-4 mt-1 mb-3"
              size="sm"
              as="a"
              onClick={handleBreadcrumbToggleMoreRows}
            >
              {breadcrumbExpanded ? (
                <>
                  <i className="bi bi-chevron-up me-2" /> Hide breadcrumbs
                </>
              ) : (
                <>
                  <i className="bi bi-chevron-down me-2" />
                  Show {breadcrumbHiddenRowsCount} more breadcrumbs
                </>
              )}
            </Button>
          ) : null}
        </SectionWrapper>
      </CollapsibleSection>
    </div>
  );
};
import { Card, SimpleGrid, Stack } from '@mantine/core';

import { convertDateRangeToGranularityString, Granularity } from './ChartUtils';

const MetricsSubpanelGroup = ({
  timestamp,
  where,
  fieldPrefix,
  title,
}: {
  timestamp: any;
  where: string;
  fieldPrefix: string;
  title: string;
}) => {
  const [range, setRange] = useState<'30m' | '1h' | '1d'>('30m');
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>('sm');

  const dateRange = useMemo<[Date, Date]>(() => {
    const duration = {
      '30m': { minutes: 15 },
      '1h': { minutes: 30 },
      '1d': { hours: 12 },
    }[range];
    return [
      sub(new Date(timestamp), duration),
      add(new Date(timestamp), duration),
    ];
  }, [timestamp, range]);

  const { cols, height } = useMemo(() => {
    switch (size) {
      case 'sm':
        return { cols: 3, height: 200 };
      case 'md':
        return { cols: 2, height: 250 };
      case 'lg':
        return { cols: 1, height: 320 };
    }
  }, [size]);

  const granularity = useMemo<Granularity>(() => {
    return convertDateRangeToGranularityString(dateRange, 60);
  }, [dateRange]);

  return (
    <div>
      <Group position="apart" align="center">
        <Group align="center">
          <h4 className="text-slate-300 fs-6 m-0">{title}</h4>
          <SegmentedControl
            bg="dark.7"
            color="dark.5"
            size="xs"
            data={[
              { label: '30m', value: '30m' },
              { label: '1h', value: '1h' },
              { label: '1d', value: '1d' },
            ]}
            value={range}
            onChange={value => setRange(value as any)}
          />
        </Group>
        <Group align="center">
          <SegmentedControl
            bg="dark.7"
            color="dark.5"
            size="xs"
            data={[
              { label: 'SM', value: 'sm' },
              { label: 'MD', value: 'md' },
              { label: 'LG', value: 'lg' },
            ]}
            value={size}
            onChange={value => setSize(value as any)}
          />
        </Group>
      </Group>
      <SimpleGrid mt="md" cols={cols}>
        <Card p="md">
          <Card.Section p="md" py="xs" withBorder>
            CPU Usage (%)
          </Card.Section>
          <Card.Section py={8} px={4} h={height}>
            <HDXLineChart
              config={{
                dateRange,
                granularity,
                where,
                groupBy: '',
                aggFn: 'avg',
                field: `${fieldPrefix}cpu.utilization - Gauge`,
                table: 'metrics',
                numberFormat: K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
              }}
              logReferenceTimestamp={timestamp / 1000}
            />
          </Card.Section>
        </Card>
        <Card p="md">
          <Card.Section p="md" py="xs" withBorder>
            Memory Used
          </Card.Section>
          <Card.Section py={8} px={4} h={height}>
            <HDXLineChart
              config={{
                dateRange,
                granularity,
                where,
                groupBy: '',
                aggFn: 'avg',
                field: `${fieldPrefix}memory.usage - Gauge`,
                table: 'metrics',
                numberFormat: K8S_MEM_NUMBER_FORMAT,
              }}
              logReferenceTimestamp={timestamp / 1000}
            />
          </Card.Section>
        </Card>
        <Card p="md">
          <Card.Section p="md" py="xs" withBorder>
            Disk Available
          </Card.Section>
          <Card.Section py={8} px={4} h={height}>
            <HDXLineChart
              config={{
                dateRange,
                granularity,
                where,
                groupBy: '',
                aggFn: 'avg',
                field: `${fieldPrefix}filesystem.available - Gauge`,
                table: 'metrics',
                numberFormat: K8S_FILESYSTEM_NUMBER_FORMAT,
              }}
              logReferenceTimestamp={timestamp / 1000}
            />
          </Card.Section>
        </Card>
      </SimpleGrid>
    </div>
  );
};

const MetricsSubpanel = ({ logData }: { logData?: any }) => {
  const podUid = useMemo(() => {
    return (
      logData?.['string.values']?.[
        logData?.['string.names']?.indexOf('k8s.pod.uid')
      ] ??
      logData?.['string.values']?.[
        logData?.['string.names']?.indexOf('process.tag.k8s.pod.uid')
      ]
    );
  }, [logData]);

  const nodeName = useMemo(() => {
    return (
      logData?.['string.values']?.[
        logData?.['string.names']?.indexOf('k8s.node.name')
      ] ??
      logData?.['string.values']?.[
        logData?.['string.names']?.indexOf('process.tag.k8s.node.name')
      ]
    );
  }, [logData]);

  const timestamp = new Date(logData?.timestamp).getTime();

  return (
    <Stack my="md" spacing={40}>
      {podUid && (
        <MetricsSubpanelGroup
          title="Pod Metrics"
          where={`k8s.pod.uid:"${podUid}"`}
          fieldPrefix="k8s.pod."
          timestamp={timestamp}
        />
      )}
      {nodeName && (
        <MetricsSubpanelGroup
          title="Node Metrics"
          where={`k8s.node.name:"${nodeName}"`}
          fieldPrefix="k8s.node."
          timestamp={timestamp}
        />
      )}
    </Stack>
  );
};

const checkKeyExistsInLogData = (key: string, logData: any) => {
  return logData?.['string.values']?.[logData?.['string.names']?.indexOf(key)];
};

export default function LogSidePanel({
  logId,
  onClose,
  onPropertyAddClick,
  generateSearchUrl,
  generateChartUrl,
  sortKey,
  isNestedPanel = false,
  displayedColumns,
  toggleColumn,
}: {
  logId: string | undefined;
  onClose: () => void;
  onPropertyAddClick?: (name: string, value: string) => void;
  generateSearchUrl: (
    query?: string,
    timeRange?: [Date, Date],
    lid?: string,
  ) => string;
  generateChartUrl: (config: {
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;
  sortKey: string | undefined;
  isNestedPanel?: boolean;
  displayedColumns?: string[];
  toggleColumn?: (column: string) => void;
}) {
  const contextZIndex = useZIndex();

  const { data: logDataRaw, isLoading } = api.useLogDetails(
    logId ?? '',
    sortKey ?? '-1',
    {
      enabled: logId != null,
    },
  );

  const [stateTab, setStateTab] = useState<
    'parsed' | 'original' | 'debug' | 'trace' | 'context' | 'replay' | undefined
  >(undefined);
  const [queryTab, setQueryTab] = useQueryParam(
    'tb',
    withDefault(StringParam, undefined),
    {
      updateType: 'pushIn',
      // Workaround for qparams not being set properly: https://github.com/pbeshai/use-query-params/issues/233
      enableBatching: true,
    },
  );
  // Nested panels can't share the query param or else they'll conflict, so we'll use local state for nested panels
  // We'll need to handle this properly eventually...
  const tab = isNestedPanel ? stateTab : queryTab;
  const setTab = isNestedPanel ? setStateTab : setQueryTab;

  const _onClose = useCallback(() => {
    // Reset tab to undefined when unmounting, so that when we open the drawer again, it doesn't open to the last tab
    // (which might not be valid, ex session replay)
    if (!isNestedPanel) {
      setQueryTab(undefined);
    }
    onClose();
  }, [setQueryTab, isNestedPanel, onClose]);

  const logData = useMemo(() => logDataRaw?.data[0], [logDataRaw]);

  const isException = useMemo(() => isExceptionSpan({ logData }), [logData]);

  const displayedTab =
    tab ?? (logData?.type === 'span' || isException ? 'trace' : 'parsed');

  // Keep track of sub-drawers so we can disable closing this root drawer
  const [subDrawerOpen, setSubDrawerOpen] = useState(false);

  useHotkeys(
    ['esc'],
    () => {
      _onClose();
    },
    {
      enabled: subDrawerOpen === false,
    },
  );

  const date = new Date(logData?.timestamp);
  const start = logData != null ? add(date, { minutes: -240 }) : new Date();
  const end = logData != null ? add(date, { minutes: 240 }) : new Date();

  const traceId = logData?.trace_id;

  const { sessionId } = useTraceProperties({
    traceId,
    dateRange: [start, end],
    initialHighlightedResult:
      logData != undefined
        ? {
            id: logData.id,
            sortKey: logData.sort_key,
          }
        : undefined,
    enabled: !!traceId,
  });

  // TODO: use rum_session_id instead ?
  const rumSessionId: string | undefined =
    checkKeyExistsInLogData('rum.sessionId', logData) ??
    checkKeyExistsInLogData('process.tag.rum.sessionId', logData) ??
    sessionId;

  const { width } = useWindowSize();
  const isSmallScreen = (width ?? 1000) < 900;

  const drawerZIndex = contextZIndex + 1;

  const hasK8sContext = useMemo(() => {
    return (
      checkKeyExistsInLogData('k8s.pod.uid', logData) != null ||
      checkKeyExistsInLogData('k8s.node.name', logData) != null ||
      checkKeyExistsInLogData('process.tag.k8s.pod.uid', logData) != null ||
      checkKeyExistsInLogData('process.tag.k8s.node.name', logData) != null
    );
  }, [logData]);

  return (
    <Drawer
      enableOverlay
      overlayOpacity={0.1}
      customIdSuffix={`log-side-panel-${logId}`}
      duration={0}
      open={logId != null}
      onClose={() => {
        if (!subDrawerOpen) {
          _onClose();
        }
      }}
      direction="right"
      size={displayedTab === 'replay' || isSmallScreen ? '80vw' : '60vw'}
      zIndex={drawerZIndex}
      // enableOverlay={subDrawerOpen}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel}>
          {isLoading && <div className={styles.loadingState}>Loading...</div>}
          {logData != null && !isLoading ? (
            <>
              <SidePanelHeader
                logData={logData}
                onPropertyAddClick={onPropertyAddClick}
                generateSearchUrl={generateSearchUrl}
                onClose={_onClose}
              />
              <TabBar
                className="fs-8 mt-2"
                items={[
                  {
                    text: 'Parsed Properties',
                    value: 'parsed',
                  },
                  ...(logData.trace_id != ''
                    ? ([
                        {
                          text: 'Trace',
                          value: 'trace',
                        },
                      ] as const)
                    : []),
                  {
                    text: 'Original Line',
                    value: 'original',
                  },
                  // {
                  //   text: 'Surrounding Context',
                  //   value: 'context',
                  // },
                  // {
                  //   text: 'Debug',
                  //   value: 'debug',
                  // },
                  ...(rumSessionId != null
                    ? ([
                        {
                          text: 'Session Replay',
                          value: 'replay',
                        },
                      ] as const)
                    : []),
                  ...(K8S_METRICS_ENABLED && hasK8sContext
                    ? ([
                        {
                          text: 'Metrics',
                          value: 'metrics',
                        },
                      ] as const)
                    : []),
                ]}
                activeItem={displayedTab}
                onClick={(v: any) => setTab(v)}
              />
              <ErrorBoundary
                onError={err => {
                  console.error(err);
                }}
                fallbackRender={() => (
                  <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
                    An error occurred while rendering this event.
                  </div>
                )}
              >
                {/* Parsed Properties */}
                {displayedTab === 'parsed' ? (
                  <div className="flex-grow-1 px-4 bg-body overflow-auto">
                    <PropertySubpanel
                      logData={logData}
                      onPropertyAddClick={onPropertyAddClick}
                      generateSearchUrl={generateSearchUrl}
                      generateChartUrl={generateChartUrl}
                      onClose={_onClose}
                      displayedColumns={displayedColumns}
                      toggleColumn={toggleColumn}
                    />
                    <EventTagSubpanel
                      logData={logData}
                      onPropertyAddClick={onPropertyAddClick}
                      generateSearchUrl={generateSearchUrl}
                    />
                  </div>
                ) : null}

                {/* Original Line */}
                {displayedTab === 'original' ? (
                  <div
                    className="flex-grow-1 px-4 overflow-auto"
                    style={{ minHeight: 0 }}
                  >
                    <div className="my-2">
                      <code>{logData._source}</code>
                    </div>
                  </div>
                ) : null}

                {/* Trace */}
                {displayedTab === 'trace' ? (
                  <div
                    className="flex-grow-1 px-4 pt-3 bg-body overflow-auto"
                    style={{ minHeight: 0 }}
                  >
                    <TraceSubpanel
                      logData={logData}
                      onPropertyAddClick={onPropertyAddClick}
                      generateSearchUrl={generateSearchUrl}
                      generateChartUrl={generateChartUrl}
                      onClose={_onClose}
                      displayedColumns={displayedColumns}
                      toggleColumn={toggleColumn}
                    />
                  </div>
                ) : null}

                {/* Debug */}
                {displayedTab === 'debug' ? (
                  <div className="px-4 overflow-auto">
                    <code>
                      <pre>{JSON.stringify(logData, undefined, 4)}</pre>
                    </code>
                  </div>
                ) : null}

                {/* Session Replay */}
                {displayedTab === 'replay' ? (
                  <div className="px-4 overflow-hidden flex-grow-1">
                    {rumSessionId != null ? (
                      <SessionSubpanel
                        start={start}
                        end={end}
                        rumSessionId={rumSessionId}
                        onPropertyAddClick={onPropertyAddClick}
                        generateSearchUrl={generateSearchUrl}
                        generateChartUrl={generateChartUrl}
                        setDrawerOpen={setSubDrawerOpen}
                        initialTs={new Date(logData.timestamp).getTime()}
                      />
                    ) : (
                      <span className="p-3 text-muted">
                        Session ID not found.
                      </span>
                    )}
                  </div>
                ) : null}

                {/* Metrics */}
                {displayedTab === 'metrics' ? (
                  <div className="px-4 overflow-auto">
                    <MetricsSubpanel logData={logData} />
                  </div>
                ) : null}
              </ErrorBoundary>
              <LogSidePanelKbdShortcuts />
            </>
          ) : null}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
