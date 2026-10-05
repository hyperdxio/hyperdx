import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from 'classnames';
import uPlot from 'uplot';
import UplotReact from 'uplot-react';
import { useElementSize } from '@mantine/hooks';

import { NumberFormat } from '@/types';

import {
  formatHeatmapTick,
  formatHeatmapValue,
  heatmapYAxisOptions,
} from './heatmapAxis';
import {
  computeBucketPercentiles,
  gridToPlotData,
  HeatmapGrid,
  heatmapRowCount,
  HeatmapScaleType,
} from './heatmapGrid';
import {
  baseHeatmapOptions,
  buildSeriesForPalette,
  HEATMAP_AXIS_FONT,
} from './heatmapPaths';
import { HeatmapTooltip, HeatmapTooltipCell } from './HeatmapTooltip';
import { highlightDataPlugin, HighlightedPoint } from './highlightDataPlugin';
import { applySelectionToChart, SelectionBounds } from './selection';
import { SeriesAxisTooltip, useSeriesAxisHover } from './SeriesAxisTooltip';

const isSameRenderedPoint = (
  a: HighlightedPoint | undefined,
  b: HighlightedPoint | undefined,
) =>
  a === b ||
  (a != null &&
    b != null &&
    a.xVal === b.xVal &&
    a.yVal === b.yVal &&
    a.countVal === b.countVal &&
    a.closestIndex === b.closestIndex &&
    a.xCoord === b.xCoord &&
    a.yCoord === b.yCoord &&
    a.xSize === b.xSize &&
    a.ySize === b.ySize);

type HeatmapPlotProps = {
  className?: string;
  grid: HeatmapGrid;
  numberFormat?: NumberFormat;
  onFilter?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  onClearFilter?: () => void;
  scaleType?: HeatmapScaleType;
  palette: string[];
  selectionBounds?: SelectionBounds | null;
};

