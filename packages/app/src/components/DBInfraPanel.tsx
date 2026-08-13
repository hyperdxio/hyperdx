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
import {
  GpuMetricsAvailability,
  resolveChartAvailability,
  useGpuMetricsAvailability,
} from '@/hooks/useGpuMetricsAvailability';
import { useSource } from '@/source';

import { DBTimeChart } from './DBTimeChart';
import {
  getActiveInfraCorrelations,
  InfraChartSpec,
  InfraCorrelation,
} from './infraCorrelations';
import { KubeTimeline } from './KubeComponents';

function buildChartConfig(
  chart: InfraChartSpec,
  fieldPrefix: string,
  where: string,
  metricSource: TMetricSource,
  dateRange: [Date, Date],
  granularity: Granularity,
  mode: 'primary' | 'fallback',
) {
  const metricType = chart.metricType ?? 'Gauge';

  if (mode === 'fallback' && chart.fallback) {
    const [numField, denField] = chart.fallback.fields;
    const fallbackType = chart.fallback.metricType;
    const seriesWhere = chart.where ? `(${where}) AND (${chart.where})` : where;
    return convertV1ChartConfigToV2(
      {
        dateRange,
        granularity,
        seriesReturnType: 'ratio',
        series: [
          {
            type: 'time',
            where: seriesWhere,
            groupBy: chart.groupBy ? [...chart.groupBy] : [],
            aggFn: 'avg',
            field: `${fieldPrefix}${numField} - ${fallbackType}`,
            table: 'metrics',
            numberFormat: chart.fallback.numberFormat,
          },
          {
            type: 'time',
            where: seriesWhere,
            groupBy: chart.groupBy ? [...chart.groupBy] : [],
            aggFn: 'avg',
            field: `${fieldPrefix}${denField} - ${fallbackType}`,
            table: 'metrics',
            numberFormat: chart.fallback.numberFormat,
          },
        ],
      },
      { metric: metricSource },
    );
  }

  const seriesWhere = chart.where ? `(${where}) AND (${chart.where})` : where;
  return convertV1ChartConfigToV2(
    {
      dateRange,
      granularity,
      seriesReturnType: 'column',
      series: [
        {
          type: 'time',
          where: seriesWhere,
          groupBy: chart.groupBy ? [...chart.groupBy] : [],
          aggFn: 'avg',
          field: `${fieldPrefix}${chart.field} - ${metricType}`,
          table: 'metrics',
          numberFormat: chart.numberFormat,
        },
      ],
    },
    { metric: metricSource },
  );
}

const InfraSubpanelGroup = ({
  charts,
  fieldPrefix,
  metricSource,
  timestamp,
  title,
  where,
  availability,
}: {
  charts: readonly InfraChartSpec[];
  fieldPrefix: string;
  metricSource: TMetricSource;
  timestamp: number;
  title: string;
  where: string;
  availability?: GpuMetricsAvailability;
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

  // When availability is provided, resolve each chart to primary/fallback/none.
  const resolvedCharts = useMemo(() => {
    if (!availability) {
      return charts.map(chart => ({ chart, mode: 'primary' as const }));
    }
    return charts.reduce<
      { chart: InfraChartSpec; mode: 'primary' | 'fallback' }[]
    >((acc, chart) => {
      const mode = resolveChartAvailability(fieldPrefix, chart, availability);
      if (mode !== 'none') {
        acc.push({ chart, mode });
      }
      return acc;
    }, []);
  }, [charts, availability, fieldPrefix]);

  if (resolvedCharts.length === 0) {
    return null;
  }

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
            onChange={value => setRange(value as '30m' | '1h' | '1d')}
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
            onChange={value => setSize(value as 'sm' | 'md' | 'lg')}
          />
        </Group>
      </Group>
      <SimpleGrid mt="md" cols={cols}>
        {resolvedCharts.map(({ chart, mode }) => (
          <Card key={chart.cardTestId} data-testid={chart.cardTestId}>
            <Card.Section py={8} px={8} h={height}>
              <DBTimeChart
                title={chart.title}
                config={buildChartConfig(
                  chart,
                  fieldPrefix,
                  where,
                  metricSource,
                  dateRange,
                  granularity,
                  mode,
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

/**
 * Wrapper that fetches GPU metric availability and only renders the group
 * when at least one chart has data. Returns null while loading or when empty.
 */
const AvailabilityGatedGroup = ({
  correlation,
  metricSource,
  timestamp,
  where,
}: {
  correlation: InfraCorrelation;
  metricSource: TMetricSource;
  timestamp: number;
  where: string;
}) => {
  // Wide window for the existence check — we only need a boolean "are there
  // any GPU metrics for this host?" answer, not precise time-aligned data.
  const dateRange = useMemo<[Date, Date]>(
    () => [
      sub(new Date(timestamp), { days: 1 }),
      add(new Date(timestamp), { days: 1 }),
    ],
    [timestamp],
  );

  const availability = useGpuMetricsAvailability({
    metricSource,
    correlationWhere: where,
    dateRange,
  });

  if (availability.isLoading || !availability.hasAny) {
    return null;
  }

  return (
    <InfraSubpanelGroup
      title={correlation.title}
      where={where}
      fieldPrefix={correlation.fieldPrefix}
      charts={correlation.charts}
      timestamp={timestamp}
      metricSource={metricSource}
      availability={availability}
    />
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
        if (!metricSource && !showTimeline) {
          return null;
        }

        const correlationWhere = metricSource
          ? `${metricSource.resourceAttributesExpression}.${correlation.correlateAttribute}:"${value}"`
          : '';

        return (
          <div key={correlation.title}>
            {metricSource &&
              (correlation.requiresMetricAvailability ? (
                <AvailabilityGatedGroup
                  correlation={correlation}
                  metricSource={metricSource}
                  timestamp={timestamp}
                  where={correlationWhere}
                />
              ) : (
                <InfraSubpanelGroup
                  title={correlation.title}
                  where={correlationWhere}
                  fieldPrefix={correlation.fieldPrefix}
                  charts={correlation.charts}
                  timestamp={timestamp}
                  metricSource={metricSource}
                />
              ))}
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
