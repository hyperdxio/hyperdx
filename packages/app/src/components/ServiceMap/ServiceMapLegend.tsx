import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { Group, Stack, Text } from '@mantine/core';

import { formatDurationMs } from '@/utils';

import type { ServiceMapMetricMax } from './ServiceMapMetricContext';
import {
  ERROR_RATE_ELEVATED,
  ERROR_RATE_HIGH,
  formatRate,
  getMetricGradientCss,
  getRequestsPerSecond,
  rawDurationToMs,
  SERVICE_MAP_METRIC_LABEL,
  ServiceMapMetric,
} from './utils';

import styles from './ServiceMap.module.scss';

/**
 * Labels the top of the active metric's color scale. Latency and throughput
 * are normalized against the graph, so their label is the graph-wide max;
 * error rate is bucketed on absolute thresholds and ignores `max`.
 */
function formatMax(
  metric: ServiceMapMetric,
  max: number,
  source: TTraceSource,
  dateRange: [Date, Date],
  isSingleTrace?: boolean,
): string {
  // Only treat missing/invalid data as "n/a"; a real zero is meaningful and
  // should render as a formatted 0 for its metric.
  if (!Number.isFinite(max) || max < 0) {
    return 'n/a';
  }
  switch (metric) {
    case 'errorRate':
      // Error rate is bucketed on absolute thresholds rather than normalized
      // against the graph, so the scale ends at the top bucket, not at `max`.
      return `≥${ERROR_RATE_HIGH}%`;
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
          {metric === 'errorRate' ? 'none' : 'low'}
        </Text>
        {/* Lands on the right stop only while the bar has four equal
            segments, which puts the 1% threshold at its midpoint. */}
        {metric === 'errorRate' && (
          <Text size="xxs" c="var(--color-text-muted)">
            {ERROR_RATE_ELEVATED}%
          </Text>
        )}
        <Text size="xxs" c="var(--color-text)">
          {formatMax(metric, max, source, dateRange, isSingleTrace)}
        </Text>
      </Group>
      {metric === 'errorRate' && (
        <Text size="xxs" c="var(--color-text-muted)">
          Hollow = no data
        </Text>
      )}
      <Text size="xxs" c="var(--color-text-muted)">
        Node size = throughput
      </Text>
    </Stack>
  );
}
