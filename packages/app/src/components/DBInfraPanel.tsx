import { useMemo, useState } from 'react';
import Link from 'next/link';
import { add, min, sub } from 'date-fns';
import {
  convertDateRangeToGranularityString,
  Granularity,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  BuilderChartConfigWithDateRange,
  DisplayType,
  isLogSource,
  isTraceSource,
  MetricsDataType,
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

import { TableSourceForm } from '@/components/Sources/SourceForm';
import { IS_LOCAL_MODE } from '@/config';
import { useAvailableMetricNames } from '@/hooks/useAvailableMetricNames';
import { getMetricNameSql } from '@/otelSemanticConventions';
import { useSource } from '@/source';

import { DBTimeChart } from './DBTimeChart';
import {
  getActiveInfraCorrelations,
  InfraChartSpec,
  InfraCorrelation,
} from './infraCorrelations';
import { KubeTimeline } from './KubeComponents';

function metricNameFor(fieldPrefix: string, chart: InfraChartSpec) {
  return `${fieldPrefix}${chart.field}`;
}

export function buildChartConfig({
  chart,
  fieldPrefix,
  where,
  metricSource,
  dateRange,
  granularity,
}: {
  chart: InfraChartSpec;
  fieldPrefix: string;
  where: string;
  metricSource: TMetricSource;
  dateRange: [Date, Date];
  granularity: Granularity;
}): BuilderChartConfigWithDateRange {
  const metricName = metricNameFor(fieldPrefix, chart);
  return {
    displayType: DisplayType.Line,
    select: [
      {
        aggFn: 'avg',
        metricType: chart.metricType ?? MetricsDataType.Gauge,
        metricName,
        // Matches both names across the k8s cpu.utilization -> cpu.usage
        // semconv rename; undefined for metrics with no migration.
        metricNameSql: getMetricNameSql(metricName),
        // The metric branch of the renderer replaces this with the bucketed
        // value column; the schema still requires a string.
        valueExpression: 'Value',
        aggConditionLanguage: 'lucene',
        aggCondition: chart.where ? `(${where}) AND (${chart.where})` : where,
      },
    ],
    from: metricSource.from,
    where: '',
    whereLanguage: 'lucene',
    groupBy: chart.groupBy?.join(', ') ?? '',
    metricTables: metricSource.metricTables,
    timestampValueExpression: metricSource.timestampValueExpression,
    connection: metricSource.connection,
    numberFormat: chart.numberFormat,
    granularity,
    dateRange,
  };
}

/**
 * One correlation group (Pod / Node / GPU): the metric chart grid plus, for
 * Pod on log sources, the Kubernetes event timeline.
 *
 * Owns its wrapper element so that a group with nothing to show renders no
 * DOM at all. Returning `null` from here — rather than an empty wrapper — is
 * what keeps the parent `Stack`'s 40px gap from being applied to a group that
 * is not visible (a rendered-but-empty div is still a flex item).
 */
const InfraCorrelationGroup = ({
  correlation,
  logSource,
  metricSource,
  resourceAttributes,
  timestamp,
}: {
  correlation: InfraCorrelation;
  logSource: TSource;
  metricSource: TMetricSource | undefined;
  resourceAttributes: Record<string, any> | undefined;
  timestamp: number;
}) => {
  const [range, setRange] = useState<'30m' | '1h' | '1d'>('30m');
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>('sm');
  const { charts, fieldPrefix, requiresMetricAvailability, title } =
    correlation;

  const correlateValue = resourceAttributes?.[correlation.correlateAttribute];
  const where = metricSource
    ? `${metricSource.resourceAttributesExpression}.${correlation.correlateAttribute}:"${correlateValue}"`
    : '';

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

  // Wider than the chart window: this only answers "does this host emit these
  // metrics at all?", and a narrow window would make the section flap in and
  // out as the user scrubs across a gap in the series.
  const availabilityDateRange = useMemo<[Date, Date]>(
    () => [
      sub(new Date(timestamp), { days: 1 }),
      add(new Date(timestamp), { days: 1 }),
    ],
    [timestamp],
  );

  const candidateMetricNames = useMemo(
    () =>
      requiresMetricAvailability
        ? charts.map(chart => metricNameFor(fieldPrefix, chart))
        : [],
    [charts, fieldPrefix, requiresMetricAvailability],
  );

  const isGated = requiresMetricAvailability === true;
  const { availableMetrics, isLoading: isLoadingAvailability } =
    useAvailableMetricNames({
      metricSource,
      correlationWhere: where,
      metricNames: candidateMetricNames,
      dateRange: availabilityDateRange,
      enabled: isGated,
    });

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

  const visibleCharts = useMemo(() => {
    if (!isGated) {
      return charts;
    }
    return charts.filter(chart =>
      availableMetrics.has(metricNameFor(fieldPrefix, chart)),
    );
  }, [charts, fieldPrefix, isGated, availableMetrics]);

  // The tab gate admits a correlate attribute that is present but empty; an
  // empty value would correlate to nothing, so the whole group is dropped.
  const showCharts =
    metricSource != null &&
    visibleCharts.length > 0 &&
    // Only the gated groups wait on the existence query; ungated groups must
    // not be held back by it.
    (!isGated || !isLoadingAvailability);
  const showTimeline =
    correlation.timeline != null && logSource.kind === SourceKind.Log;

  if (!correlateValue || (!showCharts && !showTimeline)) {
    return null;
  }

  return (
    <div>
      {showCharts && metricSource && (
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
            {visibleCharts.map(chart => (
              <Card key={chart.cardTestId} data-testid={chart.cardTestId}>
                <Card.Section py={8} px={8} h={height}>
                  <DBTimeChart
                    title={chart.title}
                    config={buildChartConfig({
                      chart,
                      fieldPrefix,
                      where,
                      metricSource,
                      dateRange,
                      granularity,
                    })}
                    showDisplaySwitcher={false}
                    logReferenceTimestamp={timestamp / 1000}
                  />
                </Card.Section>
              </Card>
            ))}
          </SimpleGrid>
        </div>
      )}
      {showTimeline && correlation.timeline && (
        <Card p="md" mt="xl">
          <Card.Section p="md" py="xs">
            {title} Timeline
          </Card.Section>
          <Card.Section>
            <ScrollArea viewportProps={{ style: { maxHeight: 280 } }}>
              <Box p="md" py="sm">
                <KubeTimeline
                  logSource={logSource}
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
      {activeCorrelations.map(correlation => (
        <InfraCorrelationGroup
          key={correlation.title}
          correlation={correlation}
          logSource={source}
          metricSource={metricSource}
          resourceAttributes={resourceAttributes}
          timestamp={timestamp}
        />
      ))}
    </Stack>
  );
};
