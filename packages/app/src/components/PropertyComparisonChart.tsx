import { memo, useEffect, useRef, useState } from 'react';
import { withErrorBoundary } from 'react-error-boundary';
import type { TooltipProps } from 'recharts';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Flex, Portal, Text } from '@mantine/core';
import { IconCopy, IconFilter, IconFilterX } from '@tabler/icons-react';

import {
  getChartColorError,
  getChartColorSuccess,
  truncateMiddle,
} from '@/utils';

import { DBRowTableIconButton } from './DBTable/DBRowTableIconButton';
import type { AddFilterFn } from './deltaChartUtils';
import {
  applyTopNAggregation,
  mergeValueStatisticsMaps,
  OTHER_BUCKET_COLOR,
} from './deltaChartUtils';

import styles from '../../styles/HDXLineChart.module.scss';

// Layout constants for dynamic grid calculation.
// CHART_WIDTH is the minimum chart width used to determine how many columns fit; actual rendered
// width expands to fill the container (charts use width: '100%' inside a CSS grid).
// CHART_HEIGHT must match PropertyComparisonChart's outer div height.
// CHART_GAP is used both in the column/row formula and as the CSS grid gap.
export const CHART_WIDTH = 340; // minimum column width threshold (px)
export const CHART_HEIGHT = 120; // must match PropertyComparisonChart outer div height (px)
export const CHART_GAP = 16; // px; used in grid gap and layout math
// Space reserved for the pagination row: Pagination control (~32px) + top padding (16px).
// Always reserved (even when pagination is hidden via visibility:hidden) so rows count is stable.
export const PAGINATION_HEIGHT = 48;

type TooltipPayloadItem = {
  dataKey: string;
  name: string;
  value: number;
  payload?: Record<string, unknown>;
};

type TooltipContentProps = TooltipProps<number, string> & {
  title?: string;
};

