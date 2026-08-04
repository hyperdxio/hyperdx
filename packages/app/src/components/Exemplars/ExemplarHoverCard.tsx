import { useLayoutEffect, useRef, useState } from 'react';
import { Exemplar, NumberFormat } from '@hyperdx/common-utils/dist/types';
import { Button, CloseButton, Group, Paper, Stack, Text } from '@mantine/core';

import type { PositionedExemplar } from '@/components/Exemplars/exemplarPoints';
import type { ExemplarTraceMeta } from '@/hooks/useExemplars';
import { useFormatTime } from '@/useFormatTime';
import { formatNumber } from '@/utils';

type ExemplarHoverCardProps = {
  /** The hovered exemplar plus its on-screen position; null hides the card. */
  hovered: PositionedExemplar | null;
  /** Trace metadata resolved from the configured exemplar trace source. */
  meta?: ExemplarTraceMeta;
  isLoading: boolean;
  /** Whether an exemplar trace source is configured for this chart. */
  traceSourceConfigured: boolean;
  /** Chart's number format, so the exemplar's value reads like the y-axis. */
  numberFormat?: NumberFormat;
  /**
   * Clicking a marker pins the card open: it stops following the cursor and
   * only closes via `onClose` (or a click elsewhere on the chart).
   */
  pinned?: boolean;
  onClose?: () => void;
  onInspect: (exemplar: Exemplar) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

/**
 * Floating card shown when hovering an exemplar marker: trace metadata (from the
 * configured exemplar trace source) plus a button to open the trace directly.
 */
export function ExemplarHoverCard({
  hovered,
  meta,
  isLoading,
  traceSourceConfigured,
  numberFormat,
  pinned = false,
  onClose,
  onInspect,
  onMouseEnter,
  onMouseLeave,
}: ExemplarHoverCardProps) {
  const formatTime = useFormatTime();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Position the card next to the marker, but flip to the left / clamp upward
  // when it would overflow the chart container, so it's never cut off. Measured
  // after render (size depends on the async-loaded metadata).
  useLayoutEffect(() => {
    if (!hovered || !ref.current) {
      setPos(null);
      return;
    }
    const el = ref.current;
    const parent = el.offsetParent;
    const pW = parent?.clientWidth ?? window.innerWidth;
    const pH = parent?.clientHeight ?? window.innerHeight;
    const cardW = el.offsetWidth;
    const cardH = el.offsetHeight;
    const margin = 12;

    let left = hovered.x + margin;
    if (left + cardW > pW) left = hovered.x - margin - cardW; // flip left
    left = Math.max(4, Math.min(left, pW - cardW - 4));

    let top = hovered.y - margin;
    if (top + cardH > pH) top = pH - cardH - 4; // shift up to stay in view
    top = Math.max(4, top);

    setPos({ left, top });
  }, [hovered, meta, isLoading, traceSourceConfigured]);

  if (!hovered) return null;
  const { exemplar } = hovered;
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: pos?.left ?? hovered.x + 12,
        top: pos?.top ?? Math.max(0, hovered.y - 12),
        zIndex: 5,
        // Avoid a one-frame flash at the unflipped position before measuring.
        visibility: pos ? 'visible' : 'hidden',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // A pinned card is a click target of its own; the chart's onClick would
      // otherwise treat clicks inside it as clicks on the plot area.
      onClick={e => e.stopPropagation()}
    >
      <Paper shadow="md" p="xs" withBorder maw={280}>
        <Stack gap={6}>
          <Group gap="xs" justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              Exemplar
            </Text>
            <Group gap={4} wrap="nowrap">
              <Text size="xs" ff="monospace" truncate>
                {exemplar.traceId.slice(0, 16)}…
              </Text>
              {pinned && (
                <CloseButton size="xs" aria-label="Close" onClick={onClose} />
              )}
            </Group>
          </Group>
          {/*
            The exemplar's own value and time, always shown. The marker's drawn
            position is not trustworthy on its own: clampExemplarY pins it into
            the y-domain and clampExemplarX into the x-domain, so a marker can sit
            up to a bucket away in time and at the axis edge in value. These two
            rows are what make that trade-off honest, which is why they render
            here rather than inside the trace-source branch below — a chart with
            no trace source configured still needs them.
          */}
          <Stack gap={2}>
            <Text size="xs">
              Value: {formatNumber(exemplar.value, numberFormat)}
            </Text>
            <Text size="xs">Time: {formatTime(exemplar.timestamp)}</Text>
          </Stack>
          {!traceSourceConfigured ? (
            <Text size="xs" c="dimmed">
              Set an exemplar trace source in the chart editor to see trace
              details.
            </Text>
          ) : isLoading ? (
            <Text size="xs" c="dimmed">
              Loading trace…
            </Text>
          ) : meta ? (
            <Stack gap={2}>
              {meta.service && <Text size="xs">Service: {meta.service}</Text>}
              {meta.spanName && <Text size="xs">Span: {meta.spanName}</Text>}
              {meta.durationMs != null && (
                <Text size="xs">Duration: {meta.durationMs.toFixed(1)} ms</Text>
              )}
              {meta.statusCode && (
                <Text size="xs">Status: {meta.statusCode}</Text>
              )}
            </Stack>
          ) : (
            <Text size="xs" c="dimmed">
              Trace not found in source.
            </Text>
          )}
          <Button
            size="compact-xs"
            variant="secondary"
            onClick={() => onInspect(exemplar)}
          >
            Inspect trace
          </Button>
        </Stack>
      </Paper>
    </div>
  );
}
