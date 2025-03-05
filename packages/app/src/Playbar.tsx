import { useMemo } from 'react';
import uniqBy from 'lodash/uniqBy';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';

import type { PlaybarMarker } from './PlaybarSlider';
import { PlaybarSlider } from './PlaybarSlider';
import { getShortUrl } from './utils';

export default function Playbar({
  playerState,
  setPlayerState,
  setFocus,
  playbackRange,
  focus,
  queriedConfig,
}: {
  playerState: 'playing' | 'paused';
  setPlayerState: (playerState: 'playing' | 'paused') => void;
  focus: { ts: number; setBy: string } | undefined;
  setFocus: (focus: { ts: number; setBy: string }) => void;
  playbackRange: [Date, Date];
  queriedConfig: ChartConfigWithOptDateRange;
}) {
  // might be outdated? state update or something? that's why the max slider val can be wrong?
  const minTs = playbackRange[0].getTime();
  const maxTs = playbackRange[1].getTime();
  const maxSliderVal = Math.ceil(playbackRange[1].getTime() / 1000) * 1000;
  const minSliderVal = Math.floor(playbackRange[0].getTime() / 1000) * 1000;

  const { data, isLoading, isError, error } = useQueriedChartConfig(
    queriedConfig,
    {
      placeholderData: (prev: any) => prev,
      queryKey: ['PlayBar', queriedConfig],
    },
  );
  const events: any[] = data?.data ?? [];

  const markers = useMemo<PlaybarMarker[]>(() => {
    return uniqBy(
      events
        .map(event => {
          const { timestamp, durationInMs } = event;

          // TODO: we should just use timestamp and durationInMs instead of startOffset and endOffset
          const startOffset = new Date(timestamp).getTime();
          const endOffset = new Date(startOffset).getTime() + durationInMs;

          return {
            ...event,
            startOffset,
            endOffset,
          };
        })
        .filter(
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

          const isError =
            event.severity_text?.toLowerCase() === 'error' ||
            event.component === 'error' ||
            statusCode >= 399;

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

  return (
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
  );
}
