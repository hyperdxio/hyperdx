import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { sub } from 'date-fns';
import { parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { NumberParam } from 'serialize-query-params';
import { StringParam, useQueryParams, withDefault } from 'use-query-params';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  SearchCondition,
  SearchConditionLanguage,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Anchor,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Flex,
  Group,
  Stack,
  Stepper,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconDeviceLaptop,
  IconInfoCircleFilled,
  IconPlayerPlay,
  IconRefresh,
} from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { TimePicker } from '@/components/TimePicker';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

import { SQLInlineEditorControlled } from './components/SQLInlineEditor';
import WhereLanguageControlled from './components/WhereLanguageControlled';
import { useBrandDisplayName } from './theme/ThemeProvider';
import { withAppNav } from './layout';
import SearchInputV2 from './SearchInputV2';
import { Session, useSessions } from './sessions';
import SessionSidePanel from './SessionSidePanel';
import { useSource, useSources } from './source';
import { FormatTime } from './useFormatTime';
import { formatDistanceToNowStrictShort } from './utils';

import styles from '../styles/SessionsPage.module.scss';

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
      data-testid={`session-card-${sessionId}`}
      className={`bg-muted rounded p-3 d-flex align-items-center justify-content-between ${styles.sessionCard}`}
      onClick={onClick}
      role="button"
    >
      <div style={{ width: '50%', maxWidth: 500 }} className={styles.emailText}>
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
  const brandName = useBrandDisplayName();
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
        <Group mt="md" align="center" justify="center" gap="xs">
          <IconRefresh className="spin-animate" size={14} />
          Searching sessions...
        </Group>
      )}
      {!isSessionLoading && sessions.length === 0 && (
        <div className="text-center align-items-center justify-content-center my-3">
          No results found.
          <div className="text-muted mt-3">
            Try checking the query explainer in the search bar if there are any
            search syntax issues.
          </div>
          <div className="text-muted mt-3">
            Add new data sources by setting up a {brandName} integration.
          </div>
          <Button
            component="a"
            variant="outline-success"
            className="fs-7 mt-3"
            target="_blank"
            href="/docs/install/browser"
          >
            Install {brandName} Browser Integration
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
  where: parseAsString.withDefault(''),
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
};
export default function SessionsPage() {
  const brandName = useBrandDisplayName();
  const [appliedConfig, setAppliedConfig] = useQueryStates(appliedConfigMap);

  const { control, setValue, handleSubmit } = useForm({
    values: {
      where: appliedConfig.where,
      whereLanguage: appliedConfig.whereLanguage,
      source: appliedConfig.sessionSource,
    },
  });

  const where = useWatch({ control, name: 'where' });
  const whereLanguage = useWatch({ control, name: 'whereLanguage' });
  const sourceId = useWatch({ control, name: 'source' });
  const { data: sessionSource, isPending: isSessionSourceLoading } = useSource({
    id: sourceId,
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
      const { source, ...rest } = values;
      setAppliedConfig({ sessionSource: source, ...rest });
    })();
  }, [handleSubmit, setAppliedConfig, onSearch, displayedTimeInputValue]);

  // Auto submit when service or source changes
  useEffect(() => {
    if (sourceId !== appliedConfig.sessionSource) {
      onSubmit();
    }
  }, [sourceId, appliedConfig.sessionSource, onSubmit]);

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
    <div className="SessionsPage" data-testid="sessions-page">
      <Head>
        <title>Client Sessions - {brandName}</title>
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
            whereLanguage={whereLanguage || undefined}
            where={where || undefined}
          />
        )}
      <Box p="sm">
        <form
          data-testid="sessions-search-form"
          onSubmit={e => {
            e.preventDefault();
            onSubmit();
            return false;
          }}
        >
          <Flex gap="xs" direction="column" wrap="nowrap">
            <Group justify="space-between" gap="xs" wrap="nowrap" flex={1}>
              <SourceSelectControlled
                control={control}
                name="source"
                allowedSourceKinds={[SourceKind.Session]}
              />
              <WhereLanguageControlled
                name="whereLanguage"
                control={control}
                sqlInput={
                  <Box style={{ width: '50%', flexGrow: 1 }}>
                    <SQLInlineEditorControlled
                      tableConnection={tcFromSource(traceTrace)}
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
                      allowMultiline={true}
                    />
                  </Box>
                }
                luceneInput={
                  <SearchInputV2
                    tableConnection={tcFromSource(traceTrace)}
                    control={control}
                    onSubmit={onSubmit}
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
              <Button
                variant="primary"
                type="submit"
                px="sm"
                leftSection={<IconPlayerPlay size={16} />}
                style={{ flexShrink: 0 }}
              >
                Run
              </Button>
            </Group>
          </Flex>
        </form>

        {isSessionsLoading || isSessionSourceLoading ? (
          <Group mt="md" align="center" justify="center" gap="xs">
            <IconRefresh className="spin-animate" size={14} />
            {isSessionSourceLoading ? 'Loading...' : 'Searching sessions...'}
          </Group>
        ) : (
          <>
            {sessionSource && sessionSource.kind !== SourceKind.Session && (
              <Alert
                icon={<IconInfoCircleFilled size={16} />}
                color="gray"
                py="xs"
                mt="md"
              >
                Please select a valid session source
              </Alert>
            )}
            {!sessions.length ? (
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
          </>
        )}
      </Box>
    </div>
  );
}

SessionsPage.getLayout = withAppNav;

function SessionSetupInstructions() {
  const brandName = useBrandDisplayName();
  return (
    <>
      <Card w={500} mx="auto" mt="xl" p="xl" withBorder>
        <Stack gap="lg">
          <Stack align="center" gap="xs">
            <ThemeIcon size={56} radius="xl" variant="light" color="gray">
              <IconDeviceLaptop size={32} />
            </ThemeIcon>
            <Title order={3} fw={600}>
              Set up session replays
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              Follow these steps to start recording and viewing session replays
              with the {brandName} Otel Collector.
            </Text>
          </Stack>
          <Divider />
          <Stepper active={-1} orientation="vertical" size="md">
            <Stepper.Step
              label={
                <>
                  Create a new source with <Code>Session</Code> type
                </>
              }
              description={
                <>
                  Go to Team Settings, click <Code>Add Source</Code> under
                  Sources section, and select <Code>Session</Code> as the source
                  type.
                </>
              }
            />
            <Stepper.Step
              label={
                <>
                  Choose the <Code>hyperdx_sessions</Code> table
                </>
              }
              description={
                <>
                  Select the <Code>hyperdx_sessions</Code> table from the
                  dropdown, and select the corresponding trace source.
                </>
              }
            />
            <Stepper.Step
              label="Start recording sessions"
              description={
                <>
                  Install the{' '}
                  <Anchor
                    href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/browser"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {brandName} Browser Integration
                  </Anchor>{' '}
                  to start recording sessions.
                </>
              }
            />
          </Stepper>
        </Stack>
      </Card>
    </>
  );
}
