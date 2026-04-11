import { useCallback, useMemo, useState } from 'react';
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
  HeatmapScaleType,
  isTraceSource,
  TSource,
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

import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { getDurationMsExpression } from '@/source';
import type { NumberFormat } from '@/types';

import type { AddFilterFn } from './DBDeltaChart';
import DBDeltaChart from './DBDeltaChart';
import DBHeatmapChart, {
  ColorLegend,
  darkPalette,
  lightPalette,
} from './DBHeatmapChart';

function stripTrailingAlias(expression: string): string {
  const normalized = expression.trim();
  if (!normalized) return normalized;

  let parenDepth = 0;
  let bracketDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let aliasStartIndex: number | undefined;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const prev = i > 0 ? normalized[i - 1] : '';

    if (char === "'" && !inDoubleQuote && !inBacktick && prev !== '\\') {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote && !inBacktick && prev !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === '`' && !inSingleQuote && !inDoubleQuote && prev !== '\\') {
      inBacktick = !inBacktick;
      continue;
    }
    if (inSingleQuote || inDoubleQuote || inBacktick) continue;

    if (char === '(') {
      parenDepth++;
      continue;
    }
    if (char === ')') {
      parenDepth--;
      continue;
    }
    if (char === '[') {
      bracketDepth++;
      continue;
    }
    if (char === ']') {
      bracketDepth--;
      continue;
    }

    if (parenDepth === 0 && bracketDepth === 0 && /\s/.test(char)) {
      let j = i;
      while (j < normalized.length && /\s/.test(normalized[j])) j++;
      if (
        normalized.slice(j, j + 2).toUpperCase() === 'AS' &&
        j + 2 < normalized.length &&
        /\s/.test(normalized[j + 2])
      ) {
        aliasStartIndex = i;
      }
    }
  }

  return aliasStartIndex == null
    ? normalized
    : normalized.slice(0, aliasStartIndex).trim();
}

function sanitizeTimestampExpression(timestampValueExpression: string): string {
  return stripTrailingAlias(timestampValueExpression);
}

const Schema = z.object({
  value: z.string().trim().min(1),
  count: z.string().trim().optional(),
});

export type HeatmapSelection = {
  xMin?: number | null;
  xMax?: number | null;
  yMin?: number | null;
  yMax?: number | null;
};

export type HeatmapSettings = {
  valueExpression: string;
  countExpression?: string;
  scaleType: HeatmapScaleType;
};

function defaultValueExpression(source: TSource, valueExpression: string) {
  if (valueExpression.trim()) {
    return valueExpression;
  }
  if (isTraceSource(source)) {
    return getDurationMsExpression(source);
  }
  return '';
}

