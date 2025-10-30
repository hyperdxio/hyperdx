import { useState } from 'react';
import { parseAsString, useQueryStates } from 'nuqs';
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
import { Box, Button, Collapse, Flex } from '@mantine/core';
import { ActionIcon } from '@mantine/core';
import { Paper } from '@mantine/core';
import { Center } from '@mantine/core';
import { Text } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';

import { isAggregateFunction } from '@/ChartUtils';
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
  const [container, setContainer] = useState<HTMLElement | null>(null);

  return (
    <Flex
      direction="column"
      w="100%"
      style={{ overflow: 'hidden' }}
      ref={setContainer}
    >
      <Box mx="lg" mt="xs" mb={0}>
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
          onFilter={(xMin, xMax, yMin, yMax) => {
            // Check if the value expression contains aggregate functions
            const isAggregate = isAggregateFunction(fields.value);

            const timestampExpr = getFirstTimestampValueExpression(
              chartConfig.timestampValueExpression,
            );

            if (isAggregate) {
              // For aggregate expressions, we use a subquery approach:
              // The subquery calculates the aggregate per time bucket with HAVING clause,
              // then we filter to only include timestamps from qualifying buckets
              const baseWhereConditions = [
                `${timestampExpr} >= ${xMin}`,
                `${timestampExpr} <= ${xMax}`,
              ];

              // Include existing where conditions if present
              if (chartConfig.where && chartConfig.where.trim()) {
                baseWhereConditions.push(`(${chartConfig.where})`);
              }

              const subquery = `${timestampExpr} IN (SELECT ${timestampExpr} FROM ${chartConfig.from.databaseName}.${chartConfig.from.tableName} WHERE ${baseWhereConditions.join(' AND ')} GROUP BY ${timestampExpr} HAVING (${fields.value}) >= ${yMin} AND (${fields.value}) <= ${yMax})`;

              setFields({
                outlierSqlCondition: subquery,
              });
            } else {
              // For non-aggregate expressions, we can filter directly on the value
              setFields({
                outlierSqlCondition: [
                  `(${fields.value}) >= ${yMin}`,
                  `(${fields.value}) <= ${yMax}`,
                  `${timestampExpr} >= ${xMin}`,
                  `${timestampExpr} <= ${xMax}`,
                ].join(' AND '),
              });
            }
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
