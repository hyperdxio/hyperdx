import { useEffect, useRef } from 'react';
import { NumberFormat } from '@hyperdx/common-utils/dist/types';
import { Popover, Portal } from '@mantine/core';

import { ChartSeriesTooltip } from '@/components/charts/ChartSeriesTooltip';
import { useChartTooltipZIndex } from '@/components/charts/ChartTooltip';
import {
  type ActiveClickPayload,
  TOOLTIP_POINT_OFFSET_PX,
} from '@/HDXMultiSeriesTimeChart';

// The interactive PINNED tooltip, rendered over the chart in a body-portaled
// Mantine Popover anchored at the clicked point. Hover uses the recharts tooltip
// in MemoChart instead; this is only for the click-locked state.
export function ChartTooltipOverlay({
  payload,
  buildSearchUrl,
  onDismiss,
  onFocusSeries,
  onShowAllSeries,
  fallbackNumberFormat,
  numberFormatByKey,
  previousPeriodOffsetSeconds,
}: {
  payload: ActiveClickPayload | undefined;
  buildSearchUrl: (key?: string, value?: number) => string | null;
  onDismiss: () => void;
  /** Focus a series by its raw series key (dataKey) and display name. */
  onFocusSeries: (payload: { dataKey?: string; name: string }) => void;
  /** Clear an active series focus; undefined when nothing is focused. */
  onShowAllSeries?: () => void;
  fallbackNumberFormat?: NumberFormat;
  /** Per-value-column formats, keyed by result column name. */
  numberFormatByKey: Map<string, NumberFormat>;
  previousPeriodOffsetSeconds?: number;
}) {
  const isOpen =
    payload != null &&
    payload.activePayload != null &&
    payload.activePayload.length > 0;

  const popoverZIndex = useChartTooltipZIndex({ pinned: true });

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // The pinned tooltip anchors at `position: fixed` viewport coords captured
  // once at click time. When a surrounding scroll container scrolls, the chart
  // moves but the fixed tooltip stays glued to the viewport, detaching from its
  // data point (Mantine's closeOnClickOutside/closeOnEscape don't fire on
  // scroll). Dismiss on scroll instead so it never floats away — but ignore
  // scrolls originating inside the tooltip's own scrollable series list, or a
  // long tooltip couldn't be scrolled without instantly closing.
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target != null && dropdownRef.current?.contains(target)) {
        return;
      }
      onDismiss();
    };
    window.addEventListener('scroll', handleScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [isOpen, onDismiss]);

  // Dismiss on outside click. Mantine's closeOnClickOutside misses it because
  // the chart's recharts onClick calls stopPropagation (see
  // HDXMultiSeriesTimeChart handleClick); a capture-phase listener sees the
  // click regardless, ignoring clicks inside the tooltip's own dropdown.
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Node && dropdownRef.current?.contains(target)) {
        return;
      }
      onDismiss();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [isOpen, onDismiss]);

  if (!isOpen) {
    return null;
  }

  return (
    // Portal to body so the `position: fixed` anchor resolves against the
    // viewport: dashboard tiles use CSS transforms, and a transformed ancestor
    // would otherwise make `fixed` resolve against it and throw the tooltip off.
    <Portal>
      <Popover
        opened
        onChange={opened => {
          if (!opened) {
            onDismiss();
          }
        }}
        closeOnClickOutside
        closeOnEscape
        trapFocus={false}
        withinPortal
        position="bottom"
        // Same gap the hover tooltip uses, so the two states don't sit at
        // different distances from the point.
        offset={TOOLTIP_POINT_OFFSET_PX}
        middlewares={{ flip: true, shift: true }}
        returnFocus={false}
        zIndex={popoverZIndex}
      >
        <Popover.Target>
          {/* 1x1 anchor at the clicked data point. */}
          <div
            style={{
              position: 'fixed',
              left: payload.viewportX ?? 0,
              top: payload.viewportY ?? 0,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </Popover.Target>
        <Popover.Dropdown
          ref={dropdownRef}
          p={0}
          style={{
            // Width comes from the shared .chartTooltip class; fit-content stops
            // Mantine's default dropdown width from overriding it.
            width: 'fit-content',
            border: 'none',
            background: 'transparent',
          }}
        >
          <ChartSeriesTooltip
            activeLabel={payload.activeLabel}
            activePayload={payload.activePayload!}
            fallbackNumberFormat={fallbackNumberFormat}
            numberFormatByKey={numberFormatByKey}
            previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
            buildSearchUrl={buildSearchUrl}
            onDismiss={onDismiss}
            onFocusSeries={onFocusSeries}
            onShowAllSeries={onShowAllSeries}
          />
        </Popover.Dropdown>
      </Popover>
    </Portal>
  );
}
