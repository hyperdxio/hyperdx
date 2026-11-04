import { memo, useMemo, useState } from 'react';
import cx from 'classnames';
import { Popover } from '@mantine/core';

import { type LineData } from '@/ChartUtils';
import { truncateMiddle } from '@/utils';

import { hasSeriesSelection } from './chartData';
import { MAX_LEGEND_ITEMS } from './constants';

import styles from '@styles/HDXLineChart.module.scss';

function ExpandableLegendItem({
  entry,
  expanded,
  isSelected,
  isDisabled,
  onToggle,
}: {
  entry: any;
  expanded?: boolean;
  isSelected?: boolean;
  isDisabled?: boolean;
  onToggle?: (isShiftKey: boolean) => void;
}) {
  const [_expanded, setExpanded] = useState(false);
  const isExpanded = _expanded || expanded;

  return (
    <span
      className={`d-flex gap-1 items-center justify-center ${styles.legendItem}`}
      style={{
        color: entry.color,
        opacity: isDisabled ? 0.3 : 1,
        fontWeight: isSelected ? 600 : 400,
        cursor: 'pointer',
      }}
      role="button"
      onClick={e => {
        if (onToggle) {
          onToggle(e.shiftKey);
        } else {
          setExpanded(v => !v);
        }
      }}
      title={
        isSelected
          ? 'Click to show all (Shift+click to deselect)'
          : 'Click to show only this (Shift+click for multi-select)'
      }
    >
      <div>
        <svg width="12" height="4">
          <line
            x1="0"
            y1="2"
            x2="12"
            y2="2"
            stroke={entry.color}
            opacity={isDisabled ? 0.3 : 1}
            strokeDasharray={entry.payload?.strokeDasharray}
            strokeWidth={isSelected ? 2.5 : 1.5}
          />
        </svg>
      </div>
      {isExpanded || isSelected
        ? entry.value
        : truncateMiddle(`${entry.value}`, 35)}
    </span>
  );
}

export const LegendRenderer = memo<{
  payload?: {
    dataKey: string;
    value: string;
    color: string;
  }[];
  lineDataMap: { [key: string]: LineData };
  allLineData?: LineData[];
  selectedSeries?: Set<string>;
  onToggleSeries?: (seriesName: string, isShiftKey?: boolean) => void;
}>(props => {
  const { payload, lineDataMap, allLineData, selectedSeries, onToggleSeries } =
    props;

  const hasSelection = hasSeriesSelection(selectedSeries);

  // Use allLineData to ensure all series are always shown in legend
  const allSeriesPayload = useMemo(() => {
    if (allLineData?.length) {
      return allLineData.map(ld => ({
        dataKey: ld.dataKey,
        value: ld.displayName || ld.dataKey,
        color: ld.color,
        payload: { strokeDasharray: ld.isDashed ? '4 3' : '0' },
      }));
    }
    return payload ?? [];
  }, [allLineData, payload]);

  const sortedLegendItems = useMemo(() => {
    // Order items such that current and previous period lines are consecutive
    const currentPeriodKeyIndex = new Map<string, number>();
    allSeriesPayload.forEach((line, index) => {
      const currentPeriodKey =
        lineDataMap[line.dataKey]?.currentPeriodKey || '';
      if (!currentPeriodKeyIndex.has(currentPeriodKey)) {
        currentPeriodKeyIndex.set(currentPeriodKey, index);
      }
    });

    // Copy before sorting: when this comes from Recharts' legend payload it is
    // kept in the Immer-backed store and frozen, so an in-place sort throws.
    return [...allSeriesPayload].sort((a, b) => {
      const keyA = lineDataMap[a.dataKey]?.currentPeriodKey ?? '';
      const keyB = lineDataMap[b.dataKey]?.currentPeriodKey ?? '';

      const indexA = currentPeriodKeyIndex.get(keyA) ?? 0;
      const indexB = currentPeriodKeyIndex.get(keyB) ?? 0;

      return indexB - indexA || a.dataKey.localeCompare(b.dataKey);
    });
  }, [allSeriesPayload, lineDataMap]);

  const shownItems = sortedLegendItems.slice(0, MAX_LEGEND_ITEMS);
  const restItems = sortedLegendItems.slice(MAX_LEGEND_ITEMS);

  return (
    <div className={styles.legend}>
      {shownItems.map((entry, index) => {
        const isSelected = !!selectedSeries?.has(entry.value);
        const isDisabled = hasSelection && !isSelected;
        return (
          <ExpandableLegendItem
            key={`item-${index}`}
            entry={entry}
            isSelected={isSelected}
            isDisabled={isDisabled}
            onToggle={isShiftKey => onToggleSeries?.(entry.value, isShiftKey)}
          />
        );
      })}
      {restItems.length ? (
        <Popover withinPortal withArrow closeOnEscape closeOnClickOutside>
          <Popover.Target>
            <div className={cx(styles.legendItem, styles.legendMoreLink)}>
              +{restItems.length} more
            </div>
          </Popover.Target>
          <Popover.Dropdown p="xs">
            <div className={styles.legendTooltipContent}>
              {restItems.map((entry, index) => {
                const isSelected = !!selectedSeries?.has(entry.value);
                const isDisabled = hasSelection && !isSelected;
                return (
                  <ExpandableLegendItem
                    key={`item-${index}`}
                    entry={entry}
                    isSelected={isSelected}
                    isDisabled={isDisabled}
                    onToggle={isShiftKey =>
                      onToggleSeries?.(entry.value, isShiftKey)
                    }
                  />
                );
              })}
            </div>
          </Popover.Dropdown>
        </Popover>
      ) : null}
    </div>
  );
});
