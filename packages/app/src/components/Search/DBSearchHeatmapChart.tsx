import { useCallback, useState } from 'react';
import { parseAsFloat, parseAsString, useQueryStates } from 'nuqs';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  TableConnection,
  tcFromSource,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  BuilderChartConfigWithDateRange,
  DisplayType,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Drawer,
  Flex,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlayerPlay, IconSettings } from '@tabler/icons-react';

import { MS_NUMBER_FORMAT } from '@/ChartUtils';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { getDurationMsExpression } from '@/source';

import type { AddFilterFn } from '../DBDeltaChart';
import DBDeltaChart from '../DBDeltaChart';
import DBHeatmapChart, {
  ColorLegend,
  darkPalette,
  type HeatmapScaleType,
  lightPalette,
} from '../DBHeatmapChart';

const Schema = z.object({
  value: z.string().trim().min(1),
  count: z.string().trim().optional(),
});

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
  const [clearSelectionVersion, setClearSelectionVersion] = useState(0);
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
  const clearSelection = useCallback(() => {
    setFields({ xMin: null, xMax: null, yMin: null, yMax: null });
    setClearSelectionVersion(version => version + 1);
  }, [setFields]);

  // After applying a filter, clear the heatmap selection so the delta chart
  // resets instead of staying in comparison mode.
  const handleAddFilterAndClearSelection = useCallback<
    NonNullable<AddFilterFn>
  >(
    (property, value, action) => {
      clearSelection();
      onAddFilter?.(property, value, action);
    },
    [clearSelection, onAddFilter],
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
                ? MS_NUMBER_FORMAT
                : undefined,
          }}
          enabled={isReady}
          clearSelectionVersion={clearSelectionVersion}
          scaleType={scaleType}
          onFilter={(xMin, xMax, yMin, yMax) => {
            setFields({ xMin, xMax, yMin, yMax });
          }}
        />
        {/* Gear icon overlaid on chart top-right */}
        <Tooltip label="Heatmap settings">
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
        defaultValues={{
          value: fields.value,
          count: fields.count,
        }}
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
          onClearSelection={clearSelection}
          spanIdExpression={source.spanIdExpression}
          legendPrefix={<ColorLegend colors={palette} />}
        />
      </Box>
    </Flex>
  );
}

function HeatmapSettingsDrawer({
  opened,
  onClose,
  connection,
  parentRef,
  defaultValues,
  scaleType,
  onScaleTypeChange,
  onSubmit,
}: {
  opened: boolean;
  onClose: () => void;
  connection: TableConnection;
  parentRef?: HTMLElement | null;
  defaultValues: z.infer<typeof Schema>;
  scaleType: HeatmapScaleType;
  onScaleTypeChange: (v: HeatmapScaleType) => void;
  onSubmit: (v: z.infer<typeof Schema>) => void;
}) {
  const form = useForm({
    resolver: zodResolver(Schema),
    defaultValues,
  });

  const handleClose = useCallback(() => {
    form.reset(defaultValues);
    onClose();
  }, [onClose, form, defaultValues]);

  return (
    <Drawer
      title="Heatmap Settings"
      opened={opened}
      onClose={handleClose}
      position="right"
      size="sm"
    >
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Stack gap="md">
          <Box>
            <Text size="sm" fw={500} mb={4}>
              Scale
            </Text>
            <SegmentedControl
              size="xs"
              value={scaleType}
              onChange={v => onScaleTypeChange(v as HeatmapScaleType)}
              data={[
                { label: 'Log', value: 'log' },
                { label: 'Linear', value: 'linear' },
              ]}
            />
          </Box>

          <Divider />

          <SQLInlineEditorControlled
            parentRef={parentRef}
            tableConnection={connection}
            control={form.control}
            name="value"
            size="xs"
            tooltipText="Controls the Y axis range and scale — defines the metric plotted vertically."
            placeholder="SQL expression"
            language="sql"
            onSubmit={form.handleSubmit(onSubmit)}
            label="Value"
            error={form.formState.errors.value?.message}
            rules={{ required: true }}
          />

          <SQLInlineEditorControlled
            parentRef={parentRef}
            tableConnection={connection}
            control={form.control}
            name="count"
            placeholder="SQL expression"
            language="sql"
            size="xs"
            tooltipText="Controls the color intensity (Z axis) — shows how frequently or strongly each value occurs."
            onSubmit={form.handleSubmit(onSubmit)}
            label="Count"
            error={form.formState.errors.count?.message}
          />

          <Divider />
          <Group gap="xs" justify="flex-end">
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              leftSection={<IconPlayerPlay size={16} />}
            >
              Apply
            </Button>
          </Group>
        </Stack>
      </form>
    </Drawer>
  );
}
