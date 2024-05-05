import * as React from 'react';
import { format } from 'date-fns';
import { Slider, Tooltip } from '@mantine/core';

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
  onChange: (value: number) => void;
};

export const PlaybarSlider = ({
  min,
  max,
  value,
  onChange,
  markers,
}: PlaybarSliderProps) => {
  const valueLabelFormat = React.useCallback(
    (ts: number) => {
      const value = Math.max(ts - min, 0);
      const minutes = Math.floor(value / 1000 / 60);
      const seconds = Math.floor((value / 1000) % 60);
      const timestamp = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
      const time = format(new Date(ts), 'hh:mm:ss a');
      return `${timestamp} at ${time}`;
    },
    [min],
  );

  const markersContent = React.useMemo(
    () =>
      markers?.map(mark => (
        <Tooltip
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

  return (
    <div className={styles.wrapper}>
      <div className={styles.markers}>{markersContent}</div>
      <Slider
        color="gray.5"
        size="sm"
        min={min}
        max={max}
        value={value || min}
        step={1000}
        label={valueLabelFormat}
        onChange={onChange}
      />
    </div>
  );
};
