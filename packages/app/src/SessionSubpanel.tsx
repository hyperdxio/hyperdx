import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import throttle from 'lodash/throttle';
import { parseAsInteger, useQueryState } from 'nuqs';
import ReactDOM from 'react-dom';
import { useForm } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  ChartConfigWithOptDateRange,
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Portal,
  SegmentedControl,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsMinimize,
  IconPlayerPause,
  IconPlayerPlay,
  IconToggleLeft,
  IconToggleRight,
} from '@tabler/icons-react';

import DBRowSidePanel from '@/components/DBRowSidePanel';
import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';

import { SQLInlineEditorControlled } from './components/SQLInlineEditor';
import useFieldExpressionGenerator from './hooks/useFieldExpressionGenerator';
import DOMPlayer from './DOMPlayer';
import Playbar from './Playbar';
import SearchInputV2 from './SearchInputV2';
import { SessionEventList } from './SessionEventList';
import { FormatTime } from './useFormatTime';
import { formatmmss, useLocalStorage, usePrevious } from './utils';

import styles from '../styles/SessionSubpanelV2.module.scss';

const MemoPlaybar = memo(Playbar);

function useSessionChartConfigs({
  traceSource,
  rumSessionId,
  where,
  whereLanguage,
  start,
  end,
  tab,
}: {
  traceSource: TSource;
  rumSessionId: string;
  where: string;
  whereLanguage?: SearchConditionLanguage;
  start: Date;
  end: Date;
  tab: string;
}) {
  const { getFieldExpression: getTraceSourceFieldExpression } =
    useFieldExpressionGenerator(traceSource);

  // Should produce rows that match the `sessionRowSchema` in packages/app/src/utils/sessions.ts
  const select = useMemo(() => {
    if (!getTraceSourceFieldExpression) return [];
    return [
      {
        valueExpression: `${getTraceSourceFieldExpression(traceSource.eventAttributesExpression ?? 'SpanAttributes', 'message')}`,
        alias: 'body',
      },
      {
        valueExpression: `${getTraceSourceFieldExpression(traceSource.eventAttributesExpression ?? 'SpanAttributes', 'component')}`,
        alias: 'component',
      },
      {
        valueExpression: `toFloat64OrZero(toString(${traceSource.durationExpression})) * pow(10, 3) / pow(10, toInt8OrZero(toString(${traceSource.durationPrecision})))`,
        alias: 'durationInMs',
      },
      {
        valueExpression: `${getTraceSourceFieldExpression(traceSource.eventAttributesExpression ?? 'SpanAttributes', 'error.message')}`,
        alias: 'error.message',
      },
      {
        valueExpression: `${getTraceSourceFieldExpression(traceSource.eventAttributesExpression ?? 'SpanAttributes', 'http.method')}`,
        alias: 'http.method',
      },
      {
        valueExpression: `${getTraceSourceFieldExpression(traceSource.eventAttributesExpression ?? 'SpanAttributes', 'http.status_code')}`,
        alias: 'http.status_code',
      },
      {
        valueExpression: `${getTraceSourceFieldExpression(traceSource.eventAttributesExpression ?? 'SpanAttributes', 'http.url')}`,
        alias: 'http.url',
      },
      {
        // Using toString here because Javascript does not have the precision to accurately represent this
        valueExpression: `toString(cityHash64(${traceSource.traceIdExpression}, ${traceSource.parentSpanIdExpression}, ${traceSource.spanIdExpression}))`,
        alias: 'id',
      },
      {
        valueExpression: `${getTraceSourceFieldExpression(traceSource.eventAttributesExpression ?? 'SpanAttributes', 'location.href')}`,
        alias: 'location.href',
      },
      {
        valueExpression: 'ScopeName', // FIXME: add mapping
        alias: 'otel.library.name',
      },
      {
        valueExpression: `${traceSource.parentSpanIdExpression}`,
        alias: 'parent_span_id',
      },
      {
        valueExpression: `${traceSource.statusCodeExpression}`,
        alias: 'severity_text',
      },
      {
        valueExpression: `${traceSource.spanIdExpression}`,
        alias: 'span_id',
      },
      {
        valueExpression: `${traceSource.spanNameExpression}`,
        alias: 'span_name',
      },
      {
        valueExpression: `${traceSource.timestampValueExpression}`,
        alias: 'timestamp',
      },
      {
        valueExpression: `${traceSource.traceIdExpression}`,
        alias: 'trace_id',
      },
      {
        valueExpression: `CAST('span', 'String')`,
        alias: 'type',
      },
    ];
  }, [traceSource, getTraceSourceFieldExpression]);

  // Events shown in the highlighted tab
  const highlightedEventsFilter = useMemo(
    () => ({
      type: 'lucene' as const,
      condition: `${traceSource.resourceAttributesExpression}.rum.sessionId:"${rumSessionId}"
    AND (
      ${traceSource.eventAttributesExpression}.http.status_code:>299 
      OR ${traceSource.eventAttributesExpression}.component:"error" 
      OR ${traceSource.spanNameExpression}:"routeChange" 
      OR ${traceSource.spanNameExpression}:"documentLoad" 
      OR ${traceSource.spanNameExpression}:"intercom.onShow" 
      OR ScopeName:"custom-action" 
    )`,
    }),
    [traceSource, rumSessionId],
  );

  const allEventsFilter = useMemo(() => {
    if (!getTraceSourceFieldExpression) return undefined;
    return {
      type: 'lucene' as const,
      condition: `${traceSource.resourceAttributesExpression}.rum.sessionId:"${rumSessionId}"
    AND (
      ${traceSource.eventAttributesExpression}.http.status_code:* 
      OR ${traceSource.eventAttributesExpression}.component:"console" 
      OR ${traceSource.eventAttributesExpression}.component:"error" 
      OR ${traceSource.spanNameExpression}:"routeChange" 
      OR ${traceSource.spanNameExpression}:"documentLoad" 
      OR ${traceSource.spanNameExpression}:"intercom.onShow" 
      OR ScopeName:"custom-action" 
    )`,
    };
  }, [traceSource, rumSessionId, getTraceSourceFieldExpression]);

  const eventsConfig = useMemo<ChartConfigWithOptDateRange | undefined>(() => {
    if (!getTraceSourceFieldExpression || !select || !allEventsFilter)
      return undefined;
    return {
      select: select,
      from: traceSource.from,
      dateRange: [start, end],
      whereLanguage,
      where,
      timestampValueExpression: traceSource.timestampValueExpression,
      implicitColumnExpression: traceSource.implicitColumnExpression,
      connection: traceSource.connection,
      orderBy: `${traceSource.timestampValueExpression} ASC`,
      limit: {
        limit: 4000,
        offset: 0,
      },
      filters: [
        tab === 'highlighted' ? highlightedEventsFilter : allEventsFilter,
      ],
    };
  }, [
    select,
    traceSource,
    start,
    end,
    where,
    whereLanguage,
    tab,
    highlightedEventsFilter,
    allEventsFilter,
    getTraceSourceFieldExpression,
  ]);

  const aliasMap = useMemo(() => {
    if (!getTraceSourceFieldExpression) return undefined;
    // valueExpression: alias
    return select.reduce(
      (acc, { valueExpression, alias }) => {
        acc[alias] = valueExpression;
        return acc;
      },
      {} as Record<string, string>,
    );
  }, [select, getTraceSourceFieldExpression]);

  return {
    eventsConfig,
    aliasMap,
  };
}

