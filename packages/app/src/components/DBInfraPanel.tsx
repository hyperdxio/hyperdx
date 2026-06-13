import { useMemo, useState } from 'react';
import Link from 'next/link';
import { add, min, sub } from 'date-fns';
import {
  convertDateRangeToGranularityString,
  Granularity,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  isLogSource,
  isTraceSource,
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

import { DBTimeChart } from './DBTimeChart';
import {
  getActiveInfraCorrelations,
  InfraChartSpec,
} from './infraCorrelations';
import { KubeTimeline } from './KubeComponents';

const InfraSubpanelGroup = ({
  charts,
  fieldPrefix,
  metricSource,
  timestamp,
  title,
  where,
}: {
  charts: InfraChartSpec[];
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
        {charts.map(chart => (
          <Card key={chart.cardTestId} data-testid={chart.cardTestId}>
            <Card.Section py={8} px={8} h={height}>
              <DBTimeChart
                title={chart.title}
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
                        field: `${fieldPrefix}${chart.field} - Gauge`,
                        table: 'metrics',
                        numberFormat: chart.numberFormat,
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
        ))}
      </SimpleGrid>
    </div>
  );
};

export default ({
  rowData,
  source,
}: {
  rowData?: Record<string, any>;
  source: TSource;
}) => {
  const [editModalOpened, { open: openEditModal, close: closeEditModal }] =
    useDisclosure(false);

  const metricSourceId =
    isLogSource(source) || isTraceSource(source)
      ? source.metricSourceId
      : undefined;
  const { data: metricSource, isLoading: isLoadingMetricSource } = useSource({
    id: metricSourceId,
    kinds: [SourceKind.Metric],
  });

  const resourceAttributes = rowData?.__hdx_resource_attributes;
  const activeCorrelations = useMemo(
    () => getActiveInfraCorrelations(resourceAttributes),
    [resourceAttributes],
  );

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
      {activeCorrelations.map(correlation => {
        const value = resourceAttributes?.[correlation.correlateAttribute];
        if (!value) {
          return null;
        }
        const showTimeline =
          correlation.timeline != null && source.kind === SourceKind.Log;
        // Skip rendering an empty container when neither the metric group nor
        // the timeline has anything to show (e.g. no metric source configured
        // on a non-Log source).
        if (!metricSource && !showTimeline) {
          return null;
        }
        return (
          <div key={correlation.title}>
            {metricSource && (
              <InfraSubpanelGroup
                title={correlation.title}
                where={`${metricSource.resourceAttributesExpression}.${correlation.correlateAttribute}:"${value}"`}
                fieldPrefix={correlation.fieldPrefix}
                charts={correlation.charts}
                timestamp={timestamp}
                metricSource={metricSource}
              />
            )}
            {correlation.timeline && source.kind === SourceKind.Log && (
              <Card p="md" mt="xl">
                <Card.Section p="md" py="xs">
                  {correlation.title} Timeline
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
                        q={`\`${correlation.timeline.queryAttribute}\`:"${resourceAttributes?.[correlation.timeline.queryAttribute]}"`}
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
        );
      })}
    </Stack>
  );
};
