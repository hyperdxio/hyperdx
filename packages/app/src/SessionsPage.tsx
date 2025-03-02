import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { sub } from 'date-fns';
import {
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm } from 'react-hook-form';
import { NumberParam } from 'serialize-query-params';
import {
  StringParam,
  useQueryParam,
  useQueryParams,
  withDefault,
} from 'use-query-params';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Box,
  Button,
  Grid,
  Group,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useVirtualizer } from '@tanstack/react-virtual';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { TimePicker } from '@/components/TimePicker';
import { getMetadata } from '@/metadata';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

import { SQLInlineEditorControlled } from './components/SQLInlineEditor';
import WhereLanguageControlled from './components/WhereLanguageControlled';
import { Session, useSessions } from './clickhouse';
import { withAppNav } from './layout';
import SearchInput from './SearchInput';
import SearchInputV2 from './SearchInputV2';
import SessionSidePanel from './SessionSidePanel';
import { useSource, useSources } from './source';
import { FormatTime } from './useFormatTime';
import { formatDistanceToNowStrictShort } from './utils';

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
          Started on <FormatTime value={minTime} />
        </div>
      </div>
    </div>
  );
}

function SessionCardList({
  sessions,
  isSessionLoading,
  onClick,
}: {
  sessions: Session[];
  isSessionLoading?: boolean;
  onClick: (session: Session) => void;
}) {
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
      {isSessionLoading === true && (
        <div className="text-center mt-8">
          <div
            className="spinner-border me-2"
            role="status"
            style={{ width: 14, height: 14 }}
          />
          Searching sessions...
        </div>
      )}
      {!isSessionLoading && sessions.length === 0 && (
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
            component="a"
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
                      onClick(row);
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
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];
const appliedConfigMap = {
  sessionSource: parseAsString,
  where: parseAsString,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
};
export default function SessionsPage() {
  const [appliedConfig, setAppliedConfig] = useQueryStates(appliedConfigMap);

  const { control, watch, setValue, handleSubmit } = useForm({
    values: {
      where: appliedConfig.where,
      whereLanguage: appliedConfig.whereLanguage,
      source: appliedConfig.sessionSource,
    },
  });

  const where = watch('where');
  const whereLanguage = watch('whereLanguage');
  const sourceId = watch('source');
  const { data: sessionSource } = useSource({
    id: watch('source'),
  });

  const { data: traceTrace } = useSource({
    id: sessionSource?.traceSourceId,
  });

  // Get all sources and select the first session type source by default
  const { data: sources } = useSources();

  useEffect(() => {
    if (sourceId && !appliedConfig.sessionSource) {
      setAppliedConfig({ sessionSource: sourceId });
    }
  }, [appliedConfig.sessionSource, setAppliedConfig, sourceId]);

  // Auto-select the first session source when the page loads
  useEffect(() => {
    if (sources && sources.length > 0 && !appliedConfig.sessionSource) {
      // Find the first session source
      const sessionSource = sources.find(
        source => source.kind === SourceKind.Session,
      );
      if (sessionSource) {
        setValue('source', sessionSource.id);
        // This will trigger the other useEffect above to update appliedConfig
      }
    }
  }, [sources, appliedConfig.sessionSource, setValue]);

  const DEFAULT_INTERVAL = 'Past 1h';
  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState(DEFAULT_INTERVAL);

  const { searchedTimeRange, onSearch } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  const onSubmit = useCallback(() => {
    onSearch(displayedTimeInputValue);
    handleSubmit(values => {
      setAppliedConfig(values);
    })();
  }, [handleSubmit, setAppliedConfig, onSearch, displayedTimeInputValue]);

  // Auto submit when service or source changes
  useEffect(() => {
    if (sourceId !== appliedConfig.sessionSource) {
      onSubmit();
    }
  }, [sourceId]);

  // FIXME: fix the url
  const generateSearchUrl = useCallback(
    (newQuery?: string, newTimeRange?: [Date, Date]) => {
      const qparams = new URLSearchParams({
        q: '',
      });
      return `/search?${qparams.toString()}`;
    },
    [],
  );

  // FIXME: fix the url
  const generateChartUrl = useCallback(
    ({ aggFn, field, where, groupBy }: any) => {
      return `/chart?series=${encodeURIComponent(
        JSON.stringify({
          type: 'time',
          aggFn,
          field,
          where,
          groupBy,
        }),
      )}`;
    },
    [],
  );

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
    (session: Session | undefined) => {
      if (session == null) {
        setSelectedSessionQuery({
          sid: undefined,
          sfrom: undefined,
          sto: undefined,
        });
      } else {
        setSelectedSessionQuery({
          sid: session.sessionId,
          // WARNING: adding 4 hours offset to fetch the whole rrweb session
          sfrom: sub(new Date(session.minTimestamp), { hours: 4 }).getTime(),
          sto: sub(new Date(session.maxTimestamp), { hours: -4 }).getTime(),
        });
      }
    },
    [setSelectedSessionQuery],
  );

  const { data: tableData, isLoading: isSessionsLoading } = useSessions({
    dateRange: searchedTimeRange,
    sessionSource: sessionSource,
    traceSource: traceTrace,
    // TODO: if selectedSession is not null, we should filter by that session id
    where: appliedConfig.where as SearchCondition,
    whereLanguage: appliedConfig.whereLanguage as SearchConditionLanguage,
  });

  const sessions = tableData?.data ?? [];
  const targetSession = sessions.find(s => s.sessionId === selectedSession?.id);

  return (
    <div className="SessionsPage">
      <Head>
        <title>Client Sessions - HyperDX</title>
      </Head>
      {selectedSession != null &&
        traceTrace != null &&
        sessionSource != null &&
        targetSession && (
          <SessionSidePanel
            key={`session-page-session-side-panel-${selectedSession.id}`}
            traceSource={traceTrace}
            sessionSource={sessionSource}
            sessionId={selectedSession.id}
            dateRange={selectedSession.dateRange}
            session={targetSession}
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
      <Box p="sm">
        <form
          onSubmit={e => {
            e.preventDefault();
            onSubmit();
            return false;
          }}
        >
          <Group gap="xs">
            <Group justify="space-between" gap="xs" wrap="nowrap" flex={1}>
              <SourceSelectControlled control={control} name="source" />
              <WhereLanguageControlled
                name="whereLanguage"
                control={control}
                sqlInput={
                  <SQLInlineEditorControlled
                    connectionId={traceTrace?.connection}
                    database={traceTrace?.from?.databaseName}
                    table={traceTrace?.from?.tableName}
                    onSubmit={onSubmit}
                    control={control}
                    name="where"
                    placeholder="SQL WHERE clause (ex. column = 'foo')"
                    onLanguageChange={lang =>
                      setValue('whereLanguage', lang, {
                        shouldDirty: true,
                      })
                    }
                    language="sql"
                    label="WHERE"
                    enableHotkey
                  />
                }
                luceneInput={
                  <SearchInputV2
                    connectionId={traceTrace?.connection}
                    database={traceTrace?.from?.databaseName}
                    table={traceTrace?.from?.tableName}
                    control={control}
                    name="where"
                    onLanguageChange={lang =>
                      setValue('whereLanguage', lang, {
                        shouldDirty: true,
                      })
                    }
                    language="lucene"
                    placeholder="Search your events w/ Lucene ex. column:foo"
                    enableHotkey
                  />
                }
              />
              <TimePicker
                inputValue={displayedTimeInputValue}
                setInputValue={setDisplayedTimeInputValue}
                onSearch={range => {
                  onSearch(range);
                }}
              />
              <Button variant="outline" type="submit" px="sm">
                <i className="bi bi-play"></i>
              </Button>
            </Group>
          </Group>
        </form>
        {sessionSource?.kind !== SourceKind.Session || traceTrace == null ? (
          <>
            <Alert
              icon={<i className="bi bi-info-circle-fill text-slate-400" />}
              color="gray"
              py="xs"
              mt="md"
            >
              Please select a valid session source
            </Alert>
            <SessionSetupInstructions />
          </>
        ) : sessions.length === 0 ? (
          <SessionSetupInstructions />
        ) : (
          <div style={{ minHeight: 0 }} className="mt-4">
            <SessionCardList
              onClick={session => {
                setSelectedSession(session);
              }}
              sessions={sessions}
              isSessionLoading={isSessionsLoading}
            />
          </div>
        )}
      </Box>
    </div>
  );
}

SessionsPage.getLayout = withAppNav;

function SessionSetupInstructions() {
  return (
    <>
      <Stack w={500} mx="auto" mt="xl" gap="xxs">
        <i className="bi bi-laptop text-slate-600 fs-1"></i>
        <Text c="gray" fw={500} size="xs">
          Instructions
        </Text>
        <Text c="gray">
          You can set up Session Replays when the HyperDX Otel Collector is
          used.
        </Text>
        <Text c="gray" fw={500} mt="sm">
          1. Create a new source with <strong>Session</strong> type
        </Text>
        <Text c="dimmed" size="xs">
          Go to Team Settings, click <strong>Add Source</strong> under Sources
          section, and select <strong>Session</strong> as the source type.
        </Text>
        <Text c="gray" fw={500} mt="sm">
          2. Choose the <strong>rrweb</strong> table
        </Text>
        <Text c="dimmed" size="xs">
          Select the <strong>rrweb</strong> table from the dropdown, and select
          the corresponding trace source.
        </Text>

        <Text c="gray" fw={500} mt="sm">
          3. Start recording sessions
        </Text>
        <Text c="dimmed" size="xs">
          Install the{' '}
          <a href="https://www.hyperdx.io/docs/install/browser" target="_blank">
            HyperDX Browser Integration
          </a>{' '}
          to start recording sessions.
        </Text>
      </Stack>
    </>
  );
}
