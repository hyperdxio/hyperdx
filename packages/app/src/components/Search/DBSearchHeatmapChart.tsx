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
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Flex, SegmentedControl } from '@mantine/core';
import { Button } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';

import { MS_NUMBER_FORMAT } from '@/ChartUtils';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';
import { getDurationMsExpression } from '@/source';

import type { AddFilterFn } from '../DBDeltaChart';
import DBDeltaChart from '../DBDeltaChart';
import DBHeatmapChart, { type HeatmapScaleType } from '../DBHeatmapChart';

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
  source: TSource;
  isReady: boolean;
  onAddFilter?: AddFilterFn;
}) {
  const [fields, setFields] = useQueryStates({
    value: parseAsString.withDefault(getDurationMsExpression(source)),
    count: parseAsString.withDefault('count()'),
    // Heatmap selection coordinates
    xMin: parseAsFloat,
    xMax: parseAsFloat,
    yMin: parseAsFloat,
    yMax: parseAsFloat,
  });
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [scaleType, setScaleType] = useState<HeatmapScaleType>('log');

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
      style={{ overflow: 'hidden' }}
      ref={setContainer}
    >
      <Box px="sm" pt="xs" mb={0}>
        <Flex align="flex-end" gap="xs">
          <Box style={{ flex: 1 }}>
            <DBSearchHeatmapForm
              connection={tcFromSource(source)}
              defaultValues={{
                value: fields.value,
                count: fields.count,
              }}
              parentRef={container}
              onSubmit={data => {
                setFields({
                  value: data.value,
                  count: data.count,
                });
              }}
            />
          </Box>
          <SegmentedControl
            size="xs"
            mb="xs"
            value={scaleType}
            onChange={v => setScaleType(v as HeatmapScaleType)}
            data={[
              { label: 'Log', value: 'log' },
              { label: 'Linear', value: 'linear' },
            ]}
          />
        </Flex>
      </Box>
      <div
        style={{
          minHeight: 210,
          maxHeight: 210,
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
          scaleType={scaleType}
          onFilter={(xMin, xMax, yMin, yMax) => {
            // Simply store the coordinates - DBDeltaChart will handle the logic
            setFields({
              xMin,
              xMax,
              yMin,
              yMax,
            });
          }}
        />
      </div>
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
        onAddFilter={onAddFilter ? handleAddFilterAndClearSelection : undefined}
        spanIdExpression={source.spanIdExpression}
      />
    </Flex>
  );
}

function DBSearchHeatmapForm({
  connection,
  defaultValues,
  parentRef,
  onSubmit,
}: {
  connection: TableConnection;
  parentRef?: HTMLElement | null;
  defaultValues: z.infer<typeof Schema>;
  onSubmit: (v: z.infer<typeof Schema>) => void;
}) {
  const form = useForm({
    resolver: zodResolver(Schema),
    defaultValues,
  });

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      style={{ position: 'relative' }}
    >
      <Flex m="0" mb="xs" align="stretch" gap="xs">
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
          rules={{ required: true }}
        />

        <Button
          variant="secondary"
          type="submit"
          size="xs"
          leftSection={<IconPlayerPlay size={16} />}
        >
          Run
        </Button>
      </Flex>
    </form>
  );
}
