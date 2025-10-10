import { parseAsString, useQueryStates } from 'nuqs';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  TableConnection,
  tcFromSource,
} from '@hyperdx/common-utils/dist/metadata';
import {
  ChartConfigWithDateRange,
  DisplayType,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Button, Collapse, Flex } from '@mantine/core';
import { ActionIcon } from '@mantine/core';
import { Paper } from '@mantine/core';
import { Center } from '@mantine/core';
import { Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlayerPlay, IconSettings } from '@tabler/icons-react';

import {
  getDurationMsExpression,
  getFirstTimestampValueExpression,
} from '@/source';

import DBDeltaChart from '../DBDeltaChart';
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
}: {
  chartConfig: ChartConfigWithDateRange;
  source: TSource;
  isReady: boolean;
}) {
  const [fields, setFields] = useQueryStates({
    value: parseAsString.withDefault(getDurationMsExpression(source)),
    count: parseAsString.withDefault('count()'),
    outlierSqlCondition: parseAsString,
  });

  return (
    <Flex direction="column" w="100%" style={{ overflow: 'hidden' }}>
      <Box mx="lg" mt="xs" mb={0}>
        <DBSearchHeatmapForm
          connection={tcFromSource(source)}
          defaultValues={{
            value: fields.value,
            count: fields.count,
          }}
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
          onFilter={(xMin, xMax, yMin, yMax) => {
            setFields({
              outlierSqlCondition: [
                `${source.durationExpression} >= ${yMin} * 1e${(source.durationPrecision ?? 9) - 3}`,
                `${source.durationExpression} <= ${yMax} * 1e${(source.durationPrecision ?? 9) - 3}`,
                `${getFirstTimestampValueExpression(chartConfig.timestampValueExpression)} >= ${xMin}`,
                `${getFirstTimestampValueExpression(chartConfig.timestampValueExpression)} <= ${xMax}`,
              ].join(' AND '),
            });
          }}
        />
      </div>
      {fields.outlierSqlCondition ? (
        <DBDeltaChart
          config={{
            ...chartConfig,
            with: undefined,
          }}
          outlierSqlCondition={fields.outlierSqlCondition}
        />
      ) : (
        <Paper shadow="xs" p="xl" h="100%">
          <Center mih={100} h="100%">
            <Text size="sm" c="gray.4">
              Please highlight an outlier range in the heatmap to view the delta
              chart.
            </Text>
          </Center>
        </Paper>
      )}
    </Flex>
  );
}

function DBSearchHeatmapForm({
  connection,
  defaultValues,
  onSubmit,
}: {
  connection: TableConnection;
  defaultValues: z.infer<typeof Schema>;
  onSubmit: (v: z.infer<typeof Schema>) => void;
}) {
  const form = useForm({
    resolver: zodResolver(Schema),
    defaultValues,
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Flex m="0" mb="xs" align="stretch" gap="xs">
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SQLInlineEditorControlled
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
        <ActionIcon
          w="40px"
          variant="outline"
          type="submit"
          h="auto"
          title="Run"
        >
          <IconPlayerPlay />
        </ActionIcon>
      </Flex>
    </form>
  );
}
