import { useCallback, useEffect, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Replayer } from 'rrweb';
import { throttle } from 'lodash';
import cx from 'classnames';

import { useSearchEventStream } from './search';
import { useRouter } from 'next/router';
import { useDebugMode } from './utils';

function getPlayerCurrentTime(player: Replayer) {
  return Math.max(player.getCurrentTime(), 0); //getCurrentTime can be -startTime
}

export default function DOMPlayer({
  config: { sessionId, dateRange },
  focus,
  setPlayerTime,
  playerState,
  setPlayerState,
  playerSpeed,
  skipInactive,
  setPlayerStartTimestamp,
  setPlayerEndTimestamp,
  resizeKey,
}: {
  config: {
    sessionId: string;
    dateRange: [Date, Date];
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
}) {
  const debug = useDebugMode();
  const wrapper = useRef<HTMLDivElement>(null);
  const playerContainer = useRef<HTMLDivElement>(null);
  const replayer = useRef<Replayer | null>(null);
  const initialEvents = useRef<any[]>([]);

  const lastEventTsLoadedRef = useRef(0);
  const [lastEventTsLoaded, _setLastEventTsLoaded] = useState(0);
  const setLastEventTsLoaded = useRef(
    throttle(_setLastEventTsLoaded, 100, { leading: true, trailing: true }),
  );
  const [isInitialEventsLoaded, setIsInitialEventsLoaded] = useState(false);
  const [isReplayFullyLoaded, setIsReplayFullyLoaded] = useState(false);

  let currentRrwebEvent = '';

  const { isFetching: isSearchResultsFetching } = useSearchEventStream(
    {
      apiUrlPath: `/sessions/${sessionId}/rrweb`,
      q: '',
      startDate: dateRange?.[0] ?? new Date(),
      endDate: dateRange?.[1] ?? new Date(),
      extraFields: [],
      order: 'asc', // hardcoded at the api side. doesn't matter here
      limit: 1000000, // large enough to get all events
      onEvent: (event: { b: string; ck: number; tcks: number; t: number }) => {
        try {
          const { b: body, ck: chunk, tcks: totalChunks, t: type } = event;
          currentRrwebEvent += body;
          if (!chunk || chunk === totalChunks) {
            const parsedEvent = JSON.parse(currentRrwebEvent);

            if (replayer.current != null) {
              replayer.current.addEvent(parsedEvent);
            } else {
              if (
                setPlayerStartTimestamp != null &&
                initialEvents.current.length === 0
              ) {
                setPlayerStartTimestamp(parsedEvent.timestamp);
              }

              initialEvents.current.push(parsedEvent);
            }

            setLastEventTsLoaded.current(parsedEvent.timestamp);
            // Used for setting the player end timestamp on onEnd
            // we can't use state since the onEnd function is declared
            // at the beginning of the component lifecylce.
            // We can't use the rrweb metadata as it's not updated fast enough
            lastEventTsLoadedRef.current = parsedEvent.timestamp;

            currentRrwebEvent = '';
          }
        } catch (e) {
          if (debug) {
            console.error(e);
          }

          currentRrwebEvent = '';
        }

        if (initialEvents.current.length > 5) {
          setIsInitialEventsLoaded(true);
        }
      },
      onEnd: () => {
        setIsInitialEventsLoaded(true);
        setIsReplayFullyLoaded(true);

        if (setPlayerEndTimestamp != null) {
          if (replayer.current != null) {
            const endTime = lastEventTsLoadedRef.current;

            // Might want to merge with the below logic at some point, since
            // it's using a ts ref now
            setPlayerEndTimestamp(endTime ?? 0);
          } else {
            // If there's no events (empty replay session), there's no point in setting a timestamp
            if (initialEvents.current.length > 0) {
              setPlayerEndTimestamp(
                initialEvents.current[initialEvents.current.length - 1]
                  .timestamp ?? 0,
              );
            }
          }
        }
      },
    },
    {
      enabled: dateRange != null,
      keepPreviousData: true, // TODO: support streaming
      shouldAbortPendingRequest: true,
    },
  );

  // RRWeb Player Stuff ==============================
  const [lastHref, setLastHref] = useState('');

  const play = useCallback(() => {
    if (replayer.current != null) {
      try {
        replayer.current.play(getPlayerCurrentTime(replayer.current));
      } catch (e) {
        console.error(e);
      }
    }
  }, [replayer]);

  const pause = useCallback(
    (ts?: number) => {
      if (replayer.current != null) {
        try {
          replayer.current.pause(ts);
        } catch (e) {
          console.error(e);
        }
      }
    },
    [replayer],
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
  const updatePlayerTime = () => {
    if (
      replayer.current != null &&
      replayer.current.service.state.matches('playing')
    ) {
      setPlayerTimeRef.current(
        Math.round(
          replayer.current.getMetaData().startTime +
            getPlayerCurrentTime(replayer.current),
        ),
      );
    }

    updatePlayerTimeRafRef.current = requestAnimationFrame(updatePlayerTime);
  };

  // Update timestamp ui in timeline
  useEffect(() => {
    updatePlayerTimeRafRef.current = requestAnimationFrame(updatePlayerTime);
    return () => {
      cancelAnimationFrame(updatePlayerTimeRafRef.current);
    };
  }, []);

  // Manage playback pause/play state, rrweb only
  useEffect(() => {
    if (replayer.current != null) {
      if (playerState === 'playing') {
        play();
      } else if (playerState === 'paused') {
        pause();
      }
    }
  }, [playerState, play, pause]);

  useEffect(() => {
    if (replayer.current != null) {
      if (playerState === 'playing') {
        pause();
        replayer.current?.setConfig({ speed: playerSpeed, skipInactive });
        play();
      } else if (playerState === 'paused') {
        replayer.current?.setConfig({ speed: playerSpeed, skipInactive });
      }
    }
  }, [playerState, playerSpeed, skipInactive]);

  // Set player to the correct time based on focus
  useEffect(() => {
    if (focus?.setBy !== 'player' && replayer.current != null) {
      pause(
        focus?.ts == null
          ? 0
          : focus?.ts - replayer.current.getMetaData().startTime,
      );
      if (playerState === 'playing') {
        play();
      }
    }
  }, [focus, pause, setPlayerState, playerState, play]);

  const handleResize = useCallback(() => {
    if (wrapper.current == null || playerContainer.current == null) {
      return;
    }

    const wrapperRect = wrapper.current.getBoundingClientRect();
    const playerWidth = replayer?.current?.iframe?.offsetWidth ?? 1280;
    const playerHeight = replayer?.current?.iframe?.offsetHeight ?? 720;

    const xScale = wrapperRect.width / playerWidth;
    const yScale = wrapperRect.height / playerHeight;
    playerContainer.current.style.transform = `scale(${Math.min(
      xScale,
      yScale,
    )})`;
  }, [wrapper, playerContainer]);

  // Listen to window resizes to resize player
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);
  // Resize when something external changes our player size
  useEffect(() => {
    handleResize();
  }, [resizeKey, handleResize]);

  // Set up player
  useEffect(() => {
    if (
      // If we have no events yet, we can't mount yet.
      initialEvents.current.length < 2 ||
      // Just skip if we're already enabled
      playerContainer.current == null ||
      replayer.current != null
    ) {
      return;
    }

    replayer.current = new Replayer(initialEvents.current, {
      root: playerContainer.current,
      mouseTail: false,
      pauseAnimation: false,
      showWarning: debug,
      skipInactive: true,
    });

    if (debug) {
      // @ts-ignore
      window.__hdx_replayer = replayer.current;
    }

    replayer.current.enableInteract();
    replayer.current.on('event-cast', (e: any) => {
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
      replayer.current.getMetaData().endTime > (focus?.ts ?? 0)
    ) {
      if (focus != null) {
        pause(focus.ts - replayer.current.getMetaData().startTime);
      }
      play();
    }

    // XXX: Yes this is a hugeee antipattern
    setTimeout(() => {
      handleResize();
    }, 0);
  }, [
    handleResize,
    focus,
    pause,
    isInitialEventsLoaded,
    playerState,
    play,
    debug,
  ]);

  useEffect(() => {
    return () => {
      if (replayer.current != null) {
        replayer.current?.destroy();
        replayer.current = null;
      }
    };
  }, []);

  const isLoading = isInitialEventsLoaded === false && isSearchResultsFetching;
  // TODO: Handle when ts is set to a value that's outside of this session
  const isBuffering =
    playerState === 'playing' &&
    isReplayFullyLoaded === false &&
    (replayer.current?.getMetaData()?.endTime ?? 0) < (focus?.ts ?? 0);

  useEffect(() => {
    // If we're trying to play, but the player is paused
    // try to play again if we've loaded the event we're trying to play
    // this is relevant when you click or load on a timestamp that hasn't loaded yet
    if (
      replayer.current != null &&
      focus != null &&
      replayer.current.getMetaData().endTime > focus.ts &&
      playerState === 'playing' &&
      replayer.current?.service?.state?.matches('paused')
    ) {
      pause(focus.ts - replayer.current.getMetaData().startTime);
      play();
    }
  }, [lastEventTsLoaded, focus, playerState, pause, play]);

  return (
    <div>
      {lastHref != '' && (
        <div className="bg-dark rounded p-2 mb-2">{lastHref}</div>
      )}
      {(isLoading || isBuffering) && (
        <div
          className="d-flex align-items-center justify-content-center"
          style={{ minHeight: 300 }}
        >
          <div className="text-center">
            <div className="spinner-border" role="status" />
            <div className="mt-2">
              {isBuffering ? 'Buffering to time...' : 'Loading replay...'}
            </div>
          </div>
        </div>
      )}
      {isReplayFullyLoaded && replayer.current == null && (
        <div className="d-flex align-items-center justify-content-center bg-hdx-dark p-4 text-center text-muted">
          No replay available for this session, most likely due to this session
          starting and ending in a background tab.
        </div>
      )}
      <div
        ref={wrapper}
        className={cx('player-wrapper overflow-hidden', {
          'd-none': isLoading || isBuffering,
          started: (replayer.current?.getCurrentTime() ?? 0) > 0,
        })}
      >
        <div
          className="player rr-block"
          ref={playerContainer}
          style={{
            transformOrigin: '0 0',
          }}
        />
      </div>
    </div>
  );
}
