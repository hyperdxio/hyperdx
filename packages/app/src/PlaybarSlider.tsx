import * as React from 'react';
import { format } from 'date-fns';
import { Slider, Tooltip } from '@mantine/core';

import { useFormatTime } from './useFormatTime';
import { truncateText } from './utils';

import styles from '../styles/PlaybarSlider.module.scss';

export type PlaybarMarker = {
  id: string;
  ts: number;
  description: string;
  isError: boolean;
};

type PlaybarSliderProps = {
  value?: number;
  min: number;
  max: number;
  markers?: PlaybarMarker[];
  playerState: 'playing' | 'paused';
  onChange: (value: number) => void;
  setPlayerState: (playerState: 'playing' | 'paused') => void;
};

export const PlaybarSlider = ({
  min,
  max,
  value,
  markers,
  playerState,
  onChange,
  setPlayerState,
}: PlaybarSliderProps) => {
  const formatTime = useFormatTime();

  const valueLabelFormat = React.useCallback(
    (ts: number) => {
      const value = Math.max(ts - min, 0);
      const minutes = Math.floor(value / 1000 / 60);
      const seconds = Math.floor((value / 1000) % 60);
      const timestamp = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
      const time = formatTime(ts, { format: 'short' });
      return `${timestamp} at ${time}`;
    },
    [formatTime, min],
  );

  const markersContent = React.useMemo(
    () =>
      markers?.map(mark => (
        <Tooltip
          color={mark.isError ? 'red' : 'gray'}
          key={mark.id}
          label={truncateText(mark?.description ?? '', 240, '...', /\n/)}
          position="top"
          withArrow
        >
          <div
            className={styles.markerDot}
            style={{
              backgroundColor: mark.isError
                ? 'var(--mantine-color-red-6)'
                : 'var(--mantine-color-gray-6)',
              left: `${((mark.ts - min) / (max - min)) * 100}%`,
            }}
            onClick={() => onChange(mark.ts)}
          />
        </Tooltip>
      )),
    [markers, max, min, onChange],
  );

  const [prevPlayerState, setPrevPlayerState] = React.useState(playerState);
  const handleMouseDown = React.useCallback(() => {
    setPrevPlayerState(playerState);
    setPlayerState('paused');
  }, [playerState, setPlayerState]);
  const handleMouseUp = React.useCallback(() => {
    setPlayerState(prevPlayerState);
  }, [prevPlayerState, setPlayerState]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.markers}>{markersContent}</div>
      <Slider
        color={playerState === 'playing' ? 'green' : 'gray.5'}
        size="sm"
        min={min}
        max={max}
        value={value || min}
        step={1000}
        label={valueLabelFormat}
        onChange={onChange}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      />
    </div>
  );
};
