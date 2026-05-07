import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BuilderChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Group, Popover, Portal } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

import { buildEventsSearchUrl } from '@/ChartUtils';
import DBHeatmapChart, {
  toHeatmapChartConfig,
} from '@/components/DBHeatmapChart';

type HeatmapTileProps = {
  keyPrefix: string;
  chartId: string;
  title: React.ReactNode;
  toolbar: React.ReactNode[];
  queriedConfig: BuilderChartConfigWithDateRange;
  source: TSource | undefined;
  dateRange: [Date, Date];
};

export function HeatmapTile({
  keyPrefix,
  chartId,
  title,
  toolbar,
  queriedConfig,
  source,
  dateRange,
}: HeatmapTileProps) {
  const { heatmapConfig, scaleType } = toHeatmapChartConfig(queriedConfig);

  const [clickPos, setClickPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  const eventDeltasUrl = useMemo(() => {
    if (!source) return null;
    const url = buildEventsSearchUrl({
      source,
      config: queriedConfig,
      dateRange,
    });
    if (!url) return null;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}mode=delta`;
  }, [source, queriedConfig, dateRange]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!eventDeltasUrl) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setClickPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [eventDeltasUrl],
  );

  const dismiss = useCallback(() => setClickPos(null), []);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%' }}
      onClick={handleClick}
    >
      <DBHeatmapChart
        key={`${keyPrefix}-${chartId}`}
        title={title}
        toolbarPrefix={toolbar}
        config={heatmapConfig}
        scaleType={scaleType}
        showLegend
      />
      {clickPos != null && eventDeltasUrl != null && (
        <>
          <Portal>
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 199,
              }}
              onClick={e => {
                e.stopPropagation();
                e.preventDefault();
                dismiss();
              }}
              onMouseDown={e => e.stopPropagation()}
            />
          </Portal>
          <Popover
            opened
            onChange={opened => {
              if (!opened) dismiss();
            }}
            position="bottom-start"
            offset={4}
            withinPortal
            closeOnEscape
            withArrow
            shadow="md"
          >
            <Popover.Target>
              <div
                style={{
                  position: 'absolute',
                  left: clickPos.x,
                  top: clickPos.y,
                  width: 1,
                  height: 1,
                  pointerEvents: 'none',
                }}
              />
            </Popover.Target>
            <Popover.Dropdown
              p="xs"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <Link
                data-testid="heatmap-view-event-deltas-link"
                href={eventDeltasUrl}
                onClick={dismiss}
              >
                <Group gap="xs">
                  <IconSearch size={16} />
                  View in Event Deltas
                </Group>
              </Link>
            </Popover.Dropdown>
          </Popover>
        </>
      )}
    </div>
  );
}