export default function SessionSubpanel({
  traceSource,
  sessionSource,
  session,
  onPropertyAddClick,
  generateChartUrl,
  generateSearchUrl,
  setDrawerOpen,
  rumSessionId,
  start,
  end,
  initialTs,
  where,
  whereLanguage = 'lucene',
}: {
  traceSource: TSource;
  sessionSource: TSource;
  session: { serviceName: string };
  generateSearchUrl?: (query?: string, timeRange?: [Date, Date]) => string;
  generateChartUrl?: (config: {
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
  where?: SearchCondition;
  whereLanguage?: SearchConditionLanguage;
}) {
  const [rowId, setRowId] = useState<string | undefined>(undefined);
  const [aliasWith, setAliasWith] = useState<WithClause[]>([]);

  const [tsQuery, setTsQuery] = useQueryState(
    'ts',
    parseAsInteger.withOptions({ history: 'replace' }),
  );
  const prevTsQuery = usePrevious(tsQuery);

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
  const [_inputQuery, setInputQuery] = useState<string | undefined>(undefined);
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
  const [tab, setTab] = useState<string>('highlighted');

  // Playbar ====================================
  const [showRelativeTime, setShowRelativeTime] = useLocalStorage(
    'hdx-session-subpanel-show-relative-time',
    false,
  );
  const [playerSpeed, setPlayerSpeed] = useLocalStorage(
    'hdx-session-subpanel-player-speed',
    1,
  );
  const [skipInactive, setSkipInactive] = useLocalStorage(
    'hdx-session-subpanel-skip-inactive',
    true,
  );
  const [eventsFollowPlayerPosition, setEventsFollowPlayerPosition] =
    useLocalStorage('hdx-session-subpanel-events-follow-player-position', true);

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
    return [
      new Date(playerStartTs),
      new Date(playerEndTs),
    ] as DateRange['dateRange'];
  }, [playerStartTs, playerEndTs]);

  const { getFieldExpression: getSessionSourceFieldExpression } =
    useFieldExpressionGenerator(sessionSource);

  const { eventsConfig, aliasMap } = useSessionChartConfigs({
    traceSource,
    rumSessionId,
    where: searchedQuery,
    whereLanguage,
    start,
    end,
    tab,
  });

  const [playerFullWidth, setPlayerFullWidth] = useState(false);

  const handleSetPlayerSpeed = useCallback(() => {
    if (playerSpeed == 1) {
      setPlayerSpeed(2);
    } else if (playerSpeed == 2) {
      setPlayerSpeed(4);
    } else if (playerSpeed == 4) {
      setPlayerSpeed(8);
    } else if (playerSpeed == 8) {
      setPlayerSpeed(1);
    }
  }, [playerSpeed, setPlayerSpeed]);

  const minTs = playbackRange[0].getTime();
  const maxTs = playbackRange[1].getTime();

  const togglePlayerState = useCallback(() => {
    setPlayerState(state => (state === 'playing' ? 'paused' : 'playing'));
  }, [setPlayerState]);

  const skipBackward = useCallback(() => {
    setFocus({
      ts: Math.max((focus?.ts ?? minTs) - 15000, minTs),
      setBy: 'skip-backward',
    });
  }, [setFocus, focus?.ts, minTs]);

  const skipForward = useCallback(() => {
    setFocus({
      ts: Math.min((focus?.ts ?? minTs) + 15000, maxTs),
      setBy: 'skip-forward',
    });
  }, [setFocus, focus?.ts, minTs, maxTs]);

  const { control, handleSubmit } = useForm({
    values: {
      where: searchedQuery,
    },
  });
  const handleWhereSubmit = useCallback(
    (values: { where: string }) => {
      setSearchedQuery(values.where);
    },
    [setSearchedQuery],
  );
  const onSessionEventClick = useCallback(
    (rowWhere: RowWhereResult) => {
      setDrawerOpen(true);
      setRowId(rowWhere.where);
      setAliasWith(rowWhere.aliasWith);
    },
    [setDrawerOpen, setRowId, setAliasWith],
  );
  const onSessionEventTimeClick = useCallback(
    (ts: number) => {
      setFocus({ ts, setBy: 'timeline' });
    },
    [setFocus],
  );
  const setPlayerTime = useCallback(
    (ts: number) => {
      if (focus?.setBy !== 'player' || focus?.ts !== ts) {
        setFocus({ ts, setBy: 'player' });
      }
    },
    [focus, setFocus],
  );

  return (
    <div className={styles.wrapper}>
      {rowId != null && traceSource && (
        <Portal>
          <DBRowSidePanel
            source={traceSource}
            rowId={rowId}
            aliasWith={aliasWith}
            onClose={() => {
              setDrawerOpen(false);
              setRowId(undefined);
            }}
          />
        </Portal>
      )}
      <div className={cx(styles.eventList, { 'd-none': playerFullWidth })}>
        <div className={styles.eventListHeader}>
          <form
            style={{ zIndex: 100, width: '100%' }}
            onSubmit={handleSubmit(handleWhereSubmit)}
          >
            {whereLanguage === 'sql' ? (
              <SQLInlineEditorControlled
                tableConnection={tcFromSource(traceSource)}
                control={control}
                name="where"
                placeholder="SQL WHERE clause (ex. column = 'foo')"
                language="sql"
                size="xs"
                enableHotkey
                onSubmit={handleSubmit(handleWhereSubmit)}
              />
            ) : (
              <SearchInputV2
                tableConnection={tcFromSource(traceSource)}
                control={control}
                name="where"
                language="lucene"
                size="xs"
                placeholder="Search your events w/ Lucene ex. column:foo"
                enableHotkey
                onSubmit={handleSubmit(handleWhereSubmit)}
              />
            )}
          </form>
          <Group gap={6}>
            <SegmentedControl
              flex={1}
              size="xs"
              data={[
                { value: 'highlighted', label: 'Highlighted' },
                { value: 'events', label: 'All Events' },
              ]}
              value={tab}
              onChange={value => setTab(value)}
            />
            <Tooltip label="Sync with player position" color="gray">
              <ActionIcon
                size="md"
                color="gray"
                variant={eventsFollowPlayerPosition ? 'filled' : 'subtle'}
                onClick={() =>
                  setEventsFollowPlayerPosition(!eventsFollowPlayerPosition)
                }
              >
                <IconArrowsMinimize size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </div>

        {eventsConfig && aliasMap && (
          <SessionEventList
            eventsFollowPlayerPosition={eventsFollowPlayerPosition}
            aliasMap={aliasMap}
            queriedConfig={eventsConfig}
            onClick={onSessionEventClick}
            focus={focus}
            onTimeClick={onSessionEventTimeClick}
            minTs={minTs}
            showRelativeTime={showRelativeTime}
          />
        )}
      </div>

      <div className={styles.player}>
        {getSessionSourceFieldExpression && (
          <DOMPlayer
            playerState={playerState}
            setPlayerState={setPlayerState}
            focus={focus}
            setPlayerTime={setPlayerTime}
            config={{
              serviceName: session.serviceName,
              sourceId: sessionSource.id,
              sessionId: rumSessionId,
              dateRange: [start, end],
            }}
            playerSpeed={playerSpeed}
            skipInactive={skipInactive}
            setPlayerStartTimestamp={setPlayerStartTs}
            setPlayerEndTimestamp={setPlayerEndTs}
            setPlayerFullWidth={setPlayerFullWidth}
            playerFullWidth={playerFullWidth}
            resizeKey={`${playerFullWidth}`}
            getSessionSourceFieldExpression={getSessionSourceFieldExpression}
          />
        )}

        <div className={styles.playerPlaybar}>
          {eventsConfig && (
            <MemoPlaybar
              playerState={playerState}
              setPlayerState={setPlayerState}
              focus={focus}
              setFocus={setFocus}
              playbackRange={playbackRange}
              queriedConfig={eventsConfig}
            />
          )}
        </div>
        <div className={styles.playerToolbar}>
          <div className={styles.playerTimestamp}>
            <Tooltip label="Toggle relative time" color="gray">
              <Button
                variant="subtle"
                color="gray"
                onClick={() => setShowRelativeTime(!showRelativeTime)}
                size="compact-xs"
              >
                {showRelativeTime ? (
                  <>
                    {formatmmss((focus?.ts ?? 0) - minTs)}
                    <span className="fw-normal ms-2">
                      {' / '}
                      {formatmmss(maxTs - minTs)}
                    </span>
                  </>
                ) : (
                  <FormatTime value={focus?.ts || minTs} format="time" />
                )}
              </Button>
            </Tooltip>
          </div>
          <Group align="center" justify="center" gap="xs">
            <Tooltip label="Go 15 seconds back" color="gray">
              <ActionIcon
                variant="secondary"
                size="md"
                radius="xl"
                onClick={skipBackward}
                disabled={(focus?.ts || 0) <= minTs}
              >
                <IconArrowBackUp size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip
              label={playerState === 'playing' ? 'Pause' : 'Play'}
              color="gray"
            >
              <ActionIcon
                variant="secondary"
                size="lg"
                radius="xl"
                onClick={togglePlayerState}
              >
                {playerState === 'paused' ? (
                  <IconPlayerPlay size={20} />
                ) : (
                  <IconPlayerPause size={20} />
                )}
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Skip 15 seconds" color="gray">
              <ActionIcon
                variant="secondary"
                size="md"
                radius="xl"
                onClick={skipForward}
                disabled={(focus?.ts || 0) >= maxTs}
              >
                <IconArrowForwardUp size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Group align="center" justify="flex-end" gap="xs">
            <Button
              size="compact-sm"
              variant="secondary"
              fw="normal"
              rightSection={
                skipInactive ? (
                  <IconToggleLeft size={18} className="pe-1" />
                ) : (
                  <IconToggleRight size={18} className="pe-1" />
                )
              }
              onClick={() => setSkipInactive(!skipInactive)}
            >
              Skip Idle
              <Divider orientation="vertical" ml="sm" />
            </Button>
            <Button
              size="compact-sm"
              variant="secondary"
              fw="normal"
              rightSection={
                <span className="fw-bold pe-1">{playerSpeed}x</span>
              }
              onClick={handleSetPlayerSpeed}
            >
              Speed
              <Divider orientation="vertical" ml="sm" />
            </Button>
          </Group>
        </div>
      </div>
    </div>
  );
}
