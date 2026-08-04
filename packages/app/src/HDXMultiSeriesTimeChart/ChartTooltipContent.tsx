import { memo, useMemo } from 'react';
import { withErrorBoundary } from 'react-error-boundary';

import { findNearestSeriesKey, type LineData } from '@/ChartUtils';
import {
  ChartTooltipContainer,
  ChartTooltipHeader,
  toViewportPoint,
  useChartTooltipZIndex,
} from '@/components/charts/ChartTooltip';
import type { NumberFormat } from '@/types';

import {
  NEAREST_SERIES_MAX_DISTANCE_PX,
  TOOLTIP_POINT_OFFSET_PX,
} from './constants';
import { TooltipItem, type TooltipPayload } from './TooltipItem';

import styles from '@styles/HDXLineChart.module.scss';

type HDXLineChartTooltipProps = {
  lineDataMap: { [keyName: string]: LineData };
  previousPeriodOffsetSeconds?: number;
  numberFormat?: NumberFormat;
  numberFormatByKey: Map<string, NumberFormat>;
  /** Per-series active-point pixel Y, captured by the Area active dots. */
  activePointYByKeyRef: React.MutableRefObject<Map<string, number>>;
  /** The chart's outer container; its viewport rect anchors this tooltip. */
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
} & Record<string, any>;

/**
 * The recharts `<Tooltip>` content used for the HOVER tooltip (on the hovered
 * chart and its synced followers). Clicking pins ChartSeriesTooltip instead.
 *
 * Because it's given `portal={document.body}`, recharts skips its own transform
 * positioning, so this content self-anchors at the active point with
 * `position: fixed` (container rect + `coordinate`) — matching the pinned
 * tooltip's anchor, and escaping the chart's bounds so edges aren't clipped.
 */
export const HDXLineChartTooltip = withErrorBoundary(
  memo((props: HDXLineChartTooltipProps) => {
    const {
      active,
      payload,
      label,
      numberFormat,
      numberFormatByKey,
      lineDataMap,
      previousPeriodOffsetSeconds,
      activePointYByKeyRef,
      containerRef,
    } = props;
    const typedPayload = payload as TooltipPayload[];

    const tooltipZIndex = useChartTooltipZIndex();

    const payloadByKey = useMemo(
      () => new Map(typedPayload.map(p => [p.dataKey, p])),
      [typedPayload],
    );

    if (active && payload && payload.length) {
      // No onClose: hover renders the X hidden (kept for layout parity).
      const header = (
        <ChartTooltipHeader
          labelSeconds={label}
          previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
        />
      );

      // Bold the line nearest the cursor by comparing pointer Y to each series'
      // active-dot Y. The dots write their positions earlier in this same render
      // (Recharts draws graphical items before the tooltip), so it's current.
      const pointerY: number | undefined = props.coordinate?.y;
      // eslint-disable-next-line react-hooks/refs
      const activePointYByKey = activePointYByKeyRef?.current ?? undefined;
      const nearestSeriesKey =
        typedPayload.length > 1
          ? findNearestSeriesKey(
              activePointYByKey,
              typedPayload.map(p => p.dataKey),
              pointerY,
              NEAREST_SERIES_MAX_DISTANCE_PX,
            )
          : undefined;

      // Anchor at the active point (see the component docblock for why fixed).
      const pointX = props.coordinate?.x;
      const pointY = props.coordinate?.y;
      // eslint-disable-next-line react-hooks/refs
      const containerRect = containerRef?.current?.getBoundingClientRect();
      const anchor =
        typeof pointX === 'number' &&
        typeof pointY === 'number' &&
        containerRect != null
          ? toViewportPoint(containerRect, { x: pointX, y: pointY })
          : undefined;
      const anchorStyle: React.CSSProperties =
        anchor != null
          ? {
              position: 'fixed',
              left: anchor.x,
              top: anchor.y + TOOLTIP_POINT_OFFSET_PX,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              // z-index must live here: recharts leaves the portaled wrapper
              // `position: static`, where z-index has no effect.
              zIndex: tooltipZIndex,
            }
          : {};

      return (
        <div style={anchorStyle}>
          <ChartTooltipContainer
            header={header}
            contentClassName={styles.chartTooltipContentClipped}
          >
            {/* Copy before sorting: Recharts 3 freezes the payload, so an
                in-place sort throws "this object has been frozen". */}
            {[...payload]
              .sort((a: TooltipPayload, b: TooltipPayload) => b.value - a.value)
              .map((p: TooltipPayload) => {
                const previousKey = lineDataMap[p.dataKey]?.previousPeriodKey;
                const isPreviousPeriod = previousKey === p.dataKey;
                const previousPayload =
                  !isPreviousPeriod && previousKey
                    ? payloadByKey.get(previousKey)
                    : undefined;
                const valueColumnName =
                  lineDataMap[p.dataKey]?.valueColumnName ?? p.dataKey;
                const numberFormatForKey =
                  numberFormatByKey.get(valueColumnName) ?? numberFormat;

                return (
                  <TooltipItem
                    key={p.dataKey}
                    p={p}
                    numberFormat={numberFormatForKey}
                    previous={previousPayload}
                    highlighted={p.dataKey === nearestSeriesKey}
                    dimmed={
                      nearestSeriesKey != null && p.dataKey !== nearestSeriesKey
                    }
                  />
                );
              })}
          </ChartTooltipContainer>
        </div>
      );
    }
    return null;
  }),
  {
    onError: console.error,
    fallback: (
      <div className="text-danger px-2 py-1 m-2 fs-8 font-monospace bg-danger-transparent">
        An error occurred while rendering the tooltip.
      </div>
    ),
  },
);
