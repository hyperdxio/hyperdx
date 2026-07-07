import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { Group, Stack, Text } from '@mantine/core';

import { formatDurationMs } from '@/utils';

import type { ServiceMapMetricMax } from './ServiceMapMetricContext';
import {
  formatApproximateNumber,
  formatRate,
  getMetricGradientCss,
  getRequestsPerSecond,
  rawDurationToMs,
  SERVICE_MAP_METRIC_LABEL,
  ServiceMapMetric,
} from './utils';

import styles from './ServiceMap.module.scss';

/**
 * Formats the graph-wide max for the active metric into a human label so the
 * relative (max-normalized) color ramp is interpretable — e.g. the fully
 * saturated end of the scale corresponds to this value.
 */
function formatMax(
  metric: ServiceMapMetric,
  max: number,
  source: TTraceSource,
  dateRange: [Date, Date],
  isSingleTrace?: boolean,
): string {
  if (!(max > 0)) {
    return 'n/a';
  }
  switch (metric) {
    case 'errorRate':
      return `${max.toFixed(max < 10 ? 1 : 0)}%`;
    case 'latency':
      return `~${formatDurationMs(rawDurationToMs(max, source.durationPrecision ?? 3))}`;
    case 'throughput':
      return isSingleTrace
        ? `${formatApproximateNumber(max)} reqs`
        : formatRate(getRequestsPerSecond(max, dateRange));
  }
}

export default function ServiceMapLegend({
  metric,
  metricMax,
  source,
  dateRange,
  isSingleTrace,
}: {
  metric: ServiceMapMetric;
  metricMax: ServiceMapMetricMax;
  source: TTraceSource;
  dateRange: [Date, Date];
  isSingleTrace?: boolean;
}) {
  const max = metricMax[metric];

  return (
    <Stack gap={4}>
      <Text size="xxs" c="var(--color-text-muted)">
        {SERVICE_MAP_METRIC_LABEL[metric]}
      </Text>
      <div
        className={styles.legendGradient}
        style={{ background: getMetricGradientCss(metric) }}
      />
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xxs" c="var(--color-text-muted)">
          low
        </Text>
        <Text size="xxs" c="var(--color-text)">
          {formatMax(metric, max, source, dateRange, isSingleTrace)}
        </Text>
      </Group>
      <Text size="xxs" c="var(--color-text-muted)">
        Node size = throughput
      </Text>
    </Stack>
  );
}
