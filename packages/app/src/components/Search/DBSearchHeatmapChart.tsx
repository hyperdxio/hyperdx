import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseAsFloat, parseAsString, useQueryStates } from 'nuqs';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  BuilderChartConfigWithDateRange,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Flex,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconSettings } from '@tabler/icons-react';

import HeatmapSettingsDrawer from '@/components/HeatmapSettingsDrawer';
import { getDurationMsExpression } from '@/source';
import type { NumberFormat } from '@/types';

import type { AddFilterFn } from '../DBDeltaChart';
import DBDeltaChart from '../DBDeltaChart';
import DBHeatmapChart, {
  ColorLegend,
  darkPalette,
  type HeatmapScaleType,
  lightPalette,
  type SelectionBounds,
  toHeatmapChartConfig,
} from '../DBHeatmapChart';

export function DBSearchHeatmapChart({
  chartConfig,
  source,
  isReady,
  onAddFilter,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  source: TTraceSource;
  isReady: boolean;
  onAddFilter?: AddFilterFn;
}) {
  const [fields, setFields] = useQueryStates({
    value: parseAsString.withDefault(getDurationMsExpression(source)),
    count: parseAsString.withDefault('count()'),
    scaleType: parseAsString.withDefault('log'),
    // Heatmap selection coordinates
    xMin: parseAsFloat,
    xMax: parseAsFloat,
    yMin: parseAsFloat,
    yMax: parseAsFloat,
  });
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const scaleType = (fields.scaleType ?? 'log') as HeatmapScaleType;
  const [settingsOpened, settingsHandlers] = useDisclosure(false);
  const { colorScheme } = useMantineColorScheme();
  const palette = colorScheme === 'light' ? lightPalette : darkPalette;

  const heatmapSettingsDefaults = useMemo(
    () => ({
      value: fields.value,
      count: fields.count ?? 'count()',
      scaleType,
    }),
    [fields.value, fields.count, scaleType],
  );

  // After applying a filter, clear the heatmap selection so the delta chart
  // resets instead of staying in comparison mode.
  const handleAddFilterAndClearSelection = useCallback<
    NonNullable<AddFilterFn>
  >(
    (property, value, action) => {
      setFields({ xMin: null, xMax: null, yMin: null, yMax: null });
      onAddFilter?.(property, value, action);
    },
    [onAddFilter, setFields],
  );

  // Clear the heatmap selection when the time range changes. The visual
  // rectangle goes away on its own (uPlot re-initializes with new data),
  // but without this the xMin/xMax/yMin/yMax URL params would linger and
  // the delta chart would keep running its comparison query against the
  // new time range.
  const fromMs = chartConfig.dateRange[0].getTime();
  const toMs = chartConfig.dateRange[1].getTime();
  const prevDateRangeRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${fromMs}-${toMs}`;
    if (prevDateRangeRef.current != null && prevDateRangeRef.current !== key) {
      setFields({ xMin: null, xMax: null, yMin: null, yMax: null });
    }
    prevDateRangeRef.current = key;
  }, [fromMs, toMs, setFields]);

  // Mirror the URL's selection coordinates onto the heatmap so the dashed
  // rectangle stays in sync after any uPlot recreation. Memoize on the
  // primitive coords so the prop's identity is stable when the URL hasn't
  // changed; otherwise the downstream useEffect would re-fire on every
  // render. (HDX-4147)
  const selectionBounds: SelectionBounds | null = useMemo(() => {
    if (
      fields.xMin == null ||
      fields.xMax == null ||
      fields.yMin == null ||
      fields.yMax == null
    ) {
      return null;
    }
    return {
      xMin: fields.xMin,
      xMax: fields.xMax,
      yMin: fields.yMin,
      yMax: fields.yMax,
    };
  }, [fields.xMin, fields.xMax, fields.yMin, fields.yMax]);

  return (
    <Flex
      direction="column"
      w="100%"
      style={{ overflow: 'hidden', height: '100%' }}
      ref={setContainer}
    >
      <div
        style={{
          minHeight: 260,
          maxHeight: 260,
          width: '100%',
          position: 'relative',
          paddingLeft: 4,
          paddingRight: 4,
        }}
      >
        <DBHeatmapChart
          config={
            toHeatmapChartConfig({
              ...chartConfig,
              select: [
                {
                  valueExpression: fields.value,
                  countExpression: fields.count || undefined,
                  heatmapScaleType: scaleType,
                },
              ],
              numberFormat:
                fields.value === getDurationMsExpression(source)
                  ? ({
                      output: 'duration',
                      factor: 0.001,
                    } satisfies NumberFormat)
                  : undefined,
            }).heatmapConfig
          }
          enabled={isReady}
          scaleType={scaleType}
          selectionBounds={selectionBounds}
          onFilter={(xMin, xMax, yMin, yMax) => {
            setFields({ xMin, xMax, yMin, yMax });
          }}
          onClearFilter={() => {
            setFields({ xMin: null, xMax: null, yMin: null, yMax: null });
          }}
        />
        {/* Gear icon overlaid on chart top-right */}
        <Tooltip label="Display settings">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={settingsHandlers.open}
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              zIndex: 2,
            }}
          >
            <IconSettings size={16} />
          </ActionIcon>
        </Tooltip>
      </div>
      <HeatmapSettingsDrawer
        opened={settingsOpened}
        onClose={settingsHandlers.close}
        connection={tcFromSource(source)}
        parentRef={container}
        defaultValues={heatmapSettingsDefaults}
        onSubmit={data => {
          // Changing value/count/scale changes what the y-axis represents,
          // so drop any existing selection — a rectangle drawn against the
          // old axis doesn't map cleanly to the new one.
          setFields({
            value: data.value,
            count: data.count,
            scaleType: data.scaleType,
            xMin: null,
            xMax: null,
            yMin: null,
            yMax: null,
          });
          settingsHandlers.close();
        }}
      />
      <Box style={{ flex: 1, minHeight: 0 }}>
        <DBDeltaChart
          config={{
            ...chartConfig,
            with: undefined,
          }}
          valueExpr={fields.value}
          xMin={fields.xMin}
          xMax={fields.xMax}
          yMin={fields.yMin}
          yMax={fields.yMax}
          onAddFilter={
            onAddFilter ? handleAddFilterAndClearSelection : undefined
          }
          spanIdExpression={source.spanIdExpression}
          legendPrefix={<ColorLegend colors={palette} />}
        />
      </Box>
    </Flex>
  );
}
