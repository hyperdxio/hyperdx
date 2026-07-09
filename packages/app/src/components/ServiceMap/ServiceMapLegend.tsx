import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { Group, Stack, Text } from '@mantine/core';

import { formatDurationMs } from '@/utils';

import type { ServiceMapMetricMax } from './ServiceMapMetricContext';
import {
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
  // Only treat missing/invalid data as "n/a"; a real zero (e.g. a map with no
  // errors) is meaningful and should render as a formatted 0 for its metric.
  if (!Number.isFinite(max) || max < 0) {
    return 'n/a';
  }
  switch (metric) {
    case 'errorRate':
      return max === 0 ? '0%' : `${max.toFixed(max < 10 ? 1 : 0)}%`;
    case 'latency':
      // A zero latency max is a "no latency data" sentinel (see
      // getServiceMetricValue), not a genuine 0ms, so surface it as n/a.
      return max === 0
        ? 'n/a'
        : `~${formatDurationMs(rawDurationToMs(max, source.durationPrecision ?? 3))}`;
    case 'throughput':
      return isSingleTrace
        ? `${max} reqs`
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

  // Latency is a p95 aggregate; spell that out in the legend (but not the
  // toggle, which stays compact) so the max value is unambiguous.
  const label =
    metric === 'latency'
      ? `${SERVICE_MAP_METRIC_LABEL[metric]} (p95)`
      : SERVICE_MAP_METRIC_LABEL[metric];

  return (
    <Stack gap={4}>
      <Text size="xxs" c="var(--color-text-muted)">
        {label}
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
