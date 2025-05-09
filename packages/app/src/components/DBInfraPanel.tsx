import { useMemo, useState } from 'react';
import { add, min, sub } from 'date-fns';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Card,
  Group,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
} from '@mantine/core';

import { convertV1ChartConfigToV2 } from '@/ChartUtils';
import { getEventBody, useSource } from '@/source';

import {
  convertDateRangeToGranularityString,
  Granularity,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_FILESYSTEM_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from '../ChartUtils';

import { DBTimeChart } from './DBTimeChart';
import { KubeTimeline } from './KubeComponents';

const InfraSubpanelGroup = ({
  fieldPrefix,
  metricSource,
  timestamp,
  title,
  where,
}: {
  fieldPrefix: string;
  metricSource: TSource;
  timestamp: any;
  title: string;
  where: string;
}) => {
  const [range, setRange] = useState<'30m' | '1h' | '1d'>('30m');
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>('sm');

  const dateRange = useMemo<[Date, Date]>(() => {
    const duration = {
      '30m': { minutes: 15 },
      '1h': { minutes: 30 },
      '1d': { hours: 12 },
    }[range];
    return [
      sub(new Date(timestamp), duration),
      min([add(new Date(timestamp), duration), new Date()]),
    ];
  }, [timestamp, range]);

  const { cols, height } = useMemo(() => {
    switch (size) {
      case 'sm':
        return { cols: 3, height: 200 };
      case 'md':
        return { cols: 2, height: 250 };
      case 'lg':
        return { cols: 1, height: 320 };
    }
  }, [size]);

  const granularity = useMemo<Granularity>(() => {
    return convertDateRangeToGranularityString(dateRange, 60);
  }, [dateRange]);

  return (
    <div>
      <Group justify="space-between" align="center">
        <Group align="center">
          <h4 className="text-slate-300 fs-6 m-0">{title}</h4>
          <SegmentedControl
            bg="dark.7"
            color="dark.5"
            size="xs"
            data={[
              { label: '30m', value: '30m' },
              { label: '1h', value: '1h' },
              { label: '1d', value: '1d' },
            ]}
            value={range}
            onChange={value => setRange(value as any)}
          />
        </Group>
        <Group align="center">
          <SegmentedControl
            bg="dark.7"
            color="dark.5"
            size="xs"
            data={[
              { label: 'SM', value: 'sm' },
              { label: 'MD', value: 'md' },
              { label: 'LG', value: 'lg' },
            ]}
            value={size}
            onChange={value => setSize(value as any)}
          />
        </Group>
      </Group>
      <SimpleGrid mt="md" cols={cols}>
        <Card p="md">
          <Card.Section p="md" py="xs" withBorder>
            CPU Usage (%)
          </Card.Section>
          <Card.Section py={8} px={4} h={height}>
            <DBTimeChart
              config={convertV1ChartConfigToV2(
                {
                  dateRange,
                  granularity,
                  seriesReturnType: 'column',
                  series: [
                    {
                      type: 'time',
                      where,
                      groupBy: [],
                      aggFn: 'avg',
                      field: `${fieldPrefix}cpu.utilization - Gauge`,
                      table: 'metrics',
                      numberFormat: K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                    },
                  ],
                },
                {
                  metric: metricSource,
                },
              )}
              showDisplaySwitcher={false}
              logReferenceTimestamp={timestamp / 1000}
            />
          </Card.Section>
        </Card>
        <Card p="md">
          <Card.Section p="md" py="xs" withBorder>
            Memory Used
          </Card.Section>
          <Card.Section py={8} px={4} h={height}>
            <DBTimeChart
              config={convertV1ChartConfigToV2(
                {
                  dateRange,
                  granularity,
                  seriesReturnType: 'column',
                  series: [
                    {
                      type: 'time',
                      where,
                      groupBy: [],
                      aggFn: 'avg',
                      field: `${fieldPrefix}memory.usage - Gauge`,
                      table: 'metrics',
                      numberFormat: K8S_MEM_NUMBER_FORMAT,
                    },
                  ],
                },
                {
                  metric: metricSource,
                },
              )}
              showDisplaySwitcher={false}
              logReferenceTimestamp={timestamp / 1000}
            />
          </Card.Section>
        </Card>
        <Card p="md">
          <Card.Section p="md" py="xs" withBorder>
            Disk Available
          </Card.Section>
          <Card.Section py={8} px={4} h={height}>
            <DBTimeChart
              config={convertV1ChartConfigToV2(
                {
                  dateRange,
                  granularity,
                  seriesReturnType: 'column',
                  series: [
                    {
                      type: 'time',
                      where,
                      groupBy: [],
                      aggFn: 'avg',
                      field: `${fieldPrefix}filesystem.available - Gauge`,
                      table: 'metrics',
                      numberFormat: K8S_FILESYSTEM_NUMBER_FORMAT,
                    },
                  ],
                },
                {
                  metric: metricSource,
                },
              )}
              showDisplaySwitcher={false}
              logReferenceTimestamp={timestamp / 1000}
            />
          </Card.Section>
        </Card>
      </SimpleGrid>
    </div>
  );
};

export default ({
  rowData,
  rowId,
  source,
}: {
  rowData?: Record<string, any>;
  rowId: string | undefined | null;
  source: TSource;
}) => {
  const { data: metricSource } = useSource({ id: source.metricSourceId });

  const podUid = rowData?.__hdx_resource_attributes['k8s.pod.uid'];
  const nodeName = rowData?.__hdx_resource_attributes['k8s.node.name'];

  const timestamp = new Date(rowData?.__hdx_timestamp).getTime();

  return (
    <Stack my="md" gap={40}>
      {podUid && (
        <div>
          {metricSource && (
            <InfraSubpanelGroup
              title="Pod"
              where={`${metricSource.resourceAttributesExpression}.k8s.pod.uid:"${podUid}"`}
              fieldPrefix="k8s.pod."
              timestamp={timestamp}
              metricSource={metricSource}
            />
          )}
          {source && (
            <Card p="md" mt="xl">
              <Card.Section p="md" py="xs" withBorder>
                Pod Timeline
              </Card.Section>
              <Card.Section>
                <ScrollArea
                  viewportProps={{
                    style: { maxHeight: 280 },
                  }}
                >
                  <Box p="md" py="sm">
                    <KubeTimeline
                      logSource={source}
                      q={`\`k8s.pod.uid\`:"${podUid}"`}
                      dateRange={[
                        sub(new Date(timestamp), { days: 1 }),
                        add(new Date(timestamp), { days: 1 }),
                      ]}
                      anchorEvent={{
                        label: <div className="text-success">This Event</div>,
                        timestamp: new Date(timestamp).toISOString(),
                      }}
                    />
                  </Box>
                </ScrollArea>
              </Card.Section>
            </Card>
          )}
        </div>
      )}
      {nodeName && metricSource && (
        <InfraSubpanelGroup
          metricSource={metricSource}
          title="Node"
          where={`${metricSource.resourceAttributesExpression}.k8s.node.name:"${nodeName}"`}
          fieldPrefix="k8s.node."
          timestamp={timestamp}
        />
      )}
    </Stack>
  );
};