export default function DBHeatmapWithDeltasChart({
  chartConfig,
  source,
  isReady,
  valueExpression,
  countExpression,
  scaleType,
  selection,
  onSelectionChange,
  onSettingsChange,
  onAddFilter,
}: {
  chartConfig: BuilderChartConfigWithDateRange;
  source: TSource;
  isReady: boolean;
  valueExpression: string;
  countExpression?: string;
  scaleType: HeatmapScaleType;
  selection?: HeatmapSelection;
  onSelectionChange?: (selection: HeatmapSelection) => void;
  onSettingsChange?: (settings: HeatmapSettings) => void;
  onAddFilter?: AddFilterFn;
}) {
  const isControlled = onSettingsChange != null;
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [settingsOpened, settingsHandlers] = useDisclosure(false);
  const [localSelection, setLocalSelection] = useState<HeatmapSelection>({});
  const [localSettings, setLocalSettings] = useState<HeatmapSettings>({
    valueExpression,
    countExpression,
    scaleType,
  });
  const { colorScheme } = useMantineColorScheme();
  const palette = colorScheme === 'light' ? lightPalette : darkPalette;

  const resolvedSettings: HeatmapSettings = isControlled
    ? {
        valueExpression,
        countExpression,
        scaleType,
      }
    : localSettings;

  const resolvedValueExpression = useMemo(
    () => defaultValueExpression(source, resolvedSettings.valueExpression),
    [source, resolvedSettings.valueExpression],
  );
  const resolvedCountExpression = resolvedSettings.countExpression?.trim();
  const resolvedSelection = selection ?? localSelection;

  const setSettings = useCallback(
    (nextSettings: HeatmapSettings) => {
      if (isControlled) {
        onSettingsChange?.(nextSettings);
      } else {
        setLocalSettings(nextSettings);
      }
    },
    [isControlled, onSettingsChange],
  );

  const setSelection = useCallback(
    (nextSelection: HeatmapSelection) => {
      if (onSelectionChange) {
        onSelectionChange(nextSelection);
      } else {
        setLocalSelection(nextSelection);
      }
    },
    [onSelectionChange],
  );

  const handleAddFilterAndClearSelection = useCallback<
    NonNullable<AddFilterFn>
  >(
    (property, value, action) => {
      setSelection({ xMin: null, xMax: null, yMin: null, yMax: null });
      onAddFilter?.(property, value, action);
    },
    [onAddFilter, setSelection],
  );

  const showHeatmapSetupHint = !resolvedValueExpression.trim();
  const spanIdExpression =
    'spanIdExpression' in source ? source.spanIdExpression : undefined;
  const deltaChartConfig = useMemo(() => {
    // DBDeltaChart builds ad-hoc grouped/ordered queries from timestampValueExpression.
    // If the expression carries a trailing alias (e.g. "toStartOfInterval(...) AS __hdx_time_bucket"),
    // ClickHouse can fail in generated GROUP BY clauses. Use alias-free timestamp expressions there.
    const sanitizedTimestampValueExpression = sanitizeTimestampExpression(
      chartConfig.timestampValueExpression,
    );

    return {
      ...chartConfig,
      with: undefined, // Avoid colliding with DBDeltaChart's internal CTE names
      select: 'tuple(_part, _part_offset)', // Keep base config minimal for DBDeltaChart's custom SELECTs
      groupBy: undefined, // Prevent invalid "SELECT * ... GROUP BY" queries in delta queries
      having: undefined, // DBDeltaChart applies HAVING only for aggregate selection paths
      granularity: undefined, // Let DBDeltaChart control grouping via timestamp expression when needed
      timestampValueExpression: sanitizedTimestampValueExpression,
    };
  }, [chartConfig]);

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
        {showHeatmapSetupHint ? (
          <Flex align="center" justify="center" h="100%">
            <Text size="sm" c="dimmed">
              Open heatmap settings and set a Value expression to start.
            </Text>
          </Flex>
        ) : (
          <DBHeatmapChart
            config={{
              ...chartConfig,
              select: [
                {
                  aggFn: 'heatmap',
                  valueExpression: resolvedValueExpression,
                  countExpression: resolvedCountExpression || undefined,
                },
              ],
              granularity: 'auto',
              displayType: DisplayType.Heatmap,
              numberFormat:
                isTraceSource(source) &&
                resolvedValueExpression === getDurationMsExpression(source)
                  ? ({
                      output: 'duration',
                      factor: 0.001,
                    } satisfies NumberFormat)
                  : undefined,
            }}
            enabled={isReady}
            scaleType={resolvedSettings.scaleType}
            onFilter={(xMin, xMax, yMin, yMax) => {
              setSelection({ xMin, xMax, yMin, yMax });
            }}
          />
        )}
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
          value: resolvedValueExpression,
          count: resolvedCountExpression ?? 'count()',
        }}
        scaleType={resolvedSettings.scaleType}
        onScaleTypeChange={nextScaleType =>
          setSettings({
            valueExpression: resolvedValueExpression,
            countExpression: resolvedCountExpression || undefined,
            scaleType: nextScaleType,
          })
        }
        onSubmit={data => {
          setSettings({
            valueExpression: data.value,
            countExpression: data.count?.trim() || undefined,
            scaleType: resolvedSettings.scaleType,
          });
          settingsHandlers.close();
        }}
      />
      <Box style={{ flex: 1, minHeight: 0 }}>
        {showHeatmapSetupHint ? (
          <Flex align="center" justify="center" h="100%">
            <Text size="sm" c="dimmed">
              Event deltas will appear after you set a Value expression.
            </Text>
          </Flex>
        ) : (
          <DBDeltaChart
            config={deltaChartConfig}
            valueExpr={resolvedValueExpression}
            xMin={resolvedSelection.xMin}
            xMax={resolvedSelection.xMax}
            yMin={resolvedSelection.yMin}
            yMax={resolvedSelection.yMax}
            onAddFilter={
              onAddFilter ? handleAddFilterAndClearSelection : undefined
            }
            spanIdExpression={spanIdExpression}
            legendPrefix={<ColorLegend colors={palette} />}
          />
        )}
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
