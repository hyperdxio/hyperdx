import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { sub } from 'date-fns';
import {
  parseAsFloat,
  parseAsString,
  parseAsStringEnum,
  useQueryStates,
} from 'nuqs';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { buildSearchChartConfig } from '@hyperdx/common-utils/dist/core/searchChartConfig';
import {
  BuilderChartConfigWithDateRange,
  Filter,
  FilterSchema,
  SearchCondition,
  SearchConditionLanguage,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Anchor,
  Button,
  Code,
  Flex,
  Group,
  Paper,
  Stepper,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowBarToRight,
  IconDeviceLaptop,
  IconPlayerPlay,
  IconRefresh,
} from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { ActiveFilterPills } from '@/components/ActiveFilterPills';
import EmptyState from '@/components/EmptyState';
import { ErrorBoundary } from '@/components/Error/ErrorBoundary';
import { PageHeader } from '@/components/PageHeader';
import { PageLayout } from '@/components/PageLayout';
import { SessionFilters } from '@/components/SessionFilters';
import { SourceSelectControlled } from '@/components/SourceSelect';
import { TimePicker } from '@/components/TimePicker';
import { useDashboardRefresh } from '@/hooks/useDashboardRefresh';
import { useColumns, useResolvedDateTimeColumns } from '@/hooks/useMetadata';
import { useResolvedSourceParam } from '@/hooks/useResolvedSourceParam';
import { useSearchPageFilterState } from '@/searchFilters';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

import OnboardingModal from './components/OnboardingModal';
import SearchWhereInput, {
  getStoredLanguage,
} from './components/SearchInput/SearchWhereInput';
import { useBrandDisplayName } from './theme/ThemeProvider';
import { parseAsJsonEncoded } from './utils/queryParsers';
import { withAppNav } from './layout';
import { Session, useSessions } from './sessions';
import SessionSidePanel from './SessionSidePanel';
import { useSource, useSources } from './source';
import { FormatTime } from './useFormatTime';
import { formatDistanceToNowStrictShort, useLocalStorage } from './utils';

import searchPageStyles from '@styles/SearchPage.module.scss';
import styles from '@styles/SessionsPage.module.scss';

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

