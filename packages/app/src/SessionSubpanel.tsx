import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import throttle from 'lodash/throttle';
import { parseAsInteger, useQueryState } from 'nuqs';
import ReactDOM from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';

import DOMPlayer from './DOMPlayer';
import LogSidePanel from './LogSidePanel';
import Playbar from './Playbar';
import SearchInput from './SearchInput';
import { useSessionEvents } from './sessionUtils';
import TabBar from './TabBar';
import { FormatTime } from './useFormatTime';
import { getShortUrl, usePrevious } from './utils';

function SessionEventList({
  config: { where, dateRange },
  onClick,
  onTimeClick,
  focus,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
  };
  // highlightedResultId: string | undefined;
  focus: { ts: number; setBy: string } | undefined;
  onClick: (logId: string, sortKey: string) => void;
  onTimeClick: (ts: number) => void;
}) {
  const { events, isFetching: isSessionEventsFetching } = useSessionEvents({
    config: { where, dateRange },
  });

  const rows = useMemo(() => {
    return (
      events?.map((event, i) => {
        const { startOffset, endOffset } = event;
        const tookMs = endOffset - startOffset;

        const isHighlighted = false;

        const url = event['http.url'];
        const statusCode = event['http.status_code'];
        const method = event['http.method'];
        const shortUrl = getShortUrl(url);

        const isNetworkRequest =
          method != '' && method != null && url != null && url != '';

        const errorMessage = event['error.message'];

        const body = event['body'];
        const component = event['component'];
        const spanName = event['span_name'];
        const locationHref = event['location.href'];
        const otelLibraryName = event['otel.library.name'];
        const shortLocationHref = getShortUrl(locationHref);

        const isCustomEvent = otelLibraryName === 'custom-action';
        const isNavigation =
          spanName === 'routeChange' || spanName === 'documentLoad';

        const isError = event.severity_text === 'error' || statusCode > 499;

        const isSuccess = !isError && statusCode < 400 && statusCode > 99;

        return {
          id: event.id,
          sortKey: event.sort_key,
          isError,
          isSuccess,
          eventSource: isNavigation
            ? 'navigation'
            : isNetworkRequest
            ? 'network'
            : isCustomEvent
            ? 'custom'
            : spanName === 'intercom.onShow'
            ? 'chat'
            : 'log',
          title: isNavigation
            ? `Navigated to ${shortLocationHref}`
            : url.length > 0
            ? `${statusCode} ${method}`
            : errorMessage != null && errorMessage.length > 0
            ? 'console.error'
            : spanName === 'intercom.onShow'
            ? 'Intercom Chat Opened'
            : isCustomEvent
            ? spanName
            : component === 'console'
            ? spanName
            : 'console.error',
          description: isNavigation
            ? ''
            : url.length > 0
            ? shortUrl
            : errorMessage != null && errorMessage.length > 0
            ? errorMessage
            : component === 'console'
            ? body
            : '',
          timestamp: startOffset,
          took: endOffset - startOffset,
        };
      }) ?? []
    );
  }, [events]);

  const parentRef = useRef<HTMLDivElement>(null);

  // The virtualizer
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
  });

  if (isSessionEventsFetching) {
    return (
      <div className="d-flex justify-content-center align-items-center">
        Loading Session Events...
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      style={{
        height: `100%`,
        overflow: 'auto', // Make it scroll!
      }}
      className="pe-1"
    >
      {/* The large inner element to hold all of the items */}
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {/* Only the visible items in the virtualizer, manually positioned to be in view */}
        {rowVirtualizer.getVirtualItems().map(virtualItem => {
          const row = rows[virtualItem.index];
          const showCompactDescription =
            row.description.length < 100 &&
            row.description.indexOf('\n') === -1;

          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
              data-index={virtualItem.index}
              ref={rowVirtualizer.measureElement}
              className="py-2"
            >
              <div className="d-flex justify-content-between">
                <div
                  className="d-flex"
                  role="button"
                  onClick={() => onClick(row.id, row.sortKey)}
                >
                  <div
                    className={`rounded-circle d-flex align-items-center justify-content-center me-2 ${
                      row.isError
                        ? 'bg-danger'
                        : row.eventSource === 'navigation' ||
                          row.eventSource === 'chat'
                        ? 'bg-primary'
                        : row.eventSource === 'network'
                        ? 'bg-success'
                        : 'bg-primary'
                    }`}
                    style={{
                      height: 20,
                      width: 20,
                      minHeight: 20,
                      minWidth: 20,
                    }}
                  >
                    <i
                      className={`bi text-dark fs-8 bi-${
                        row.eventSource === 'navigation'
                          ? 'geo-alt'
                          : row.eventSource === 'network'
                          ? 'arrow-left-right'
                          : row.eventSource === 'chat'
                          ? 'chat-dots'
                          : row.eventSource === 'custom'
                          ? 'cursor'
                          : 'terminal'
                      }`}
                    />
                  </div>
                  <div
                    className={`fw-bold ${
                      row.isError
                        ? 'text-danger'
                        : row.eventSource === 'navigation'
                        ? 'text-primary'
                        : row.isSuccess
                        ? 'text-success'
                        : 'text-muted'
                    }`}
                  >
                    {' '}
                    {row.title}
                  </div>
                  {showCompactDescription && (
                    <div className="text-muted-hover ms-2">
                      {row.description}
                    </div>
                  )}
                  {row.took > 0 && (
                    <div className="text-muted-hover ms-2">· {row.took}ms</div>
                  )}
                </div>
                <div
                  className="text-muted-hover align-middle ms-2 text-nowrap"
                  role="button"
                  onClick={() => onTimeClick(row.timestamp)}
                >
                  <i className="bi bi-play-fill me-1" />
                  <FormatTime value={row.timestamp} format="short" />
                </div>
              </div>

              {!showCompactDescription && (
                <pre className="text-muted mt-2">{row.description}</pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
const MemoSessionEventList = memo(SessionEventList);

const MemoPlaybar = memo(Playbar);

export default function SessionSubpanel({
  onPropertyAddClick,
  generateChartUrl,
  generateSearchUrl,
  setDrawerOpen,
  rumSessionId,
  start,
  end,
  initialTs,
}: {
  generateSearchUrl: (query?: string, timeRange?: [Date, Date]) => string;
  generateChartUrl: (config: {
    aggFn: string;
    field: string;
    groupBy: string[];
  }) => string;

  onPropertyAddClick?: (name: string, value: string) => void;
  setDrawerOpen: (open: boolean) => void;
  rumSessionId: string;
  start: Date;
  end: Date;
  initialTs?: number;
}) {
  const [selectedLog, setSelectedLog] = useState<
    | {
        id: string;
        sortKey: string;
      }
    | undefined
  >(undefined);

  // Without portaling the nested drawer close overlay will not render properly
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    containerRef.current = document.createElement('div');

    if (containerRef.current) {
      document.body.appendChild(containerRef.current);
    }

    return () => {
      if (containerRef.current) {
        document.body.removeChild(containerRef.current);
      }
    };
  }, []);
  const portaledPanel =
    containerRef.current != null
      ? ReactDOM.createPortal(
          <LogSidePanel
            key={selectedLog?.id}
            logId={selectedLog?.id}
            sortKey={selectedLog?.sortKey}
            onClose={() => {
              setDrawerOpen(false);
              setSelectedLog(undefined);
            }}
            onPropertyAddClick={onPropertyAddClick}
            generateSearchUrl={generateSearchUrl}
            generateChartUrl={generateChartUrl}
            isNestedPanel
          />,
          containerRef.current,
        )
      : null;

  const [tsQuery, setTsQuery] = useQueryState(
    'ts',
    parseAsInteger.withOptions({ history: 'replace' }),
  );
  const prevTsQuery = usePrevious(tsQuery);

  useEffect(() => {
    if (prevTsQuery == null && tsQuery != null) {
      _setFocus({ ts: tsQuery, setBy: 'url' });
    }
  }, [prevTsQuery, tsQuery]);

  const debouncedSetTsQuery = useRef(
    throttle(async (ts: number) => {
      setTsQuery(ts);
    }, 1000),
  ).current;
  useEffect(() => {
    return () => {
      setTsQuery(null);
    };
  }, [setTsQuery]);

  const [focus, _setFocus] = useState<
    { ts: number; setBy: string } | undefined
  >(
    initialTs != null
      ? {
          ts: initialTs,
          setBy: 'parent',
        }
      : undefined,
  );
  const setFocus = useCallback(
    (focus: { ts: number; setBy: string }) => {
      if (focus.setBy === 'player') {
        debouncedSetTsQuery(focus.ts);
      } else {
        setTsQuery(focus.ts);
      }
      _setFocus(focus);
    },
    [_setFocus, setTsQuery, debouncedSetTsQuery],
  );
  const [playerState, setPlayerState] = useState<'paused' | 'playing'>(
    'paused',
  );

  // Event Filter Input =========================
  const inputRef = useRef<HTMLInputElement>(null);
  const [_inputQuery, setInputQuery] = useState<string | undefined>(undefined);
  const inputQuery = _inputQuery ?? '';
  const [_searchedQuery, setSearchedQuery] = useQueryState('session_q', {
    history: 'push',
  });

  // Hacky way to set the input query when we search
  useEffect(() => {
    if (_searchedQuery != null && _inputQuery == null) {
      setInputQuery(_searchedQuery);
    }
  }, [_searchedQuery, _inputQuery]);
  // Allows us to determine if the user has changed the search query
  const searchedQuery = _searchedQuery ?? '';
  // Clear search query when we close the panel
  useEffect(() => {
    return () => {
      setSearchedQuery(null, { history: 'replace' });
    };
  }, [setSearchedQuery]);

  // Focused Tab ===============================
  const [tab, setTab] = useState<'events' | 'highlighted' | undefined>(
    undefined,
  );
  const displayedTab = tab ?? 'highlighted';

  // Playbar ====================================
  const [playerSpeed, setPlayerSpeed] = useState(1);
  const [skipInactive, setSkipInactive] = useState(true);

  // XXX: This is a hack for the hack, we offset start/end by 4 hours
  // to ensure we capture all rrweb events on query. However, we
  // need to un-offset the time for the playback slider to show sane values.
  // these values get updated by the DOM player when events are loaded
  const [playerStartTs, setPlayerStartTs] = useState<number>(
    start.getTime() + 4 * 60 * 60 * 1000,
  );
  const [playerEndTs, setPlayerEndTs] = useState<number>(
    end.getTime() - 4 * 60 * 60 * 1000,
  );
  const playbackRange = useMemo(() => {
    return [new Date(playerStartTs), new Date(playerEndTs)] as [Date, Date];
  }, [playerStartTs, playerEndTs]);

  const playBarEventsConfig = useMemo(
    () => ({
      where: `rum_session_id:"${rumSessionId}" (http.status_code:>299 OR component:"error" OR span_name:"routeChange" OR span_name:"documentLoad" OR span_name:"intercom.onShow" OR otel.library.name:"custom-action") ${searchedQuery}`,
      dateRange: [start, end] as [Date, Date],
    }),
    [rumSessionId, start, end, searchedQuery],
  );
  const [playerFullWidth, setPlayerFullWidth] = useState(false);

  const sessionEventListConfig = useMemo(
    () => ({
      where: `rum_session_id:"${rumSessionId}" (http.status_code:>${
        displayedTab === 'events' ? '0' : '299'
      } OR component:"error" ${
        displayedTab === 'events' ? 'OR component:"console"' : ''
      } OR span_name:"routeChange" OR span_name:"documentLoad" OR span_name:"intercom.onShow" OR otel.library.name:"custom-action") ${searchedQuery}`,
      dateRange: [start, end] as [Date, Date],
    }),
    [rumSessionId, start, end, displayedTab, searchedQuery],
  );
  return (
    <div style={{ minHeight: 100, maxHeight: '100%' }} className="d-flex">
      {selectedLog != null && portaledPanel}
      <div
        className={`bg-hdx-dark rounded ${
          playerFullWidth ? '' : 'pt-3 me-3 mb-7'
        } flex-column`}
        style={{
          width: '50%',
          minWidth: 300,
          display: 'flex',
          // d-none will cause too many layout changes for the infinite scroll
          // inside the event list, so we'll just hide it with opacity/width
          ...(playerFullWidth
            ? {
                width: 0,
                minWidth: 0,
                opacity: 0,
                marginRight: 0,
                marginBottom: 0,
              }
            : {}),
        }}
      >
        <TabBar
          className="fs-8 mb-2"
          items={[
            {
              text: 'Highlighted Events',
              value: 'highlighted',
            },
            {
              text: 'All Events',
              value: 'events',
            },
          ]}
          activeItem={displayedTab}
          onClick={v => setTab(v)}
        />
        <form
          className="px-2 mt-1"
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
            placeholder="Filter events by page, endpoint..."
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
        <div className="ps-2 overflow-y-auto" style={{ minHeight: 0 }}>
          <MemoSessionEventList
            config={sessionEventListConfig}
            onClick={useCallback(
              (id: any, sortKey: any) => {
                setDrawerOpen(true);
                setSelectedLog({ id, sortKey });
              },
              [setDrawerOpen, setSelectedLog],
            )}
            focus={focus}
            onTimeClick={useCallback(
              ts => {
                setFocus({ ts, setBy: 'timeline' });
              },
              [setFocus],
            )}
          />
        </div>
      </div>
      <div
        style={{ width: playerFullWidth ? '100%' : '50%' }}
        className="d-flex flex-column"
      >
        <div className="fs-8 text-muted mt-4 mb-2">Session Player</div>
        <div
          className="d-flex flex-column mt-1 border-top border-dark mb-2"
          style={{ minHeight: 0 }}
        >
          <div className="mb-3 mt-2">
            <MemoPlaybar
              playerState={playerState}
              setPlayerState={setPlayerState}
              focus={focus}
              setFocus={setFocus}
              playbackRange={playbackRange}
              eventsConfig={playBarEventsConfig}
              playerSpeed={playerSpeed}
              setPlayerSpeed={setPlayerSpeed}
              skipInactive={skipInactive}
              setSkipInactive={setSkipInactive}
              setPlayerFullWidth={setPlayerFullWidth}
              playerFullWidth={playerFullWidth}
            />
          </div>
          <DOMPlayer
            playerState={playerState}
            setPlayerState={setPlayerState}
            focus={focus}
            setPlayerTime={useCallback(
              ts => {
                if (focus?.setBy !== 'player' || focus?.ts !== ts) {
                  setFocus({ ts, setBy: 'player' });
                }
              },
              [focus, setFocus],
            )}
            config={{
              sessionId: rumSessionId,
              dateRange: [start, end],
            }}
            playerSpeed={playerSpeed}
            skipInactive={skipInactive}
            setPlayerStartTimestamp={setPlayerStartTs}
            setPlayerEndTimestamp={setPlayerEndTs}
            resizeKey={`${playerFullWidth}`}
          />
        </div>
      </div>
    </div>
  );
}
