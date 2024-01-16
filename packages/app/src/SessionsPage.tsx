import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { sub } from 'date-fns';
import { Button, Form } from 'react-bootstrap';
import { toast } from 'react-toastify';
import { NumberParam } from 'serialize-query-params';
import {
  StringParam,
  useQueryParam,
  useQueryParams,
  withDefault,
} from 'use-query-params';
import { useVirtualizer } from '@tanstack/react-virtual';

import api from './api';
import Dropdown from './Dropdown';
import { withAppNav } from './layout';
import SearchInput from './SearchInput';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import SessionSidePanel from './SessionSidePanel';
import { parseTimeQuery, useTimeQuery } from './timeQuery';
import {
  formatDistanceToNowStrictShort,
  formatHumanReadableDate,
} from './utils';

function SessionCard({
  email,
  maxTime,
  minTime,
  numErrors,
  numEvents,
  onClick,
  sessionId,
  teamId,
  teamName,
  userName,
}: {
  email: string;
  maxTime: Date;
  minTime: Date;
  numErrors: number;
  numEvents: number;
  onClick: () => void;
  sessionId: string;
  teamId: string;
  teamName: string;
  userName: string;
}) {
  const timeAgo = formatDistanceToNowStrictShort(maxTime);
  const durationStr = new Date(maxTime.getTime() - minTime.getTime())
    .toISOString()
    .slice(11, 19);

  return (
    <div
      className="bg-hdx-dark rounded p-3 d-flex align-items-center justify-content-between text-white-hover-success-trigger"
      onClick={onClick}
      role="button"
    >
      <div
        style={{ width: '50%', maxWidth: 500 }}
        className="child-hover-trigger"
      >
        {email || `Anonymous Session ${sessionId}`}
      </div>
      <div>
        <div className="text-muted fs-8">{numEvents} Events</div>
        {numErrors > 0 && (
          <div className="text-danger fs-8">{numErrors} Errors</div>
        )}
        <div className="text-muted fs-8">Duration {durationStr}</div>
      </div>
      <div className="text-end">
        <div>Last active {timeAgo} ago</div>
        <div className="text-muted fs-8 mt-1">
          Started on {formatHumanReadableDate(minTime)}
        </div>
      </div>
    </div>
  );
}

