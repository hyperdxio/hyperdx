import { useMemo, useState } from 'react';
import Link from 'next/link';
import { add, min, sub } from 'date-fns';
import {
  convertDateRangeToGranularityString,
  Granularity,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  SourceKind,
  TMetricSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Alert,
  Anchor,
  Box,
  Card,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { convertV1ChartConfigToV2 } from '@/ChartUtils';
import { TableSourceForm } from '@/components/Sources/SourceForm';
import { IS_LOCAL_MODE } from '@/config';
import { useSource } from '@/source';

import {
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
  metricSource: TMetricSource;
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
      // eslint-disable-next-line no-restricted-syntax
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
    return convertDateRangeToGranularityString(dateRange);
  }, [dateRange]);

  return (
    <div data-testid={`infra-subpanel-${fieldPrefix}`}>
      <Group justify="space-between" align="center">
        <Group align="center">
          <h4 className="fs-6 m-0">{title}</h4>
          <SegmentedControl
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
        <Card data-testid="cpu-usage-card">
          <Card.Section py={8} px={8} h={height}>
            <DBTimeChart
              title="CPU Usage (%)"
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
        <Card data-testid="memory-usage-card">
          <Card.Section py={8} px={8} h={height}>
            <DBTimeChart
              title="Memory Used"
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
        <Card data-testid="disk-usage-card">
          <Card.Section py={8} px={8} h={height}>
            <DBTimeChart
              title="Disk Available"
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
  const [editModalOpened, { open: openEditModal, close: closeEditModal }] =
    useDisclosure(false);

  const metricSourceId =
    source.kind === SourceKind.Log || source.kind === SourceKind.Trace
      ? source.metricSourceId
      : undefined;
  const { data: metricSource, isLoading: isLoadingMetricSource } = useSource({
    id: metricSourceId,
    kinds: [SourceKind.Metric],
  });

  const logSource = source.kind === SourceKind.Log ? source : undefined;

  const podUid = rowData?.__hdx_resource_attributes['k8s.pod.uid'];
  const nodeName = rowData?.__hdx_resource_attributes['k8s.node.name'];

  const timestamp = new Date(rowData?.__hdx_timestamp).getTime();

  return (
    <Stack my="md" gap={40}>
      {!metricSource && !isLoadingMetricSource && (
        <>
          <Alert color="yellow" title="No correlated metric source">
            <Text size="sm">
              {metricSourceId
                ? `The correlated metric source for "${source.name}" could not be found.`
                : `Source "${source.name}" does not have a correlated metric source.`}{' '}
              Infrastructure metrics can be displayed when a metric source is
              configured in{' '}
              {IS_LOCAL_MODE ? (
                <Anchor component="button" onClick={openEditModal}>
                  Source Settings
                </Anchor>
              ) : (
                <Anchor component={Link} href="/team">
                  Team Settings
                </Anchor>
              )}
              .
            </Text>
          </Alert>
          {IS_LOCAL_MODE && (
            <Modal
              size="xl"
              opened={editModalOpened}
              onClose={closeEditModal}
              title="Edit Source"
            >
              <TableSourceForm sourceId={source.id} />
            </Modal>
          )}
        </>
      )}
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
          {logSource && (
            <Card p="md" mt="xl">
              <Card.Section p="md" py="xs">
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
                      logSource={logSource}
                      q={`\`k8s.pod.uid\`:"${podUid}"`}
                      dateRange={[
                        sub(new Date(timestamp), { days: 1 }),
                        add(new Date(timestamp), { days: 1 }),
                      ]}
                      anchorEvent={{
                        label: <div className="text-brand">This Event</div>,
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
