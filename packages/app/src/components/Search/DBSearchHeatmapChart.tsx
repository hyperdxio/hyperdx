import { useCallback, useMemo, useState } from 'react';
import { parseAsFloat, parseAsString, useQueryStates } from 'nuqs';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  BuilderChartConfigWithDateRange,
  DisplayType,
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
  const setScaleType = useCallback(
    (v: HeatmapScaleType) => {
      void setFields({ scaleType: v });
    },
    [setFields],
  );
  const [settingsOpened, settingsHandlers] = useDisclosure(false);
  const { colorScheme } = useMantineColorScheme();
  const palette = colorScheme === 'light' ? lightPalette : darkPalette;

  const heatmapSettingsDefaults = useMemo(
    () => ({
      value: fields.value,
      count: fields.count ?? 'count()',
    }),
    [fields.value, fields.count],
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
          config={{
            ...chartConfig,
            select: [
              {
                aggFn: 'heatmap',
                valueExpression: fields.value,
                countExpression: fields.count || undefined,
              },
            ],
            granularity: 'auto',
            displayType: DisplayType.Heatmap,
            numberFormat:
              fields.value === getDurationMsExpression(source)
                ? ({
                    output: 'duration',
                    factor: 0.001,
                  } satisfies NumberFormat)
                : undefined,
          }}
          enabled={isReady}
          scaleType={scaleType}
          onFilter={(xMin, xMax, yMin, yMax) => {
            setFields({ xMin, xMax, yMin, yMax });
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
        scaleType={scaleType}
        onScaleTypeChange={setScaleType}
        onSubmit={data => {
          setFields({
            value: data.value,
            count: data.count,
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
