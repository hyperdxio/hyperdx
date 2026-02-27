import { useCallback, useEffect, useRef, useState } from 'react';
import { parseAsFloat, parseAsString, useQueryStates } from 'nuqs';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  TableConnection,
  tcFromSource,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  ChartConfigWithDateRange,
  DisplayType,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Button, Flex } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';

import { getDurationMsExpression } from '@/source';

import DBDeltaChart, { AddFilterFn, HighlightPoint } from '../DBDeltaChart';
import DBHeatmapChart from '../DBHeatmapChart';
import { SQLInlineEditorControlled } from '../SQLInlineEditor';

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
  chartConfig: ChartConfigWithDateRange;
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

  // Highlight points from hovering an attribute value in the delta charts.
  // Passed to the heatmap to draw filled cell overlays at the correct X+Y position.
  const [highlightPoints, setHighlightPoints] = useState<
    HighlightPoint[] | null
  >(null);

  const handleClearSelection = useCallback(() => {
    setFields({ xMin: null, xMax: null, yMin: null, yMax: null });
  }, [setFields]);

  // After applying a filter, clear the heatmap selection so the delta chart
  // resets to "all spans" distribution mode instead of staying in comparison mode.
  const handleAddFilterAndClearSelection = useCallback<
    NonNullable<AddFilterFn>
  >(
    (property, value, action) => {
      setFields({ xMin: null, xMax: null, yMin: null, yMax: null });
      onAddFilter?.(property, value, action);
    },
    [onAddFilter, setFields],
  );

  // When the user changes the timeframe, reset any existing selection so the
  // delta chart returns to distribution-only mode (no comparison).
  // Use primitive timestamp values as deps (not the Date array reference) so
  // the effect only runs when the actual date values change, not on every render.
  const dateRangeStart = chartConfig.dateRange[0].getTime();
  const dateRangeEnd = chartConfig.dateRange[1].getTime();
  const isFirstDateRangeRender = useRef(true);
  useEffect(() => {
    if (isFirstDateRangeRender.current) {
      isFirstDateRangeRender.current = false;
      return;
    }
    setFields({ xMin: null, xMax: null, yMin: null, yMax: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRangeStart, dateRangeEnd]);

  return (
    <Flex
      direction="column"
      w="100%"
      style={{ overflow: 'hidden' }}
      ref={setContainer}
    >
      <Box px="sm" pt="xs" mb={0}>
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
          }}
          enabled={isReady}
          highlightPoints={highlightPoints}
          onFilter={(xMin, xMax, yMin, yMax) => {
            setFields({
              xMin,
              xMax,
              yMin,
              yMax,
            });
          }}
          onClearSelection={handleClearSelection}
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
        onHighlightPoints={setHighlightPoints}
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
        <div style={{ flex: 1, overflow: 'hidden' }}>
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
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
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
        </div>

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
