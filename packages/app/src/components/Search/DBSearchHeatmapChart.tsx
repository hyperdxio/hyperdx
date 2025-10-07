import { parseAsString, useQueryStates } from 'nuqs';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ChartConfigWithDateRange,
  DisplayType,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Flex, InputLabel } from '@mantine/core';
import { Input } from '@mantine/core';
import { ActionIcon } from '@mantine/core';
import { Paper } from '@mantine/core';
import { Center } from '@mantine/core';
import { Text } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';

import {
  getDurationMsExpression,
  getFirstTimestampValueExpression,
} from '@/source';

import DBDeltaChart from '../DBDeltaChart';
import DBHeatmapChart from '../DBHeatmapChart';

const Schema = z.object({
  groupBy: z.string(),
  value: z.string(),
  count: z.string(),
});

export function DBSearchHeatmapChart({
  chartConfig,
  source,
}: {
  chartConfig: ChartConfigWithDateRange;
  source: TSource;
}) {
  const [fields, setFields] = useQueryStates({
    groupBy: parseAsString.withDefault(''),
    value: parseAsString.withDefault(getDurationMsExpression(source)),
    count: parseAsString.withDefault('count()'),
    outlierSqlCondition: parseAsString,
  });

  const form = useForm({
    resolver: zodResolver(Schema),
    reValidateMode: 'onSubmit',
    defaultValues: {
      groupBy: fields.groupBy,
      value: fields.value,
      count: fields.count,
    },
  });

  const onSubmit = (data: z.infer<typeof Schema>) => {
    setFields({
      groupBy: data.groupBy,
      value: data.value,
      count: data.count,
    });
  };

  return (
    <Flex direction="column" w="100%">
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Flex gap="xs" align="center" m="xs" mb="0">
          <InputLabel>Value</InputLabel>
          <Input placeholder="Value" flex={1} {...form.register('value')} />
          <InputLabel>Count</InputLabel>
          <Input placeholder="Count" flex={1} {...form.register('count')} />
          <InputLabel>Group by</InputLabel>
          <Input
            placeholder="Group by"
            flex={1}
            {...form.register('groupBy')}
          />
          <ActionIcon variant="outline" type="submit">
            <IconPlayerPlay />
          </ActionIcon>
        </Flex>
      </form>
      <div style={{ minHeight: 210, maxHeight: 210, width: '100%' }}>
        <DBHeatmapChart
          config={{
            ...chartConfig,
            select: [
              {
                aggFn: 'heatmap',
                valueExpression: fields.value,
                countExpression: fields.count,
                groupExpression: fields.groupBy,
              },
            ],
            granularity: 'auto',
            displayType: DisplayType.Heatmap,
          }}
          enabled={true}
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
            // dateRange: searchedTimeRange,
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
