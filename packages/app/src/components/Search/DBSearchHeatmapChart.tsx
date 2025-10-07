import { parseAsString, useQueryStates } from 'nuqs';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ChartConfigWithDateRange,
  DisplayType,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Button, Collapse, Flex, TextInput } from '@mantine/core';
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

const Schema = z.object({
  groupBy: z.string().trim().optional(),
  value: z.string().trim().min(1),
  count: z.string().trim().min(1),
});

export function DBSearchHeatmapChart({
  chartConfig,
  source,
}: {
  chartConfig: ChartConfigWithDateRange;
  source: TSource;
}) {
  const [opened, { toggle }] = useDisclosure(false);

  const [fields, setFields] = useQueryStates({
    groupBy: parseAsString.withDefault(''),
    value: parseAsString.withDefault(getDurationMsExpression(source)),
    count: parseAsString.withDefault('count()'),
    outlierSqlCondition: parseAsString,
  });

  return (
    <Flex direction="column" w="100%">
      <Box mx="lg" mt="xs" mb={0}>
        <Collapse in={opened} style={{ flex: 1 }}>
          <DBSearchHeatmapForm
            defaultValues={{
              groupBy: fields.groupBy,
              value: fields.value,
              count: fields.count,
            }}
            onSubmit={data => {
              setFields({
                groupBy: data.groupBy,
                value: data.value,
                count: data.count,
              });
            }}
          />
        </Collapse>
        <Flex justify="flex-end">
          <Button
            onClick={toggle}
            size="xxs"
            variant="subtle"
            color="gray"
            leftSection={<IconSettings size={12} />}
            styles={{
              section: {
                marginRight: '3px',
              },
            }}
          >
            {opened ? 'Hide' : ''} Graph Editor
          </Button>
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
        {/* <div style={{ position: 'absolute', bottom: '20px', left: '20px' }}>
          <IconSettings color="gray" />
        </div> */}
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

function DBSearchHeatmapForm({
  defaultValues,
  onSubmit,
}: {
  defaultValues: z.infer<typeof Schema>;
  onSubmit: (v: z.infer<typeof Schema>) => void;
}) {
  const form = useForm({
    resolver: zodResolver(Schema),
    defaultValues,
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Flex gap="xs" align="end" m="0" mb="xs">
        <Flex gap="xs" align="start" m="0" flex="1">
          <TextInput
            placeholder="Value"
            label="Value"
            flex={1}
            {...form.register('value')}
            error={form.formState.errors.value?.message}
            required
          />
          <TextInput
            placeholder="Count"
            label="Count"
            flex={1}
            {...form.register('count')}
            error={form.formState.errors.count?.message}
            required
          />
          <TextInput
            placeholder="Group by"
            label="Group by"
            flex={1}
            {...form.register('groupBy')}
            error={form.formState.errors.groupBy?.message}
          />
        </Flex>
        {/* mb below is to align the play button with the text inputs */}
        <ActionIcon
          variant="outline"
          type="submit"
          size="lg"
          mb="1px"
          title="Run"
        >
          <IconPlayerPlay />
        </ActionIcon>
      </Flex>
    </form>
  );
}
