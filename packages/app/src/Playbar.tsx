import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import throttle from 'lodash/throttle';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import Button from 'react-bootstrap/Button';
import ReactSlider from 'react-slider';

import Checkbox from './Checkbox';
import { useSessionEvents } from './sessionUtils';
import { getShortUrl, truncateText, useLocalStorage } from './utils';

import 'react-bootstrap-range-slider/dist/react-bootstrap-range-slider.css';

function formatTs({
  ts,
  minTs,
  showRelativeTime,
}: {
  ts: number | null | undefined;
  minTs: number;
  showRelativeTime: boolean;
}) {
  if (ts == null) {
    return '--:--';
  } else if (showRelativeTime) {
    const value = Math.max(ts - minTs, 0);
    const minutes = Math.floor(value / 1000 / 60);
    const seconds = Math.floor((value / 1000) % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  } else {
    try {
      return format(new Date(ts), 'hh:mm:ss a');
    } catch (err) {
      console.error(err, ts);
      return '--:--';
    }
  }
}

function Track({
  props,
  state,
  minSliderVal,
  maxSliderVal,
  showRelativeTime,
}: {
  props: any;
  state: any;
  minSliderVal: number;
  maxSliderVal: number;
  showRelativeTime: boolean;
}) {
  const thumbWidth = 18;

  const container = useRef<HTMLDivElement>(null);
  const tracker = useRef<HTMLDivElement>(null);
  const [track0MouseXPerc, setTrack0MouseXPerc] = useState<
    undefined | number
  >();
  const [mouseHovered, setMouseHovered] = useState(false);
  const [mouseTs, setMouseTs] = useState<number | undefined>();

  const debouncedMouseMove = useMemo(
    () =>
      throttle(e => {
        const rect = container.current?.getBoundingClientRect();
        if (rect == null) return;

        // https://github.com/zillow/react-slider/blob/master/src/components/ReactSlider/ReactSlider.jsx#L749
        // For some reason we need to subtract half of thumb width here to match
        // the react slider logic
        const x = e.clientX - rect.left - thumbWidth / 2;
        // Subtract by thumb width as the thumb width is added to each track
        const xPerc = x / (rect.width - thumbWidth);

        const segmentTimespan =
          state.index === 0
            ? state.value - minSliderVal
            : maxSliderVal - state.value;

        const newMouseTs =
          segmentTimespan * xPerc +
          (state.index === 0 ? minSliderVal : state.value);

        setMouseTs(newMouseTs);
        setTrack0MouseXPerc(xPerc);
      }, 100),
    [minSliderVal, state.value, state.index, maxSliderVal],
  );

  return (
    <div
      {...props}
      className={
        state.index === 0
          ? 'bg-success rounded-pill rounded-end top-0 bottom-0'
          : 'bg-grey rounded-pill rounded-start top-0 bottom-0'
      }
      key={`track-${state.index}`}
      onMouseMove={debouncedMouseMove}
      ref={container}
      onMouseEnter={() => setMouseHovered(true)}
      onMouseLeave={() => setMouseHovered(false)}
    >
      <div
        ref={tracker}
        style={{
          width: `${(track0MouseXPerc ?? 0) * 100}%`,
          height: '100%',
          position: 'relative',
          top: '-15px',
        }}
      >
        <div
          className="rounded bg-black text-center text-nowrap"
          style={{
            display: mouseHovered ? 'block' : 'none',
            position: 'absolute',
            transform: 'translateX(50%)',
            padding: 5,
            right: 0,
            top: -20,
          }}
        >
          {formatTs({
            ts: mouseTs,
            minTs: minSliderVal,
            showRelativeTime,
          })}
        </div>
      </div>
    </div>
  );
}

export default function Playbar({
  playerState,
  setPlayerState,
  setFocus,
  playbackRange,
  focus,
  eventsConfig,
  playerSpeed,
  setPlayerSpeed,
  skipInactive,
  setSkipInactive,
  playerFullWidth,
  setPlayerFullWidth,
}: {
  playerState: 'playing' | 'paused';
  setPlayerState: (playerState: 'playing' | 'paused') => void;
  focus: { ts: number; setBy: string } | undefined;
  setFocus: (focus: { ts: number; setBy: string }) => void;
  playbackRange: [Date, Date];
  eventsConfig: {
    where: string;
    dateRange: [Date, Date];
  };
  playerSpeed: number;
  setPlayerSpeed: (playerSpeed: number) => void;
  skipInactive: boolean;
  setSkipInactive: (skipInactive: boolean) => void;
  playerFullWidth: boolean;
  setPlayerFullWidth: (playerFullWidth: boolean) => void;
}) {
  // might be outdated? state update or something? that's why the max slider val can be wrong?

  const minTs = playbackRange[0].getTime();
  const maxTs = playbackRange[1].getTime();
  const maxSliderVal = Math.ceil(playbackRange[1].getTime() / 1000) * 1000;
  const minSliderVal = Math.floor(playbackRange[0].getTime() / 1000) * 1000;

  const { events } = useSessionEvents({ config: eventsConfig });

  const markers = useMemo(() => {
    return (
      events?.map(event => {
        const spanName = event['span_name'];
        const locationHref = event['location.href'];
        const shortLocationHref = getShortUrl(locationHref);

        const errorMessage = event['error.message'];

        const url = event['http.url'];
        const statusCode = event['http.status_code'];
        const method = event['http.method'];
        const shortUrl = getShortUrl(url);

        const isNavigation =
          spanName === 'routeChange' || spanName === 'documentLoad';

        const isError = event.severity_text === 'error' || statusCode >= 399;

        return {
          id: event.id,
          ts: event.startOffset,
          description: isNavigation
            ? `Navigated to ${shortLocationHref}`
            : url.length > 0
            ? `${statusCode} ${method}${url.length > 0 ? ` ${shortUrl}` : ''}`
            : errorMessage != null && errorMessage.length > 0
            ? errorMessage
            : spanName === 'intercom.onShow'
            ? 'Intercom Chat Opened'
            : event.body,
          className: isError ? 'bg-danger' : 'bg-primary',
        };
      }) ?? []
    );
  }, [events]);

  const marks = useMemo(
    () => Array.from(new Set(markers.map(m => m.ts).filter(ts => ts >= minTs))),
    [markers, minTs],
  );

  const [showRelativeTime, setShowRelativeTime] = useLocalStorage(
    'hdx-session-subpanel-show-relative-time',
    false,
  );

  return (
    <div className="d-flex align-items-center">
      {playerState === 'playing' ? (
        <div
          className=""
          role="button"
          onClick={() => setPlayerState('paused')}
        >
          <i className="mt-3 fs-6 bi bi-pause-fill" />
        </div>
      ) : (
        <div
          className=""
          role="button"
          onClick={() => setPlayerState('playing')}
        >
          <i className="fs-6 bi bi-play-fill" />
        </div>
      )}
      <div
        className="mx-2 fs-8 text-muted-hover cursor-pointer text-nowrap"
        title="Click to toggle between relative time and clock"
        onClick={() => {
          setShowRelativeTime(!showRelativeTime);
        }}
      >
        {formatTs({ ts: focus?.ts, minTs, showRelativeTime })}
      </div>
      <div className="PlaybarSliderParent w-100 d-flex align-self-stretch align-items-center me-3">
        <ReactSlider
          className="PlaybarSlider w-100"
          thumbClassName="thumb"
          value={focus?.ts ?? minSliderVal}
          min={minSliderVal}
          max={maxSliderVal}
          step={1000}
          marks={marks}
          renderMark={props => {
            const mark = markers.find(marker => marker.ts === props.key);
            const description = truncateText(
              mark?.description ?? '',
              240,
              '...',
              /\n/,
            );
            return (
              <OverlayTrigger
                key={`${props.key}`}
                overlay={<Tooltip id={`tooltip`}>{description}</Tooltip>}
              >
                <div
                  {...props}
                  className={`${mark?.className ?? ''} rounded-circle mark`}
                />
              </OverlayTrigger>
            );
          }}
          renderThumb={(props, state) => (
            <OverlayTrigger
              key="thumb"
              overlay={
                <Tooltip id={`tooltip`} className="mono fs-7 text-nowrap">
                  {(() => {
                    const value = Math.max(state.value - minTs, 0);
                    const minutes = Math.floor(value / 1000 / 60);
                    const seconds = Math.floor((value / 1000) % 60);
                    return `${minutes}m:${seconds < 10 ? '0' : ''}${seconds}s`;
                  })()}{' '}
                  at{' '}
                  {(() => {
                    return format(new Date(state.value), 'hh:mm:ss a');
                  })()}
                </Tooltip>
              }
            >
              <div
                {...props}
                className="bg-success cursor-grab rounded-circle shadow thumb"
                key="thumb"
              />
            </OverlayTrigger>
          )}
          renderTrack={(props, state) => (
            <Track
              key={state.index}
              props={props}
              state={state}
              minSliderVal={minSliderVal}
              maxSliderVal={maxSliderVal}
              showRelativeTime={showRelativeTime}
            />
          )}
          onChange={value => setFocus({ ts: value as number, setBy: 'slider' })}
        />
      </div>
      <Checkbox
        id="skip-inactive"
        className="me-3 text-nowrap"
        labelClassName="fs-8"
        checked={skipInactive}
        onChange={() => {
          setSkipInactive(!skipInactive);
        }}
        label="Skip Idle"
      />
      <div className="d-flex align-items-center text-nowrap me-2">
        <div
          role="button"
          className="text-muted-hover"
          title="Click to change playback speed"
          onClick={() => {
            if (playerSpeed == 1) {
              setPlayerSpeed(2);
            } else if (playerSpeed == 2) {
              setPlayerSpeed(4);
            } else if (playerSpeed == 4) {
              setPlayerSpeed(8);
            } else if (playerSpeed == 8) {
              setPlayerSpeed(1);
            }
          }}
        >
          {playerSpeed}x Speed
        </div>
      </div>
      <Button
        variant="dark"
        size="sm"
        className="d-flex align-items-center justify-content-center"
        onClick={() => {
          setPlayerFullWidth(!playerFullWidth);
        }}
      >
        <i
          className={
            playerFullWidth
              ? 'bi bi-arrows-angle-contract fs-9'
              : 'bi bi-arrows-fullscreen fs-9'
          }
        />
      </Button>
    </div>
  );
}