function SessionCardList({
  config: { where, dateRange },
  onClick,
}: {
  config: {
    where: string;
    dateRange: [Date, Date];
  };
  onClick: (sessionId: string, dateRange: [Date, Date]) => void;
}) {
  const { data: tableData, isLoading: isTableDataLoading } = api.useSessions({
    startDate: dateRange[0],
    endDate: dateRange[1],
    q: where,
  });

  const sessions = tableData?.data ?? [];

  const parentRef = useRef<HTMLDivElement>(null);

  // The virtualizer
  const rowVirtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 86,
    paddingEnd: 16,
  });

  return (
    <>
      {isTableDataLoading === true && (
        <div className="text-center mt-8">
          <div
            className="spinner-border me-2"
            role="status"
            style={{ width: 14, height: 14 }}
          />
          Searching sessions...
        </div>
      )}
      {!isTableDataLoading && sessions.length === 0 && (
        <div className="text-center align-items-center justify-content-center my-3">
          No results found.
          <div className="text-muted mt-3">
            Try checking the query explainer in the search bar if there are any
            search syntax issues.
          </div>
          <div className="text-muted mt-3">
            Add new data sources by setting up a HyperDX integration.
          </div>
          <Button
            variant="outline-success"
            className="fs-7 mt-3"
            target="_blank"
            href="/docs/install/browser"
          >
            Install HyperDX Browser Integration
          </Button>
        </div>
      )}
      <div
        ref={parentRef}
        style={{
          height: `100%`,
          overflow: 'auto', // Make it scroll!
        }}
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
            const row = sessions[virtualItem.index];

            const {
              errorCount,
              maxTimestamp,
              minTimestamp,
              sessionCount,
              sessionId,
              teamId,
              teamName,
              userEmail,
              userName,
            } = row;
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
              >
                <div className="mb-3">
                  <SessionCard
                    sessionId={sessionId}
                    email={userEmail}
                    userName={userName}
                    teamName={teamName}
                    teamId={teamId}
                    numEvents={Number(sessionCount)}
                    numErrors={Number(errorCount)}
                    maxTime={new Date(maxTimestamp)}
                    minTime={new Date(minTimestamp)}
                    onClick={() => {
                      onClick(sessionId, [
                        sub(new Date(minTimestamp), { hours: 4 }),
                        sub(new Date(maxTimestamp), { hours: -4 }),
                      ]);
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false);
export default function SessionsPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputQuery, setInputQuery] = useState<string>('');

  const [_searchedQuery, setSearchedQuery] = useQueryParam(
    'q',
    withDefault(StringParam, undefined),
    {
      updateType: 'pushIn',
      // Workaround for qparams not being set properly: https://github.com/pbeshai/use-query-params/issues/233
      enableBatching: true,
    },
  );
  // Allows us to determine if the user has changed the search query
  const searchedQuery = _searchedQuery ?? '';

  // TODO: Set displayed query to qparam... in a less bad way?
  useEffect(() => {
    setInputQuery(searchedQuery);
  }, [searchedQuery]);

  const {
    searchedTimeRange,
    displayedTimeInputValue,
    setDisplayedTimeInputValue,
    onSearch,
  } = useTimeQuery({
    isUTC: false,
    defaultValue: 'Past 1h',
    defaultTimeRange: [
      defaultTimeRange?.[0]?.getTime() ?? -1,
      defaultTimeRange?.[1]?.getTime() ?? -1,
    ],
  });

  const [startDate, endDate] = searchedTimeRange;

  const [selectedSessionQuery, setSelectedSessionQuery] = useQueryParams(
    {
      sid: withDefault(StringParam, undefined),
      sfrom: withDefault(NumberParam, undefined),
      sto: withDefault(NumberParam, undefined),
    },
    {
      updateType: 'pushIn',
      enableBatching: true,
    },
  );

  const selectedSession = useMemo(() => {
    if (selectedSessionQuery.sid == null) {
      return undefined;
    }
    return {
      id: selectedSessionQuery.sid,
      dateRange: [
        new Date(selectedSessionQuery.sfrom ?? 0),
        new Date(selectedSessionQuery.sto ?? 0),
      ] as [Date, Date],
    };
  }, [selectedSessionQuery]);
  const setSelectedSession = useCallback(
    (
      session:
        | {
            id: string;
            dateRange: [Date, Date];
          }
        | undefined,
    ) => {
      if (session == null) {
        setSelectedSessionQuery({
          sid: undefined,
          sfrom: undefined,
          sto: undefined,
        });
      } else {
        setSelectedSessionQuery({
          sid: session.id,
          sfrom: session.dateRange[0].getTime(),
          sto: session.dateRange[1].getTime(),
        });
      }
    },
    [setSelectedSessionQuery],
  );

  const generateSearchUrl = useCallback(
    (newQuery?: string, newTimeRange?: [Date, Date]) => {
      const qparams = new URLSearchParams({
        q: newQuery ?? searchedQuery,
        from: newTimeRange
          ? newTimeRange[0].getTime().toString()
          : startDate.getTime().toString(),
        to: newTimeRange
          ? newTimeRange[1].getTime().toString()
          : endDate.getTime().toString(),
      });
      return `/search?${qparams.toString()}`;
    },
    [],
  );

  const generateChartUrl = useCallback(({ aggFn, field, where, groupBy }) => {
    return `/chart?series=${encodeURIComponent(
      JSON.stringify({
        type: 'time',
        aggFn,
        field,
        where,
        groupBy,
      }),
    )}`;
  }, []);

  const [isEmailFilterExpanded, setIsEmailFilterExpanded] = useState(true);

  return (
    <div className="SessionsPage">
      <Head>
        <title>Client Sessions - HyperDX</title>
      </Head>
      {selectedSession != null && (
        <SessionSidePanel
          key={`session-page-session-side-panel-${selectedSession.id}`}
          sessionId={selectedSession.id}
          dateRange={selectedSession.dateRange}
          onClose={() => {
            setSelectedSession(undefined);
          }}
          generateSearchUrl={generateSearchUrl}
          generateChartUrl={({ aggFn, field, groupBy }) =>
            generateChartUrl({
              aggFn,
              field,
              groupBy,
              where: `rum_session_id:"${selectedSession.id}"`,
            })
          }
        />
      )}
      <div className="d-flex flex-column flex-grow-1 px-3 pt-3">
        <div className="d-flex justify-content-between">
          <div className="fs-5 mb-3 fw-500">Client Sessions</div>
          <div className="flex-grow-1" style={{ maxWidth: 350 }}>
            <form
              onSubmit={e => {
                e.preventDefault();
                onSearch(displayedTimeInputValue);
              }}
            >
              <SearchTimeRangePicker
                inputValue={displayedTimeInputValue}
                setInputValue={setDisplayedTimeInputValue}
                onSearch={range => {
                  onSearch(range);
                }}
              />
              <input
                type="submit"
                value="Search Time Range"
                style={{
                  width: 0,
                  height: 0,
                  border: 0,
                  padding: 0,
                }}
              />
            </form>
          </div>
        </div>
        <div className="d-flex align-items-center">
          <div className="d-flex align-items-center me-2">
            <span
              className="rounded fs-8 text-nowrap border border-dark p-2"
              style={{
                borderTopRightRadius: '0 !important',
                borderBottomRightRadius: '0 !important',
              }}
              title="Filters"
            >
              <i className="bi bi-funnel"></i>
            </span>{' '}
            <div className="d-flex align-items-center w-100 flex-grow-1">
              <Button
                variant="dark"
                type="button"
                className="text-muted-hover d-flex align-items-center fs-8 p-2"
                onClick={() => setIsEmailFilterExpanded(v => !v)}
                style={
                  isEmailFilterExpanded
                    ? {
                        borderRadius: 0,
                      }
                    : {
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                      }
                }
              >
                Email
              </Button>
              {isEmailFilterExpanded && (
                <form
                  className="d-flex"
                  onSubmit={e => {
                    e.preventDefault();

                    // TODO: Transition to react-hook-form or controlled state
                    // @ts-ignore
                    const value = e.target.value.value;
                    // @ts-ignore
                    const op = e.target.op.value;

                    setSearchedQuery(
                      (
                        inputQuery +
                        (op === 'is'
                          ? ` userEmail:"${value}"`
                          : op === 'is_not'
                          ? ` -userEmail:"${value}"`
                          : ` userEmail:${value}`)
                      ).trim(),
                    );

                    toast.success('Added filter to search query');
                    inputRef.current?.focus();

                    // @ts-ignore
                    e.target.value.value = '';
                  }}
                >
                  <Dropdown
                    name="op"
                    className="border border-dark fw-normal fs-8 p-2"
                    style={{ borderRadius: 0, minWidth: 100 }}
                    options={[
                      {
                        value: 'contains',
                        text: 'contains',
                      },
                      { value: 'is', text: 'is' },
                      { value: 'is_not', text: 'is not' },
                    ]}
                    value={undefined}
                    onChange={() => {}}
                  />
                  <Form.Control
                    type="text"
                    id="value"
                    name="value"
                    className="fs-8 p-2 w-100"
                    style={{ borderRadius: 0 }}
                    placeholder="value"
                  />
                  <Button
                    type="submit"
                    variant="dark"
                    className="text-muted-hover d-flex align-items-center fs-8 p-2"
                    style={{
                      borderTopLeftRadius: 0,
                      borderBottomLeftRadius: 0,
                    }}
                  >
                    Add
                  </Button>
                </form>
              )}
            </div>
          </div>
          <form
            className="d-flex align-items-center flex-grow-1"
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
              placeholder="Search for a session by email, id..."
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
        </div>
        <div style={{ minHeight: 0 }} className="mt-4">
          <SessionCardList
            onClick={(sessionId, dateRange) => {
              setSelectedSession({ id: sessionId, dateRange });
            }}
            config={{
              where: searchedQuery,
              dateRange: searchedTimeRange as [Date, Date],
            }}
          />
        </div>
      </div>
    </div>
  );
}

SessionsPage.getLayout = withAppNav;
