import { memo } from 'react';
import { ActionIcon, getDefaultZIndex, Group } from '@mantine/core';
import {
  IconCaretDownFilled,
  IconCaretUpFilled,
  IconX,
} from '@tabler/icons-react';

import type { NumberFormat } from '@/types';
import { FormatTime } from '@/useFormatTime';
import { formatNumber, truncateMiddle } from '@/utils';
import { useZIndex } from '@/zIndex';

import styles from '@styles/HDXLineChart.module.scss';

/**
 * z-index for a body-portaled chart tooltip: above any modal/drawer the chart
 * is in (via ZIndexContext), but never below the default popover layer. Shared
 * so hover and pinned tooltips stack the same way.
 */
export function useChartTooltipZIndex() {
  const contextZIndex = useZIndex();
  return Math.max(getDefaultZIndex('popover'), contextZIndex + 1);
}

/**
 * Convert a chart-relative point (recharts' `activeCoordinate`) into
 * `position: fixed` viewport coordinates using the container's bounding rect.
 */
export function toViewportPoint(
  containerRect: DOMRect | undefined,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (containerRect?.left ?? 0) + point.x,
    y: (containerRect?.top ?? 0) + point.y,
  };
}

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 2,
});

const calculatePercentChange = (current: number, previous: number) => {
  if (previous === 0) {
    return current === 0 ? 0 : undefined;
  }
  return (current - previous) / previous;
};

const PercentChange = ({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) => {
  const percentChange = calculatePercentChange(current, previous);
  if (percentChange == undefined) {
    return null;
  }

  const Icon = percentChange > 0 ? IconCaretUpFilled : IconCaretDownFilled;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
      (<Icon size={12} />
      {percentFormatter.format(Math.abs(percentChange))})
    </span>
  );
};

export const ChartTooltipItem = memo(
  ({
    color,
    name,
    value,
    numberFormat,
    indicator = 'line',
    strokeDasharray,
    opacity,
    previous,
    highlighted,
    dimmed,
  }: {
    color: string;
    name: string;
    value: number;
    numberFormat?: NumberFormat;
    indicator?: 'line' | 'square' | 'none';
    strokeDasharray?: string;
    opacity?: number;
    previous?: number;
    highlighted?: boolean;
    dimmed?: boolean;
  }) => {
    return (
      <div
        className="d-flex gap-2 items-center justify-center"
        style={
          highlighted || dimmed
            ? {
                ...(highlighted ? { fontWeight: 600 } : null),
                ...(dimmed ? { opacity: 0.5 } : null),
              }
            : undefined
        }
      >
        <div>
          {indicator === 'square' ? (
            <svg width="12" height="12">
              <rect width="12" height="12" fill={color} rx="2" />
            </svg>
          ) : indicator === 'line' ? (
            <svg width="12" height="4">
              <line
                x1="0"
                y1="2"
                x2="12"
                y2="2"
                stroke={color}
                opacity={opacity}
                strokeDasharray={strokeDasharray}
              />
            </svg>
          ) : null}
        </div>
        <div>
          <span style={{ color }}>{truncateMiddle(name, 50)}</span>
          {': '}
          {numberFormat ? formatNumber(value, numberFormat) : value}{' '}
          {previous != null && (
            <PercentChange current={value} previous={previous} />
          )}
        </div>
      </div>
    );
  },
);

/**
 * The tooltip header timestamp: the bucket time, plus the previous-period time
 * in parentheses when comparing. `labelSeconds` is epoch seconds (number from
 * the hover tooltip, string from the pinned one — both coerced).
 */
const ChartTooltipTimestamp = ({
  labelSeconds,
  previousPeriodOffsetSeconds,
}: {
  labelSeconds: number | string;
  previousPeriodOffsetSeconds?: number;
}) => {
  const sec = Number(labelSeconds);
  return (
    <>
      <FormatTime value={sec * 1000} />
      {previousPeriodOffsetSeconds != null && (
        <>
          {' (vs '}
          <FormatTime value={(sec - previousPeriodOffsetSeconds) * 1000} />
          {')'}
        </>
      )}
    </>
  );
};

/**
 * The tooltip header row: timestamp + close (X) button. Shared by hover and
 * pinned so they can't drift. The X is always rendered (hidden when `onClose`
 * is omitted) so both modes have the same height and layout.
 */
export const ChartTooltipHeader = ({
  labelSeconds,
  previousPeriodOffsetSeconds,
  onClose,
}: {
  labelSeconds: number | string;
  previousPeriodOffsetSeconds?: number;
  /** Pinned only; when omitted the X is rendered but hidden. */
  onClose?: () => void;
}) => (
  <Group gap={8} wrap="nowrap" justify="space-between" style={{ flex: 1 }}>
    <span>
      <ChartTooltipTimestamp
        labelSeconds={labelSeconds}
        previousPeriodOffsetSeconds={previousPeriodOffsetSeconds}
      />
    </span>
    <ActionIcon
      variant="subtle"
      size="xs"
      color="gray"
      aria-label="Close"
      data-testid="chart-tooltip-close"
      onClick={() => onClose?.()}
      style={{
        flexShrink: 0,
        // Kept in the layout even when hidden (hover) so both modes match.
        visibility: onClose != null ? 'visible' : 'hidden',
        pointerEvents: onClose != null ? undefined : 'none',
      }}
    >
      <IconX size={13} />
    </ActionIcon>
  </Group>
);

export const ChartTooltipContainer = ({
  header,
  children,
  footer,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Bordered block below the content; the pinned tooltip's drill-down actions. */
  footer?: React.ReactNode;
}) => (
  <div className={styles.chartTooltip}>
    {header != null && (
      <div className={styles.chartTooltipHeader}>{header}</div>
    )}
    <div className={styles.chartTooltipContent}>{children}</div>
    {footer != null && (
      <div className={styles.chartTooltipFooter}>{footer}</div>
    )}
  </div>
);
