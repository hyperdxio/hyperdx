import React from 'react';
import cx from 'classnames';

import classes from './Heatmap.module.scss';

function percentageToColor(percentage: number, warn = false) {
  if (percentage === 0) {
    return 'transparent';
  }

  if (warn) {
    return `rgba(255, 200, 0, ${Math.max(percentage, 0.01)})`;
  }

  return `rgba(80, 250, 123, ${Math.max(percentage, 0.01)})`;
}

// ts_bucket, duration_bucket, count
type HeatmapDataPoint = {
  ts_bucket: number;
  duration_bucket: number;
  count: number;
};
type HeatmapData = HeatmapDataPoint[];

const generateMockHeatmapData = (w = 100, h = 10): HeatmapData => {
  return Array.from({ length: w }, (_, i) =>
    Array.from({ length: h }, (_, j) => ({
      ts_bucket: i,
      duration_bucket: j,
      count: Math.random() > 0.5 ? 0 : Math.random(),
    })),
  ).flat();
};

// const MOCK_DATA = generateMockHeatmapData(w, h);

export const Heatmap = ({
  xLabels,
  yLabels,
  data,
  isFetching,
}: {
  data: any;
  xLabels?: string[];
  yLabels?: string[];
  isFetching: boolean;
}) => {
  if (!data.data) {
    return null;
  }

  const w = data.data.length;
  const h = data.meta.filter(({ name }: { name: string }) =>
    name.includes('series_'),
  ).length;

  const dataPoints: {
    ts_bucket: number;
    duration_bucket: number;
    count: number;
    series: string;
  }[] = [];

  let maxCount = 1;

  for (const [index, point] of data.data.entries()) {
    for (let j = 0; j <= h; j++) {
      const count = point[`series_${j}.data`] || 0;
      if (count > maxCount) {
        maxCount = count;
      }
      // point[`series_${j}`] = point[`series_${j}`] || 0;
      dataPoints.push({
        ts_bucket: index,
        duration_bucket: h - j - 4,
        count,
        series: `series_${j}`,
      });
    }
  }

  return (
    <div className={cx(classes.wrapper, { 'effect-pulse': isFetching })}>
      <div className={classes.yLabels}>
        {yLabels?.map(label => (
          <div key={label} className={classes.yLabel}>
            {label}
          </div>
        ))}
      </div>
      <div className={classes.xLabels}>
        {xLabels?.map(label => (
          <div key={label} className={classes.xLabel}>
            {label}
          </div>
        ))}
      </div>
      <div
        className={classes.heatmap}
        style={{
          gridTemplateColumns: `repeat(${w}, 1fr)`,
          gridTemplateRows: `repeat(${h}, 1fr)`,
        }}
      >
        {dataPoints.map(({ ts_bucket, duration_bucket, count, series }) =>
          count > 0 ? (
            <div
              key={`${ts_bucket + 1}-${duration_bucket + 1}`}
              className={classes.heatmapCell}
              style={{
                backgroundColor: percentageToColor(
                  Math.max(0.05, count / maxCount),
                  duration_bucket < 5,
                ),
                gridArea: `${duration_bucket + 1} / ${
                  ts_bucket + 1
                } / span 1 / span 1`,
              }}
              title={`${count} event of ${maxCount} ${series}`}
            />
          ) : null,
        )}
      </div>
    </div>
  );
};
