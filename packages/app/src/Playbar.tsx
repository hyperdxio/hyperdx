import { useMemo } from 'react';
import uniqBy from 'lodash/uniqBy';
import Button from 'react-bootstrap/Button';
import { Group } from '@mantine/core';

import Checkbox from './Checkbox';
import type { PlaybarMarker } from './PlaybarSlider';
import { PlaybarSlider } from './PlaybarSlider';
import { useSessionEvents } from './sessionUtils';
import { FormatTime } from './useFormatTime';
import { getShortUrl, useLocalStorage } from './utils';

function formatRelativeTime(seconds: number) {
  const minutes = Math.floor(Math.max(seconds, 0) / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
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

  const markers = useMemo<PlaybarMarker[]>(() => {
    return uniqBy(
      events
        ?.filter(
          ({ startOffset }) => startOffset >= minTs && startOffset <= maxTs,
        )
        .map(event => {
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
            percentage: Math.round(
              ((event.startOffset - minTs) / (maxTs - minTs)) * 100,
            ),
            description: isNavigation
              ? `Navigated to ${shortLocationHref}`
              : url.length > 0
              ? `${statusCode} ${method}${url.length > 0 ? ` ${shortUrl}` : ''}`
              : errorMessage != null && errorMessage.length > 0
              ? errorMessage
              : spanName === 'intercom.onShow'
              ? 'Intercom Chat Opened'
              : event.body,
            isError,
          };
        }) ?? [],
      'percentage',
    );
  }, [events, maxTs, minTs]);

  const [showRelativeTime, setShowRelativeTime] = useLocalStorage(
    'hdx-session-subpanel-show-relative-time',
    false,
  );

  const skipBackward = () => {
    setFocus({
      ts: Math.max((focus?.ts ?? minTs) - 15000, minTs),
      setBy: 'skip-backward',
    });
  };

  const skipForward = () => {
    setFocus({
      ts: Math.min((focus?.ts ?? minTs) + 15000, maxTs),
      setBy: 'skip-forward',
    });
  };

  return (
    <div className="d-flex align-items-center">
      <Group gap="xs" wrap="nowrap">
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
          className=""
          role="button"
          title="Skip Backward 15s"
          onClick={skipBackward}
        >
          <i className="mt-3 fs-7 bi bi-skip-backward-fill" />
        </div>
        <div
          className=""
          role="button"
          title="Skip Forward 15s"
          onClick={skipForward}
        >
          <i className="mt-3 fs-7 bi bi-skip-forward-fill" />
        </div>
      </Group>
      <div
        className="mx-2 fs-8 text-muted-hover cursor-pointer text-nowrap"
        title="Click to toggle between relative time and clock"
        onClick={() => {
          setShowRelativeTime(!showRelativeTime);
        }}
      >
        {showRelativeTime ? (
          formatRelativeTime((focus?.ts || 0) - minTs / 1000)
        ) : (
          <FormatTime value={focus?.ts} format="short" />
        )}
      </div>
      <div className="w-100 d-flex align-self-stretch align-items-center me-3">
        <PlaybarSlider
          markers={markers}
          min={minSliderVal}
          max={maxSliderVal}
          value={focus?.ts}
          onChange={ts => {
            setFocus({ ts, setBy: 'slider' });
          }}
          setPlayerState={setPlayerState}
          playerState={playerState}
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
