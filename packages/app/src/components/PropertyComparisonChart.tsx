import { Flex, Text } from '@mantine/core';
import { IconCopy, IconFilter, IconFilterX } from '@tabler/icons-react';
import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { withErrorBoundary } from 'react-error-boundary';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipProps } from 'recharts';

import {
  getChartColorError,
  getChartColorSuccess,
  truncateMiddle,
} from '@/utils';

import { DBRowTableIconButton } from './DBTable/DBRowTableIconButton';
import {
  AddFilterFn,
  ALL_SPANS_COLOR,
  OTHER_BUCKET_COLOR,
  applyTopNAggregation,
  mergeValueStatisticsMaps,
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

// Hover-only tooltip: shows value name and percentages, no action buttons.
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
    value.length > MAX_CHARS ? value.slice(0, MAX_CHARS) + '…' : value;
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{value}</title>
      <text
        x={0}
        y={0}
        dy={12}
        textAnchor="middle"
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
  hasSelection,
  onHoverValue,
}: {
  name: string;
  outlierValueOccurences: Map<string, number>;
  inlierValueOccurences: Map<string, number>;
  onAddFilter?: AddFilterFn;
  hasSelection: boolean;
  onHoverValue?: (property: string, value: string | null) => void;
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
  // Local hover state for bar dimming — dims non-hovered bars for prominence
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const chartWrapperRef = useRef<HTMLDivElement>(null);
  // Track last hovered bar value to avoid firing onHoverValue on every pixel move
  const lastHoveredBarRef = useRef<string | null>(null);

  // Dismiss popover when clicking outside both the popover and the chart wrapper
  useEffect(() => {
    if (!clickedBar) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        chartWrapperRef.current &&
        !chartWrapperRef.current.contains(e.target as Node)
      ) {
        setClickedBar(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [clickedBar]);

  // Dismiss popover on scroll (prevents stale popover when chart scrolls offscreen)
  useEffect(() => {
    if (!clickedBar) return;
    const handleScroll = () => setClickedBar(null);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
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
    <div ref={chartWrapperRef} style={{ width: '100%', height: 120 }}>
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
          onMouseMove={(data: any) => {
            const label = data?.activeLabel;
            const isOther = data?.activePayload?.[0]?.payload?.isOther;
            const newVal = label != null && !isOther ? String(label) : null;
            if (newVal !== lastHoveredBarRef.current) {
              lastHoveredBarRef.current = newVal;
              onHoverValue?.(name, newVal);
              setHoveredBar(newVal);
            }
          }}
          onMouseLeave={() => {
            if (lastHoveredBarRef.current !== null) {
              lastHoveredBarRef.current = null;
              onHoverValue?.(name, null);
            }
            setHoveredBar(null);
          }}
        >
          <XAxis dataKey="name" tick={<TruncatedTick />} />
          <YAxis
            tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <Tooltip
            content={<HDXBarChartTooltip title={name} />}
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 9998 }}
          />
          <Bar
            dataKey="outlierCount"
            name={hasSelection ? 'Selection' : 'All spans'}
            fill={hasSelection ? getChartColorError() : ALL_SPANS_COLOR}
            isAnimationActive={false}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`out-${index}`}
                fill={
                  entry.isOther
                    ? OTHER_BUCKET_COLOR
                    : hasSelection
                      ? getChartColorError()
                      : ALL_SPANS_COLOR
                }
                fillOpacity={
                  hoveredBar !== null && entry.name !== hoveredBar ? 0.2 : 1
                }
              />
            ))}
          </Bar>
          {hasSelection && (
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
                  fillOpacity={
                    hoveredBar !== null && entry.name !== hoveredBar ? 0.2 : 1
                  }
                />
              ))}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
      {clickedBar &&
        createPortal(
          <div
            ref={popoverRef}
            className={styles.chartTooltip}
            style={{
              position: 'fixed',
              left: clickedBar.clientX,
              top: clickedBar.clientY - 8,
              transform: 'translate(-50%, -100%)',
              zIndex: 9999,
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
            {hasSelection ? (
              <Flex gap={12} mb={8}>
                <Text size="xs" c={getChartColorError()}>
                  Selection:{' '}
                  {(outlierValueOccurences.get(clickedBar.value) ?? 0).toFixed(
                    1,
                  )}
                  %
                </Text>
                <Text size="xs" c={getChartColorSuccess()}>
                  Background:{' '}
                  {(inlierValueOccurences.get(clickedBar.value) ?? 0).toFixed(
                    1,
                  )}
                  %
                </Text>
              </Flex>
            ) : (
              <Text size="xs" c="dimmed" mb={8}>
                Distribution:{' '}
                {(outlierValueOccurences.get(clickedBar.value) ?? 0).toFixed(1)}
                %
              </Text>
            )}
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
                    setTimeout(() => setCopiedValue(false), 2000);
                  } catch (err) {
                    console.error('Failed to copy:', err);
                  }
                }}
              >
                <IconCopy size={12} />
              </DBRowTableIconButton>
            </Flex>
          </div>,
          document.body,
        )}
    </div>
  );
}
