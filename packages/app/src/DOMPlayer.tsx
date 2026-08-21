import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import throttle from 'lodash/throttle';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  ActionIcon,
  CopyButton,
  Group,
  HoverCard,
  Tooltip,
} from '@mantine/core';
import { Replayer } from '@rrweb/replay';
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconCheck,
  IconCopy,
  IconGlobe,
  IconLink,
  IconList,
  IconRefresh,
} from '@tabler/icons-react';

import { useRRWebEventStream } from '@/sessions';
import { useDebugMode } from '@/utils';
import {
  createRrwebChunkAssembler,
  RRWebStreamRow,
} from '@/utils/rrwebChunkAssembler';

import { FieldExpressionGenerator } from './hooks/useFieldExpressionGenerator';

import styles from '@styles/SessionSubpanelV2.module.scss';

function getPlayerCurrentTime(player: Replayer) {
  return Math.max(player.getCurrentTime(), 0); //getCurrentTime can be -startTime
}

const URLHoverCard = memo(({ url }: { url: string }) => {
  let parsedUrl: URL | undefined;
  try {
    parsedUrl = new URL(url);
  } catch {
    // ignore
  }

  let searchParams: { key: string; value: string }[] | undefined;
  try {
    const _searchParams = new URLSearchParams(parsedUrl?.search ?? '');
    searchParams = [];
    for (const [key, value] of _searchParams.entries()) {
      searchParams.push({ key, value });
    }
  } catch {
    // ignore
  }

  return (
    <HoverCard shadow="md" position="bottom-start">
      <HoverCard.Target>
        <div className={styles.playerHeaderUrl}>{url || 'Session Player'}</div>
      </HoverCard.Target>
      {url && (
        <HoverCard.Dropdown>
          <table className="table fs-8 mb-0">
            <tr>
              <td>
                <IconGlobe size={14} />
              </td>
              <td>{parsedUrl?.host}</td>
            </tr>
            <tr>
              <td>
                <IconLink size={14} />
              </td>
              <td>{parsedUrl?.pathname}</td>
            </tr>
            {searchParams &&
              searchParams.length > 0 &&
              searchParams.map(param => (
                <tr key={param.key}>
                  <td>
                    <strong>{param.key}</strong>
                  </td>
                  <td>{param.value}</td>
                </tr>
              ))}
          </table>
        </HoverCard.Dropdown>
      )}
    </HoverCard>
  );
});