// Clicks inside the session list keep the session side panel open (so users can
// scroll or pick a different session); clicks anywhere else dismiss it.
const SESSION_LIST_KEEP_OPEN_SELECTOR = '[data-testid="session-card-list"]';

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];
const selectedSessionQueryStateMap = {
  sid: parseAsString,
  sfrom: parseAsFloat,
  sto: parseAsFloat,
};
const appliedConfigMap = {
  sessionSource: parseAsString,
  where: parseAsString.withDefault(''),
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
  // Validate the shape: a stale/hand-edited `?filters=5`/`{}`/`"x"` is valid
  // JSON but not `Filter[]`, and would throw "not iterable" when spread into
  // the chart config during render. Rejecting the wrong shape resolves it to
  // the `[]` default instead of white-screening the page.
  filters: parseAsJsonEncoded<Filter[]>(v =>
    z.array(FilterSchema).parse(v),
  ).withDefault([]),
};
function SessionsPage() {
  const brandName = useBrandDisplayName();
  const [appliedConfig, setAppliedConfig] = useQueryStates(appliedConfigMap);
  // `?sessionSource=` accepts a source name as well as a source ID. The form
  // holds the resolved ID, so nothing downstream ever sees a name.
  const { source: paramSource } = useResolvedSourceParam(
    appliedConfig.sessionSource,
    { kinds: [SourceKind.Session] },
  );

  const { control, setValue, handleSubmit } = useForm({
    values: {
      where: appliedConfig.where,
      whereLanguage:
        appliedConfig.whereLanguage ?? getStoredLanguage() ?? 'lucene',
      source: paramSource?.id ?? null,
      filters: appliedConfig.filters ?? [],
    },
  });

  const where = useWatch({ control, name: 'where' });
  const whereLanguage = useWatch({ control, name: 'whereLanguage' });
  const sourceId = useWatch({ control, name: 'source' });
  // `isLoading` rather than `isPending`: with no source selected the query is
  // disabled, and a disabled query is pending forever — which would render the
  // spinner in place of the setup instructions.
  const { data: sessionSource, isLoading: isSessionSourceLoading } = useSource({
    id: sourceId,
    kinds: [SourceKind.Session],
  });

  const { data: traceTrace } = useSource({
    id: sessionSource?.traceSourceId,
    kinds: [SourceKind.Trace],
  });

  // Get all sources and select the first session type source by default
  const { data: sources } = useSources();

  // Push the selected source into the param when it isn't there yet, and
  // canonicalize a source name URL Param to the ID it resolved to.
  const syncSourceParam = useEffectEvent((formSource: string | null) => {
    if (formSource && formSource !== appliedConfig.sessionSource) {
      setAppliedConfig({ sessionSource: formSource });
    }
  });
  useEffect(() => {
    syncSourceParam(sourceId);
  }, [sourceId]);

  // Auto-select the first session source when the page loads
  useEffect(() => {
    if (sources && sources.length > 0 && !appliedConfig.sessionSource) {
      // Find the first enabled session source
      const sessionSource = sources.find(
        source => source.kind === SourceKind.Session && !source.disabled,
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

  const { searchedTimeRange, onSearch, onTimeRangeSelect } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  const { refresh, manualRefreshCooloff } = useDashboardRefresh({
    searchedTimeRange,
    onTimeRangeSelect,
    isLive: false,
  });

  const onSubmit = useCallback(() => {
    onSearch(displayedTimeInputValue);
    handleSubmit(values => {
      const { source, ...rest } = values;
      setAppliedConfig({ sessionSource: source, ...rest });
    })();
  }, [handleSubmit, setAppliedConfig, onSearch, displayedTimeInputValue]);

  // The sidebar filters run against the trace source, so its columns are what
  // we quote against and read DateTime types from.
  const { data: traceColumns } = useColumns(
    {
      databaseName: traceTrace?.from?.databaseName ?? '',
      tableName: traceTrace?.from?.tableName ?? '',
      connectionId: traceTrace?.connection ?? '',
    },
    { enabled: !!traceTrace },
  );
  const knownColumns = useMemo(
    () =>
      traceColumns ? new Set(traceColumns.map(c => c.name)) : new Set<string>(),
    [traceColumns],
  );
  const { dateTimeColumns } = useResolvedDateTimeColumns(traceColumns);

  // Applying a facet filter re-runs the query immediately (against the current
  // time range), mirroring the search page's debounced auto-submit.
  const handleSetFilters = useCallback(
    (newFilters: Filter[]) => {
      setValue('filters', newFilters);
      setAppliedConfig({ filters: newFilters });
    },
    [setValue, setAppliedConfig],
  );

  const filters = useWatch({ control, name: 'filters' });
  const searchFilters = useSearchPageFilterState({
    searchQuery: filters ?? undefined,
    onFilterChange: handleSetFilters,
    dateTimeColumns,
    knownColumns,
  });

  // Chart config used by the filters sidebar to fetch facet values and
  // distributions. Scoped to the trace source with the currently applied
  // where + filters so counts reflect the filtered set.
  const filtersChartConfig = useMemo<BuilderChartConfigWithDateRange>(() => {
    const overrides = { dateRange: searchedTimeRange } as const;
    if (traceTrace == null) {
      return {
        timestampValueExpression: '',
        connection: '',
        from: { databaseName: '', tableName: '' },
        where: '',
        select: '',
        ...overrides,
      };
    }
    // Scope facets to RUM session spans only. Without this the facet sidebar
    // queries the entire trace table (all services, tens of millions of spans),
    // which times out and leaves the sidebar empty. The `indexHint` lets the
    // `rum.sessionId` skip index prune to just the session rows. This is applied
    // as an always-on SQL filter alongside the user's search + facet selections.
    const rumSessionIdKey = `${traceTrace.resourceAttributesExpression}['rum.sessionId']`;
    const rumScopeFilter: Filter = {
      type: 'sql',
      condition: `notEmpty(${rumSessionIdKey}) AND indexHint(mapContains(${traceTrace.resourceAttributesExpression}, 'rum.sessionId'))`,
    };
    const config = buildSearchChartConfig(traceTrace, {
      where: appliedConfig.where,
      whereLanguage:
        (appliedConfig.whereLanguage as SearchConditionLanguage) ?? 'lucene',
      filters: [rumScopeFilter, ...(appliedConfig.filters ?? [])],
    });
    return { ...config, ...overrides };
  }, [
    traceTrace,
    appliedConfig.where,
    appliedConfig.whereLanguage,
    appliedConfig.filters,
    searchedTimeRange,
  ]);

  const [isFilterSidebarCollapsed, setIsFilterSidebarCollapsed] =
    useLocalStorage<boolean>('isSessionsFilterSidebarCollapsed', false);

  // Auto submit when the source changes. Compared against the *resolved* param
  // only: while `?sessionSource=` is still resolving — or when it names no
  // source at all — there is nothing for the form to have diverged from, and
  // submitting would write the empty form source over the param (losing both the
  // link and the "Source not found" warning) and reset the searched time range.
  const submitOnSourceChange = useEffectEvent(() => {
    if (sourceId !== (paramSource?.id ?? null)) {
      onSubmit();
    }
  });
  useEffect(() => {
    submitOnSourceChange();
  }, [sourceId]);

  const [selectedSessionQuery, setSelectedSessionQuery] = useQueryStates(
    selectedSessionQueryStateMap,
    {
      history: 'push',
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
  }, [
    selectedSessionQuery.sid,
    selectedSessionQuery.sfrom,
    selectedSessionQuery.sto,
  ]);
  const setSelectedSession = useCallback(
    (session: Session | undefined) => {
      if (session == null) {
        setSelectedSessionQuery({
          sid: null,
          sfrom: null,
          sto: null,
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
    filters: appliedConfig.filters ?? undefined,
  });

  const sessions = tableData?.data ?? [];
  const targetSession = sessions.find(s => s.sessionId === selectedSession?.id);

  // Whether the user has an explicit query or filter applied. When they do, an
  // empty result set means "no matches" rather than "not set up yet", so we
  // show the results list (with its own empty state) instead of the setup
  // instructions.
  const hasActiveSearch =
    !!appliedConfig.where || (appliedConfig.filters?.length ?? 0) > 0;

  return (
    <>
      <Head>
        <title>Client Sessions - {brandName}</title>
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
            keepOpenSelector={SESSION_LIST_KEEP_OPEN_SELECTOR}
            whereLanguage={whereLanguage || undefined}
            where={where || undefined}
            onLanguageChange={lang =>
              setAppliedConfig(prev => ({ ...prev, whereLanguage: lang }))
            }
          />
        )}
      <form
        className={`SessionsPage ${styles.pageForm}`}
        data-testid="sessions-search-form"
        onSubmit={e => {
          e.preventDefault();
          onSubmit();
          return false;
        }}
      >
        <PageLayout
          data-testid="sessions-page"
          header={
            <PageHeader>
              <Group
                justify="space-between"
                gap="xs"
                wrap="nowrap"
                w="100%"
                className={styles.toolbar}
              >
                <SourceSelectControlled
                  control={control}
                  name="source"
                  allowedSourceKinds={[SourceKind.Session]}
                  // Portal the dropdown to the body so it renders above the
                  // filter sidebar, which sits in its own `z-index` stacking
                  // context and would otherwise clip/cover the inline menu.
                  comboboxProps={{ withinPortal: true }}
                />
                <SearchWhereInput
                  tableConnection={tcFromSource(traceTrace)}
                  // The WHERE runs against the trace source
                  sourceId={traceTrace?.id}
                  dateRange={searchedTimeRange}
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
                  Run
                </Button>
                <Tooltip withArrow label="Refresh results" fz="xs" color="gray">
                  <ActionIcon
                    onClick={refresh}
                    loading={manualRefreshCooloff}
                    disabled={manualRefreshCooloff}
                    variant="secondary"
                    title="Refresh results"
                    size="input-sm"
                  >
                    <IconRefresh size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </PageHeader>
          }
          content={
            <div
              className={searchPageStyles.searchPageContainer}
              style={{ minHeight: 0, height: '100%' }}
            >
              {sessionSource != null &&
                traceTrace != null &&
                !isFilterSidebarCollapsed && (
                  <ErrorBoundary message="Unable to render session filters">
                    <SessionFilters
                      chartConfig={filtersChartConfig}
                      sourceId={traceTrace.id}
                      onCollapse={() => setIsFilterSidebarCollapsed(true)}
                      {...searchFilters}
                    />
                  </ErrorBoundary>
                )}
              <Flex
                direction="column"
                p="sm"
                style={{ flex: 1, minWidth: 0, minHeight: 0 }}
              >
                <Group gap={4} align="center" wrap="nowrap">
                  {isFilterSidebarCollapsed && (
                    <Tooltip label="Show filters" position="bottom">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={() => setIsFilterSidebarCollapsed(false)}
                        aria-label="Show filters"
                      >
                        <IconArrowBarToRight size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <ActiveFilterPills
                    searchFilters={searchFilters}
                    chartConfig={filtersChartConfig}
                    dateTimeColumns={dateTimeColumns}
                    style={{ flex: 1 }}
                  />
                </Group>
                {isSessionsLoading || isSessionSourceLoading ? (
                  <Group mt="md" align="center" justify="center" gap="xs">
                    <IconRefresh className="spin-animate" size={14} />
                    {isSessionSourceLoading
                      ? 'Loading...'
                      : 'Searching sessions...'}
                  </Group>
                ) : !sessions.length && !hasActiveSearch ? (
                  <Flex
                    align="center"
                    justify="center"
                    style={{ flex: 1, minHeight: 0 }}
                  >
                    <SessionSetupInstructions />
                  </Flex>
                ) : (
                  <div
                    style={{ flex: 1, minHeight: 0 }}
                    data-testid="session-card-list"
                  >
                    <SessionCardList
                      onClick={session => {
                        setSelectedSession(session);
                      }}
                      sessions={sessions}
                      isSessionLoading={isSessionsLoading}
                    />
                  </div>
                )}
              </Flex>
            </div>
          }
        />
      </form>
    </>
  );
}

const SessionsPageDynamic = dynamic(async () => SessionsPage, {
  ssr: false,
});

// @ts-expect-error for getLayout
SessionsPageDynamic.getLayout = withAppNav;

export default SessionsPageDynamic;

function SessionSetupInstructions() {
  const brandName = useBrandDisplayName();
  return (
    <EmptyState
      icon={<IconDeviceLaptop size={32} />}
      title="Set up session replays"
      description={
        <>
          Follow these steps to start recording and viewing session replays with
          the {brandName} Otel Collector.
        </>
      }
      maw={600}
    >
      <Paper withBorder radius="md" p="xl">
        <Stepper active={-1} orientation="vertical" size="md">
          <Stepper.Step
            label={
              <>
                Create a new source with <Code>Session</Code> type
              </>
            }
            description={
              <>
                Go to Team Settings, click <Code>Add Source</Code> under Sources
                section, and select <Code>Session</Code> as the source type.
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
                  size="xs"
                >
                  {brandName} Browser Integration
                </Anchor>{' '}
                to start recording sessions.
              </>
            }
          />
        </Stepper>
      </Paper>
    </EmptyState>
  );
}
