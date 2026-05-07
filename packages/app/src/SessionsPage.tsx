import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { Trans } from 'next-i18next/pages';
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
  Anchor,
  Box,
  Button,
  Code,
  Flex,
  Group,
  Paper,
  Stepper,
} from '@mantine/core';
import {
  IconDeviceLaptop,
  IconPlayerPlay,
  IconRefresh,
} from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';

import EmptyState from '@/components/EmptyState';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { TimePicker } from '@/components/TimePicker';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

import OnboardingModal from './components/OnboardingModal';
import SearchWhereInput, {
  getStoredLanguage,
} from './components/SearchInput/SearchWhereInput';
import { useBrandDisplayName } from './theme/ThemeProvider';
import { withAppNav } from './layout';
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
}: {
  email: string;
  maxTime: Date;
  minTime: Date;
  numErrors: number;
  numEvents: number;
  onClick: () => void;
  sessionId: string;
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
        <div className="text-muted fs-8">
          {numEvents} <Trans>Events</Trans>
        </div>
        {numErrors > 0 && (
          <div className="text-danger fs-8">
            {numErrors} <Trans>Errors</Trans>
          </div>
        )}
        <div className="text-muted fs-8">
          <Trans>Duration</Trans> {durationStr}
        </div>
      </div>
      <div className="text-end">
        <div>
          <Trans>Last active</Trans> {timeAgo} <Trans>ago</Trans>
        </div>
        <div className="text-muted fs-8 mt-1">
          <Trans>Started on</Trans> <FormatTime value={minTime} />
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
          <Trans>Searching sessions...</Trans>
        </Group>
      )}
      {!isSessionLoading && sessions.length === 0 && (
        <div className="text-center align-items-center justify-content-center my-3">
          <Trans>No results found.</Trans>
          <div className="text-muted mt-3">
            <Trans>
              Try checking the query explainer in the search bar if there are
              any search syntax issues.
            </Trans>
          </div>
          <div className="text-muted mt-3">
            <Trans>Add new data sources by setting up a</Trans> {brandName}{' '}
            <Trans>integration.</Trans>
          </div>
          <Button
            component="a"
            variant="outline-success"
            className="fs-7 mt-3"
            target="_blank"
            href="/docs/install/browser"
          >
            <Trans>Install</Trans> {brandName}{' '}
            <Trans>Browser Integration</Trans>
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
              userEmail,
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
      whereLanguage:
        appliedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
      source: appliedConfig.sessionSource,
    },
  });

  const where = useWatch({ control, name: 'where' });
  const whereLanguage = useWatch({ control, name: 'whereLanguage' });
  const sourceId = useWatch({ control, name: 'source' });
  const { data: sessionSource, isPending: isSessionSourceLoading } = useSource({
    id: sourceId,
    kinds: [SourceKind.Session],
  });

  const { data: traceTrace } = useSource({
    id: sessionSource?.traceSourceId,
    kinds: [SourceKind.Trace],
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
    sessionSource,
    traceSource: traceTrace,
    // TODO: if selectedSession is not null, we should filter by that session id
    where: appliedConfig.where as SearchCondition,
    whereLanguage: appliedConfig.whereLanguage as SearchConditionLanguage,
  });

  const sessions = tableData?.data ?? [];
  const targetSession = sessions.find(s => s.sessionId === selectedSession?.id);

  return (
    <div
      className="SessionsPage"
      data-testid="sessions-page"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <Head>
        <title>
          <Trans>Client Sessions -</Trans> {brandName}
        </title>
      </Head>
      <OnboardingModal />
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
            whereLanguage={whereLanguage || undefined}
            where={where || undefined}
            onLanguageChange={lang =>
              setAppliedConfig(prev => ({ ...prev, whereLanguage: lang }))
            }
          />
        )}
      <Box p="sm" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
              <SearchWhereInput
                tableConnection={tcFromSource(traceTrace)}
                control={control}
                name="where"
                onSubmit={onSubmit}
                enableHotkey
                width="50%"
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
                <Trans>Run</Trans>
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
            {!sessions.length ? (
              <Flex
                align="center"
                justify="center"
                style={{ flex: 1, minHeight: 0 }}
              >
                <SessionSetupInstructions />
              </Flex>
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
    <EmptyState
      icon={<IconDeviceLaptop size={32} />}
      title="Set up session replays"
      description={
        <>
          <Trans>
            Follow these steps to start recording and viewing session replays
            with the
          </Trans>{' '}
          {brandName} <Trans>Otel Collector.</Trans>
        </>
      }
      maw={600}
    >
      <Paper withBorder radius="md" p="xl">
        <Stepper active={-1} orientation="vertical" size="md">
          <Stepper.Step
            label={
              <>
                <Trans>Create a new source with</Trans>{' '}
                <Code>
                  <Trans>Session</Trans>
                </Code>{' '}
                <Trans>type</Trans>
              </>
            }
            description={
              <>
                <Trans>Go to Team Settings, click</Trans>{' '}
                <Code>
                  <Trans>Add Source</Trans>
                </Code>{' '}
                <Trans>under Sources section, and select</Trans>{' '}
                <Code>
                  <Trans>Session</Trans>
                </Code>{' '}
                <Trans>as the source type.</Trans>
              </>
            }
          />
          <Stepper.Step
            label={
              <>
                <Trans>Choose the</Trans>{' '}
                <Code>
                  <Trans>hyperdx_sessions</Trans>
                </Code>{' '}
                <Trans>table</Trans>
              </>
            }
            description={
              <>
                <Trans>Select the</Trans>{' '}
                <Code>
                  <Trans>hyperdx_sessions</Trans>
                </Code>{' '}
                <Trans>
                  table from the dropdown, and select the corresponding trace
                  source.
                </Trans>
              </>
            }
          />
          <Stepper.Step
            label="Start recording sessions"
            description={
              <>
                <Trans>Install the</Trans>{' '}
                <Anchor
                  href="https://clickhouse.com/docs/use-cases/observability/clickstack/sdks/browser"
                  target="_blank"
                  rel="noopener noreferrer"
                  size="xs"
                >
                  {brandName} <Trans>Browser Integration</Trans>
                </Anchor>{' '}
                <Trans>to start recording sessions.</Trans>
              </>
            }
          />
        </Stepper>
      </Paper>
    </EmptyState>
  );
}