export function HeatmapPlot({
  className,
  grid,
  numberFormat,
  onFilter,
  onClearFilter,
  scaleType = 'linear',
  palette,
  selectionBounds,
}: HeatmapPlotProps) {
  const [highlightedPoint, setHighlightedPoint] = useState<
    HighlightedPoint | undefined
  >(undefined);

  // Gate tooltip display on actual mouse interaction. uPlot fires setCursor
  // on init (before user hovers), which would show the tooltip on page load.
  const mouseInsideRef = useRef(false);

  // Depend on the boolean, not the onFilter function reference, so the
  // options useMemo doesn't recompute (and re-initialize uPlot — wiping its
  // internal u.select drag rectangle) on every parent render.
  const hasFilter = !!onFilter;

  // Hold onFilter in a ref so the setSelect hook (captured inside the
  // options useMemo) can always call the latest callback without needing
  // onFilter in the memo's dep array.
  const onFilterRef = useRef(onFilter);
  useEffect(() => {
    onFilterRef.current = onFilter;
  }, [onFilter]);

  // Hold the uPlot instance so outside-click can explicitly clear the
  // persisted u.select rectangle (which is owned by uPlot, not React).
  const uplotRef = useRef<uPlot | null>(null);

  // Hold selectionBounds and scaleType in refs so the uPlot `ready` hook
  // (captured inside the options useMemo via closure) always sees the
  // latest values without needing them in the memo's dep array. Mutating
  // a ref doesn't trigger re-renders, so the options identity stays
  // stable across selection/scale changes.
  const selectionBoundsRef = useRef(selectionBounds);
  const scaleTypeRef = useRef(scaleType);
  // Runs every commit; mirrors latest props into refs (no deps array on
  // purpose).
  useEffect(() => {
    selectionBoundsRef.current = selectionBounds;
    scaleTypeRef.current = scaleType;
  });

  const { ref, width, height } = useElementSize();

  // Reapply the URL-backed selection whenever the bounds prop changes
  // (e.g. a fresh drag-select arrives via the round-trip through the
  // parent's URL state, or the parent clears the filter), or when the
  // container resizes (uPlot calls setSize, not a full recreate, so the
  // pixel-space u.select would otherwise be stale). This complements the
  // uPlot `ready` hook below: that handles initial chart creation (and
  // any recreation), this handles bounds and size changes against an
  // existing chart.
  useEffect(() => {
    if (uplotRef.current) {
      applySelectionToChart(uplotRef.current, selectionBounds, scaleType);
    }
  }, [selectionBounds, scaleType, width, height]);

  // Timestamp of the most recent drag-end. Guards the container's onClick
  // handler from clearing the selection when the synthetic click event
  // that fires on mouseup-after-drag arrives.
  const justDraggedAtRef = useRef(0);

  // Stabilize on numberFormat content, not reference. Callers (e.g.
  // DBSearchHeatmapChart) build a fresh `numberFormat` object on every
  // render; depending on its identity would rebuild tickFormatter, then
  // the options memo, then uplot-react would see new top-level keys via
  // optionsUpdateState and treat the change as 'create', destroying the
  // chart and wiping u.select. Hashing the contents lets the memo skip
  // when the actual format is unchanged. (HDX-4147)
  //
  // Relies on NumberFormat being JSON-serializable: today it is plain
  // config (string + number fields), so JSON.stringify is a faithful
  // fingerprint. If the type ever grows a function-valued field
  // (e.g. a custom `formatter` callback), switch to a shallow-equal
  // helper keyed on the known fields, because functions stringify to
  // undefined and would silently skip rebuilds.
  const numberFormatKey = useMemo(
    () => (numberFormat ? JSON.stringify(numberFormat) : ''),
    [numberFormat],
  );
  const tickFormatter = useCallback(
    (value: number) => formatHeatmapTick(value, scaleType, numberFormat),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [numberFormatKey, scaleType],
  );

  const plotData = useMemo(() => gridToPlotData(grid), [grid]);
  const rowCount = heatmapRowCount(grid.yAxis);

  // Key on label content: every refresh builds a fresh labels array, and new
  // options make uplot-react recreate the chart instead of updating its data.
  const seriesLabelsKey =
    grid.yAxis.type === 'series' ? grid.yAxis.labels.join('\0') : undefined;
  const seriesLabels = useMemo(
    () => (grid.yAxis.type === 'series' ? grid.yAxis.labels : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seriesLabelsKey],
  );

  const bucketPercentiles = useMemo(
    () =>
      grid.yAxis.type === 'numeric' ? computeBucketPercentiles(grid) : null,
    [grid],
  );

  const options: uPlot.Options = useMemo(() => {
    const opt = baseHeatmapOptions;
    const themedSeries = buildSeriesForPalette(palette);
    const yAxis = heatmapYAxisOptions(seriesLabels, scaleType, tickFormatter);
    return {
      ...opt,
      ...(yAxis.scale != null
        ? { scales: { ...opt.scales, y: yAxis.scale } }
        : {}),
      series: [opt.series[0], { ...opt.series[1], ...themedSeries }],
      ...(opt != null && opt.axes != null
        ? {
            axes: [
              opt.axes[0],
              {
                ...opt.axes[1],
                ...yAxis.axis,
                // Override the static size fn so it measures the actual
                // formatted labels (from tickFormatter) rather than
                // whatever raw values uPlot passes in a prior cycle.
                size(self: uPlot, values: string[]) {
                  if (!values || values.length === 0) return 50;
                  const ctx = self.ctx;
                  ctx.save();
                  ctx.font = HEATMAP_AXIS_FONT;
                  let maxW = 0;
                  for (const v of values) {
                    const w = ctx.measureText(v).width;
                    if (w > maxW) maxW = w;
                  }
                  ctx.restore();
                  return Math.ceil(maxW) + 16;
                },
              },
            ],
          }
        : {}),
      width,
      height,
      cursor: {
        drag: {
          setScale: false,
          x: hasFilter,
          y: hasFilter,
          dist: 5,
        },
        show: true,
        focus: {
          prox: 100,
        },
      },
      plugins: [
        highlightDataPlugin({
          margin: 20,
          onPointHighlight: point => {
            // Only show tooltip after the user has actually hovered the chart.
            // uPlot fires setCursor on init which would trigger this on page load.
            if (!mouseInsideRef.current) return;
            // Keep the same object while the cursor stays on one cell, so
            // moving within it doesn't re-render the tooltip. Compare what
            // the tooltip renders, not just the index: after a data refresh
            // or resize the same index can hold a different cell.
            setHighlightedPoint(prev =>
              isSameRenderedPoint(prev, point) ? prev : point,
            );
          },
        }),
        {
          hooks: {
            // Fires once after uPlot finishes initial layout/draw. At
            // onCreate time scales aren't reliably populated for mode-2
            // facet data, so reapplying the URL-backed selection from
            // here ensures valToPos has the bounds it needs. (HDX-4147)
            ready: u => {
              applySelectionToChart(
                u,
                selectionBoundsRef.current,
                scaleTypeRef.current,
              );
            },
            setSelect: u => {
              // Ignore zero-size selections (e.g. single-click)
              if (u.select.width <= 0 || u.select.height <= 0) {
                return;
              }

              const xMin = u.posToVal(u.select.left, 'x');
              const xMax = u.posToVal(u.select.left + u.select.width, 'x');
              const rawYMax = u.posToVal(u.select.top, 'y');
              const rawYMin = u.posToVal(u.select.top + u.select.height, 'y');

              // y-values are stored in log space for log scale; convert back
              const yMin = scaleType === 'log' ? Math.exp(rawYMin) : rawYMin;
              const yMax = scaleType === 'log' ? Math.exp(rawYMax) : rawYMax;

              // Apply the filter immediately on drag end. Record the
              // timestamp so the synthetic click event that follows the
              // drag (mouseup fires a click on the container) doesn't
              // immediately clear the selection we just made.
              justDraggedAtRef.current = performance.now();
              onFilterRef.current?.(xMin / 1000, xMax / 1000, yMin, yMax);
            },
          },
        },
      ],
    };
  }, [
    width,
    height,
    tickFormatter,
    scaleType,
    palette,
    hasFilter,
    seriesLabels,
  ]);

  const seriesAxisHover = useSeriesAxisHover(uplotRef, seriesLabels);

  const highlightedRow =
    highlightedPoint && rowCount > 0
      ? highlightedPoint.closestIndex % rowCount
      : 0;
  const highlightedCell: HeatmapTooltipCell | undefined =
    highlightedPoint == null
      ? undefined
      : seriesLabels != null
        ? {
            kind: 'series',
            name: seriesLabels[highlightedRow] ?? '',
            formattedValue: formatHeatmapValue(
              highlightedPoint.countVal,
              numberFormat,
            ),
          }
        : {
            kind: 'distribution',
            formattedY: tickFormatter(highlightedPoint.yVal),
            percentile: bucketPercentiles?.get(highlightedRow),
          };

  return (
    <div
      ref={ref}
      className={cx('heatmap-selection-container', className)}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onClick={() => {
        // Chromium fires a click event on mouseup even after a drag.
        // Ignore it; the drag itself was handled by setSelect.
        if (performance.now() - justDraggedAtRef.current < 300) {
          return;
        }
        if (!hasFilter) return;
        // Random click on the chart clears the persisted selection and
        // exits comparison mode.
        uplotRef.current?.setSelect(
          { left: 0, top: 0, width: 0, height: 0 },
          false,
        );
        onClearFilter?.();
      }}
      onMouseMoveCapture={() => {
        mouseInsideRef.current = true;
      }}
      onMouseMove={seriesAxisHover.onMouseMove}
      onMouseLeave={() => {
        mouseInsideRef.current = false;
        setHighlightedPoint(undefined);
        seriesAxisHover.clear();
      }}
    >
      <UplotReact
        options={options}
        // @ts-expect-error TODO: uPlot types are wrong for mode 2 data
        data={[[], plotData]}
        resetScales={true}
        onCreate={chart => {
          uplotRef.current = chart;
        }}
        onDelete={() => {
          uplotRef.current = null;
        }}
      />
      <SeriesAxisTooltip hover={seriesAxisHover.hover} />
      {highlightedPoint != null && highlightedCell != null && (
        <HeatmapTooltip
          point={highlightedPoint}
          cell={highlightedCell}
          width={width}
          height={height}
          showDragHint={!!onFilter}
        />
      )}
    </div>
  );
}