export default function DOMPlayer({
  config: { dateRange, serviceName, sessionId, sourceId },
  focus,
  setPlayerTime,
  playerState,
  setPlayerState,
  playerSpeed,
  skipInactive,
  setPlayerStartTimestamp,
  setPlayerEndTimestamp,
  setPlayerFullWidth,
  playerFullWidth,
  resizeKey,
  getSessionSourceFieldExpression,
}: {
  config: {
    dateRange: [Date, Date];
    serviceName: string;
    sessionId: string;
    sourceId: string;
  };
  focus: { ts: number; setBy: string } | undefined;
  setPlayerTime: (ts: number) => void;
  playerState: 'playing' | 'paused';
  setPlayerState: (state: 'playing' | 'paused') => void;
  playerSpeed: number;
  setPlayerStartTimestamp?: (ts: number) => void;
  setPlayerEndTimestamp?: (ts: number) => void;
  skipInactive: boolean;
  resizeKey?: string;
  setPlayerFullWidth: (fullWidth: boolean) => void;
  playerFullWidth: boolean;
  getSessionSourceFieldExpression: FieldExpressionGenerator;
}) {
  const debug = useDebugMode();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const initialEventsRef = useRef<any[]>([]);

  const lastEventTsLoadedRef = useRef(0);
  const [lastEventTsLoaded, _setLastEventTsLoaded] = useState(0);
  const setLastEventTsLoadedRef = useRef(
    throttle(_setLastEventTsLoaded, 100, { leading: true, trailing: true }),
  );
  const [isInitialEventsLoaded, setIsInitialEventsLoaded] = useState(false);
  const [isReplayFullyLoaded, setIsReplayFullyLoaded] = useState(false);
  const [droppedEventCount, setDroppedEventCount] = useState(0);

  const handleDroppedEventRef = useRef<
    (error: unknown, context: unknown) => void
  >(() => {});
  handleDroppedEventRef.current = (error, context) => {
    // Surfaced unconditionally: dropped events (e.g. a dropped full snapshot)
    // can render the replay empty/unstyled with no other signal.
    // https://github.com/hyperdxio/hyperdx/issues/2569
    console.error('Failed to load session replay event', context, error);
    setDroppedEventCount(count => count + 1);
  };

  const handleParsedEventRef = useRef<(parsedEvent: any) => void>(() => {});
  handleParsedEventRef.current = (parsedEvent: any) => {
    if (replayerRef.current != null) {
      try {
        replayerRef.current.addEvent(parsedEvent);
      } catch (error) {
        handleDroppedEventRef.current(error, {
          reason: 'add-event-error',
          eventType: parsedEvent?.type,
        });
        return;
      }
    } else {
      if (
        setPlayerStartTimestamp != null &&
        initialEventsRef.current.length === 0
      ) {
        setPlayerStartTimestamp(parsedEvent.timestamp);
      }

      initialEventsRef.current.push(parsedEvent);
    }

    setLastEventTsLoadedRef.current(parsedEvent.timestamp);
    // Used for setting the player end timestamp on onEnd
    // we can't use state since the onEnd function is declared
    // at the beginning of the component lifecylce.
    // We can't use the rrweb metadata as it's not updated fast enough
    lastEventTsLoadedRef.current = parsedEvent.timestamp;
  };

  // Reassembles chunked rrweb events, one assembler instance per stream.
  // A replaced stream isn't reliably cancelled, so its callbacks can
  // interleave with the new stream's — even for identical query params
  // (e.g. switching away from a session and back while the first stream is
  // still loading). Isolation therefore can't be keyed on parameters; the
  // assembler instance doubles as the stream's identity:
  //  - buffer isolation: each stream's onEvent/onEnd closures are captured
  //    when the fetch starts, and useMemo hands every stream change a fresh
  //    instance (previous values aren't cached across dependency changes),
  //    so a stream ends and flushes only the assembler it captured;
  //  - delivery gating: only the active instance may feed the replayer or
  //    update player state, so a stale stream's events, errors, and
  //    completion can't pollute the replacement replay.
  //
  // streamKey must mirror useRRWebEventStream's internal queryKey exactly:
  // an assembler may only be replaced when the fetch is actually replaced,
  // otherwise the still-running stream fails the identity gate and its
  // remaining events are silently discarded. (The hook does not refetch on
  // serviceName/sourceId changes, so they must not be part of this key.)
  const streamKey = `${sessionId}|${dateRange[0].getTime()}|${dateRange[1].getTime()}`;
  const activeAssemblerRef = useRef<unknown>(null);
  const assembler = useMemo(() => {
    const instance = createRrwebChunkAssembler({
      onEvent: parsedEvent => {
        if (activeAssemblerRef.current === instance) {
          handleParsedEventRef.current(parsedEvent);
        }
      },
      onError: (error, info) => {
        if (activeAssemblerRef.current === instance) {
          handleDroppedEventRef.current(error, info);
        }
      },
    });
    return instance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey]);
  // Publish the active instance only after the render commits: a discarded
  // render must never re-point the gate at an assembler no committed stream
  // uses. Declared before useRRWebEventStream so it runs before the effect
  // that starts a replacement fetch.
  useEffect(() => {
    activeAssemblerRef.current = assembler;
  }, [assembler]);
  useEffect(() => {
    setDroppedEventCount(0);
  }, [streamKey]);

  const { isFetching: isSearchResultsFetching, abort } = useRRWebEventStream(
    {
      serviceName,
      sessionId,
      sourceId,
      startDate: dateRange[0],
      endDate: dateRange[1],
      limit: 1000000, // large enough to get all events
      onEvent: (event: RRWebStreamRow) => {
        assembler.push(event);

        if (
          activeAssemblerRef.current === assembler &&
          initialEventsRef.current.length > 5
        ) {
          setIsInitialEventsLoaded(true);
        }
      },
      onEnd: () => {
        // Flush the stream's own buffers, but only let the active stream
        // update player state — a stale stream finishing must not mark the
        // replacement replay as loaded or move its end timestamp.
        assembler.end();
        if (activeAssemblerRef.current !== assembler) {
          return;
        }
        setIsInitialEventsLoaded(true);
        setIsReplayFullyLoaded(true);

        if (setPlayerEndTimestamp != null) {
          if (replayerRef.current != null) {
            const endTime = lastEventTsLoadedRef.current;

            // Might want to merge with the below logic at some point, since
            // it's using a ts ref now
            setPlayerEndTimestamp(endTime ?? 0);
          } else {
            // If there's no events (empty replay session), there's no point in setting a timestamp
            if (initialEventsRef.current.length > 0) {
              setPlayerEndTimestamp(
                initialEventsRef.current[initialEventsRef.current.length - 1]
                  .timestamp ?? 0,
              );
            }
          }
        }
      },
      getSessionSourceFieldExpression,
    },
    {
      keepPreviousData: true,
      shouldAbortPendingRequest: true,
    },
  );

  // RRWeb Player Stuff ==============================
  const [lastHref, setLastHref] = useState('');

  const play = useCallback(() => {
    if (replayerRef.current != null) {
      try {
        replayerRef.current.play(getPlayerCurrentTime(replayerRef.current));
      } catch (e) {
        console.error(e);
      }
    }
  }, [replayerRef]);

  const pause = useCallback(
    (ts?: number) => {
      if (replayerRef.current != null) {
        try {
          replayerRef.current.pause(ts);
        } catch (e) {
          console.error(e);
        }
      }
    },
    [replayerRef],
  );

  useHotkeys(['space'], () => {
    if (playerState === 'playing') {
      setPlayerState('paused');
    } else if (playerState === 'paused') {
      setPlayerState('playing');
    }
  });

  // XXX: Hack to let requestAnimationFrame access the current setPlayerTime
  const setPlayerTimeRef = useRef(setPlayerTime);
  useEffect(() => {
    setPlayerTimeRef.current = setPlayerTime;
  }, [setPlayerTime]);

  const updatePlayerTimeRafRef = useRef(0);
  const updatePlayerTime = useCallback(() => {
    if (
      replayerRef.current != null &&
      replayerRef.current.service.state.matches('playing')
    ) {
      setPlayerTimeRef.current(
        Math.round(
          replayerRef.current.getMetaData().startTime +
            getPlayerCurrentTime(replayerRef.current),
        ),
      );
    }

    updatePlayerTimeRafRef.current = requestAnimationFrame(updatePlayerTime);
  }, []);

  // Update timestamp ui in timeline
  useEffect(() => {
    updatePlayerTimeRafRef.current = requestAnimationFrame(updatePlayerTime);
    return () => {
      cancelAnimationFrame(updatePlayerTimeRafRef.current);
    };
  }, [updatePlayerTime]);

  // Manage playback pause/play state, rrweb only
  useEffect(() => {
    if (replayerRef.current != null) {
      if (playerState === 'playing') {
        play();
      } else if (playerState === 'paused') {
        pause();
      }
    }
  }, [playerState, play, pause]);

  useEffect(() => {
    if (replayerRef.current != null) {
      if (playerState === 'playing') {
        pause();
        replayerRef.current?.setConfig({ speed: playerSpeed, skipInactive });
        play();
      } else if (playerState === 'paused') {
        replayerRef.current?.setConfig({ speed: playerSpeed, skipInactive });
      }
    }
  }, [playerState, playerSpeed, skipInactive, pause, play]);

  const handleResize = useCallback(() => {
    if (wrapperRef.current == null || playerContainerRef.current == null) {
      return;
    }

    playerContainerRef.current.style.transform = `scale(0.0001)`;

    window.requestAnimationFrame(() => {
      if (wrapperRef.current == null || playerContainerRef.current == null) {
        return;
      }

      const wrapperRect = wrapperRef.current.getBoundingClientRect();
      const playerWidth = replayerRef?.current?.iframe?.offsetWidth ?? 1280;
      const playerHeight = replayerRef?.current?.iframe?.offsetHeight ?? 720;

      const xScale = wrapperRect.width / playerWidth;
      const yScale = wrapperRect.height / playerHeight;
      playerContainerRef.current.style.transform = `scale(${Math.min(
        xScale,
        yScale,
      )})`;
    });
  }, [wrapperRef, playerContainerRef]);

  // Listen to window resizes to resize player
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);
  // Resize when something external changes our player size
  useEffect(() => {
    handleResize();
  }, [resizeKey, handleResize]);

  const [isReplayerInitialized, setIsReplayerInitialized] = useState(false);
  // Set up player
  useEffect(() => {
    if (
      // If we have no events yet, we can't mount yet.
      // (results ?? []).length == 0 ||
      initialEventsRef.current.length < 2 ||
      // Just skip if we're already enabled
      playerContainerRef.current == null ||
      replayerRef.current != null
    ) {
      return;
    }

    replayerRef.current = new Replayer(initialEventsRef.current, {
      root: playerContainerRef.current,
      mouseTail: true,
      pauseAnimation: false,
      showWarning: debug,
      skipInactive: true,
    });
    setIsReplayerInitialized(true);

    if (debug) {
      // @ts-expect-error this is for debugging purposes only
      window.__hdx_replayer = replayerRef.current;
    }

    replayerRef.current.enableInteract();
    replayerRef.current.on('event-cast', (e: any) => {
      try {
        // if this is an incremental update from a resize
        // OR if its a full snapshot `type=4`, we'll want to resize just in case
        // https://github.com/rrweb-io/rrweb/blob/07aa1b2807da5a9a1db678ebc3ff59320a300d06/packages/rrweb/src/record/index.ts#L447
        // https://github.com/rrweb-io/rrweb/blob/2a809499480ae4f7118432f09871c5f75fda06d7/packages/types/src/index.ts#L74
        if ((e?.type === 3 && e?.data?.source === 4) || e.type === 4) {
          setTimeout(() => {
            handleResize();
          }, 0);
        }
        if (e?.type === 4) {
          setLastHref(e.data.href);
        }
      } catch (e) {
        if (debug) {
          console.error(e);
        }
      }
    });

    // If we're supposed to be playing, let's start playing.
    if (
      playerState === 'playing' &&
      replayerRef.current.getMetaData().endTime > (focus?.ts ?? 0)
    ) {
      if (focus != null) {
        pause(focus.ts - replayerRef.current.getMetaData().startTime);
      }
      play();
    }

    // XXX: Yes this is a hugeee antipattern
    setTimeout(() => {
      handleResize();
    }, 0);
  }, [
    handleResize,
    // results,
    focus,
    pause,
    isInitialEventsLoaded,
    playerState,
    play,
    debug,
  ]);

  // Set player to the correct time based on focus
  useEffect(() => {
    if (
      !isInitialEventsLoaded ||
      !isReplayerInitialized ||
      lastEventTsLoaded < (focus?.ts ? focus.ts + 1000 : Infinity)
    ) {
      return;
    }
    if (focus?.setBy !== 'player' && replayerRef.current != null) {
      pause(
        focus?.ts == null
          ? 0
          : focus?.ts - replayerRef.current.getMetaData().startTime,
      );
      handleResize();
      if (playerState === 'playing') {
        play();
      }
    }
  }, [
    focus,
    pause,
    setPlayerState,
    playerState,
    play,
    isInitialEventsLoaded,
    isReplayerInitialized,
    handleResize,
    lastEventTsLoaded,
  ]);

  useEffect(() => {
    return () => {
      if (replayerRef.current != null) {
        replayerRef.current?.destroy();
        replayerRef.current = null;
      }
      abort();
    };
  }, [abort]);

  const isLoading = isInitialEventsLoaded === false && isSearchResultsFetching;
  // TODO: Handle when ts is set to a value that's outside of this session
  const isBuffering =
    isReplayFullyLoaded === false &&
    (replayerRef.current?.getMetaData()?.endTime ?? 0) < (focus?.ts ?? 0);

  useEffect(() => {
    // If we're trying to play, but the player is paused
    // try to play again if we've loaded the event we're trying to play
    // this is relevant when you click or load on a timestamp that hasn't loaded yet
    if (
      replayerRef.current != null &&
      focus != null &&
      replayerRef.current.getMetaData().endTime > focus.ts &&
      playerState === 'playing' &&
      replayerRef.current?.service?.state?.matches('paused')
    ) {
      pause(focus.ts - replayerRef.current.getMetaData().startTime);
      play();
    }
  }, [lastEventTsLoaded, focus, playerState, pause, play]);

  return (
    <>
      <div className={styles.playerHeader}>
        <ActionIcon
          onClick={() => setPlayerFullWidth(!playerFullWidth)}
          size="sm"
          color="gray"
        >
          {playerFullWidth ? (
            <IconList size={14} />
          ) : (
            <IconArrowsMaximize size={14} />
          )}
        </ActionIcon>
        <CopyButton value={lastHref}>
          {({ copied, copy }) => (
            <>
              <URLHoverCard url={lastHref} />
              <ActionIcon
                onClick={copy}
                title="Copy URL"
                variant="secondary"
                size="sm"
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </ActionIcon>
            </>
          )}
        </CopyButton>
        {droppedEventCount > 0 && (
          <Tooltip
            label={`${droppedEventCount} replay ${
              droppedEventCount === 1 ? 'event' : 'events'
            } could not be decoded — replay may be incomplete`}
            withArrow
          >
            <IconAlertTriangle
              size={14}
              color="var(--mantine-color-yellow-6)"
              data-testid="replay-dropped-events-warning"
            />
          </Tooltip>
        )}
      </div>

      <div className={styles.playerContainer}>
        {isLoading || isBuffering ? (
          <Group align="center" justify="center" gap="xs">
            <IconRefresh className="spin-animate" size={14} />
            {isBuffering ? 'Buffering to time...' : 'Loading replay...'}
          </Group>
        ) : isReplayFullyLoaded && replayerRef.current == null ? (
          <div className="text-center">
            No replay available for this session, most likely due to this
            session starting and ending in a background tab.
          </div>
        ) : null}
        <div
          ref={wrapperRef}
          className={cx(styles.domPlayerWrapper, 'overflow-hidden', {
            'd-none': isLoading || isBuffering,
            started: (replayerRef.current?.getCurrentTime() ?? 0) > 0,
            [styles.domPlayerWrapperPaused]: playerState === 'paused',
          })}
        >
          <div className="player rr-block" ref={playerContainerRef} />
        </div>
      </div>
    </>
  );
}