// Hover-only tooltip: shows value name and percentages.
// Actions are handled by the click popover in PropertyComparisonChart.
const HDXBarChartTooltip = withErrorBoundary(
  memo(({ active, payload, label, title }: TooltipContentProps) => {
    if (active && payload && payload.length) {
      return (
        <div className={styles.chartTooltip}>
          <div className={styles.chartTooltipContent}>
            {title && (
              <Text size="xs" mb="xs">
                {title}
              </Text>
            )}
            <Text size="xs" mb="xs">
              {String(label).length === 0 ? <i>Empty String</i> : String(label)}
            </Text>
            {(payload as TooltipPayloadItem[])
              .sort((a, b) => b.value - a.value)
              .map(p => (
                <div key={p.dataKey}>
                  {p.name}: {p.value.toFixed(2)}%
                </div>
              ))}
          </div>
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

type TickProps = {
  x?: number;
  y?: number;
  payload?: { value: string | number };
};

// Custom XAxis tick that truncates long labels and adds a native SVG tooltip.
function TruncatedTick({ x = 0, y = 0, payload }: TickProps) {
  const value = String(payload?.value ?? '');
  const MAX_CHARS = 12;
  const displayValue =
    value.length > MAX_CHARS ? value.slice(0, MAX_CHARS) + '\u2026' : value;
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{value}</title>
      <text
        x={0}
        y={0}
        dy={12}
        textAnchor="middle"
        fill="var(--color-text-muted)"
        fontSize={10}
        fontFamily="IBM Plex Mono, monospace"
      >
        {displayValue}
      </text>
    </g>
  );
}

export function PropertyComparisonChart({
  name,
  outlierValueOccurences,
  inlierValueOccurences,
  onAddFilter,
}: {
  name: string;
  outlierValueOccurences: Map<string, number>;
  inlierValueOccurences: Map<string, number>;
  onAddFilter?: AddFilterFn;
}) {
  const mergedValueStatistics = mergeValueStatisticsMaps(
    outlierValueOccurences,
    inlierValueOccurences,
  );
  const chartData = applyTopNAggregation(mergedValueStatistics);

  const [clickedBar, setClickedBar] = useState<{
    value: string;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [copiedValue, setCopiedValue] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up copy confirmation timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  // Dismiss popover on click outside, scroll, or Escape key
  useEffect(() => {
    if (!clickedBar) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setClickedBar(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setClickedBar(null);
    };
    const handleScroll = () => setClickedBar(null);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [clickedBar]);

  const handleChartClick = (data: any, event: any) => {
    if (!data?.activePayload?.length) {
      setClickedBar(null);
      return;
    }
    if (data.activePayload[0]?.payload?.isOther) {
      setClickedBar(null);
      return;
    }
    // Reset copy confirmation so it doesn't carry over to the new bar's popover
    setCopiedValue(false);
    setClickedBar({
      value: String(data.activeLabel ?? ''),
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  return (
    <div style={{ width: '100%', height: CHART_HEIGHT }}>
      <Text
        size="xs"
        ta="center"
        title={name}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </Text>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          barGap={2}
          width={500}
          height={300}
          data={chartData}
          margin={{
            top: 0,
            right: 0,
            left: 0,
            bottom: 0,
          }}
          onClick={handleChartClick}
          style={{ cursor: 'pointer' }}
        >
          <XAxis dataKey="name" tick={<TruncatedTick />} />
          <YAxis
            tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <Tooltip
            content={<HDXBarChartTooltip title={name} />}
            allowEscapeViewBox={{ x: false, y: true }}
            wrapperStyle={{ zIndex: 1000 }}
          />
          <Bar
            dataKey="outlierCount"
            name="Selection"
            fill={getChartColorError()}
            isAnimationActive={false}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`out-${index}`}
                fill={entry.isOther ? OTHER_BUCKET_COLOR : getChartColorError()}
              />
            ))}
          </Bar>
          <Bar
            dataKey="inlierCount"
            name="Background"
            fill={getChartColorSuccess()}
            isAnimationActive={false}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`in-${index}`}
                fill={
                  entry.isOther ? OTHER_BUCKET_COLOR : getChartColorSuccess()
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {clickedBar && (
        <Portal>
          <div
            ref={popoverRef}
            className={styles.chartTooltip}
            style={{
              position: 'fixed',
              // Clamp horizontally so the popover stays within the viewport
              left: Math.max(
                160,
                Math.min(clickedBar.clientX, window.innerWidth - 160),
              ),
              // Render above click point; flip below if near the top
              top:
                clickedBar.clientY > 200
                  ? clickedBar.clientY - 8
                  : clickedBar.clientY + 16,
              transform:
                clickedBar.clientY > 200
                  ? 'translate(-50%, -100%)'
                  : 'translate(-50%, 0)',
              zIndex: 10000,
              borderRadius: 4,
              padding: '8px 12px',
              minWidth: 200,
              maxWidth: 320,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}
          >
            <Text
              size="xs"
              c="dimmed"
              fw={600}
              mb={4}
              style={{ wordBreak: 'break-all' }}
              title={name}
            >
              {truncateMiddle(name, 40)}
            </Text>
            <Text size="xs" mb={6} style={{ wordBreak: 'break-all' }}>
              {clickedBar.value.length === 0 ? (
                <i>Empty String</i>
              ) : (
                clickedBar.value
              )}
            </Text>
            <Flex gap={12} mb={8}>
              <Text size="xs" c={getChartColorError()}>
                Selection:{' '}
                {(outlierValueOccurences.get(clickedBar.value) ?? 0).toFixed(1)}
                %
              </Text>
              <Text size="xs" c={getChartColorSuccess()}>
                Background:{' '}
                {(inlierValueOccurences.get(clickedBar.value) ?? 0).toFixed(1)}%
              </Text>
            </Flex>
            <Flex gap={4} align="center">
              {onAddFilter && (
                <>
                  <DBRowTableIconButton
                    variant="copy"
                    title="Filter for this value"
                    onClick={() => {
                      onAddFilter(name, clickedBar.value, 'include');
                      setClickedBar(null);
                    }}
                  >
                    <IconFilter size={12} />
                  </DBRowTableIconButton>
                  <DBRowTableIconButton
                    variant="copy"
                    title="Exclude this value"
                    onClick={() => {
                      onAddFilter(name, clickedBar.value, 'exclude');
                      setClickedBar(null);
                    }}
                  >
                    <IconFilterX size={12} />
                  </DBRowTableIconButton>
                </>
              )}
              <DBRowTableIconButton
                variant="copy"
                title={copiedValue ? 'Copied!' : 'Copy value'}
                isActive={copiedValue}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(clickedBar.value);
                    setCopiedValue(true);
                    if (copyTimeoutRef.current)
                      clearTimeout(copyTimeoutRef.current);
                    copyTimeoutRef.current = setTimeout(
                      () => setCopiedValue(false),
                      2000,
                    );
                  } catch (err) {
                    console.error('Failed to copy:', err);
                  }
                }}
              >
                <IconCopy size={12} />
              </DBRowTableIconButton>
            </Flex>
          </div>
        </Portal>
      )}
    </div>
  );
}
