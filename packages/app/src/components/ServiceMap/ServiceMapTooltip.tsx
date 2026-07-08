import { useCallback } from 'react';
import SqlString from 'sqlstring';
import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { Button, Divider, Group, Stack, Text } from '@mantine/core';
import {
  IconActivity,
  IconClock,
  IconSearch,
  IconTarget,
} from '@tabler/icons-react';

import { formatDurationMs } from '@/utils';

import {
  formatApproximateNumber,
  formatRate,
  navigateToTraceSearch,
} from './utils';

import styles from './ServiceMap.module.scss';

export default function ServiceMapTooltip({
  totalRequests,
  errorPercentage,
  latencyMs,
  requestsPerSecond,
  source,
  dateRange,
  serviceName,
  isSingleTrace,
  onFocus,
}: {
  totalRequests: number;
  errorPercentage: number;
  // p50/p95/p99 already converted to milliseconds; omitted when unavailable.
  latencyMs?: { p50: number; p95: number; p99: number };
  // Throughput; omitted for single-trace maps where a rate is meaningless.
  requestsPerSecond?: number;
  source: TTraceSource;
  dateRange: [Date, Date];
  serviceName: string;
  isSingleTrace?: boolean;
  // When provided, renders a "Focus" action that filters the map to this
  // service and its immediate dependencies.
  onFocus?: () => void;
}) {
  const requestText = `${isSingleTrace ? totalRequests : formatApproximateNumber(totalRequests)} incoming request${
    totalRequests !== 1 ? 's' : ''
  }`;
  const errorsText = `${errorPercentage.toFixed(2)}% errors`;
  // Only alarm (red) once errors are non-trivial; a fraction of a percent reads
  // as amber and a clean service stays neutral-danger-free.
  const errorColor =
    errorPercentage >= 5
      ? 'var(--color-text-danger)'
      : 'var(--color-chart-warning)';

  const handleRequestsClick = useCallback(() => {
    navigateToTraceSearch({
      dateRange,
      source,
      where: SqlString.format("? = ? AND ? IN ('Server', 'Consumer')", [
        SqlString.raw(source.serviceNameExpression ?? 'ServiceName'),
        serviceName,
        SqlString.raw(source.spanKindExpression ?? 'SpanKind'),
      ]),
    });
  }, [dateRange, source, serviceName]);

  const handleErrorsClick = useCallback(() => {
    navigateToTraceSearch({
      dateRange,
      source,
      where: SqlString.format(
        "? = ? AND ? IN ('Server', 'Consumer') AND ? = 'Error'",
        [
          SqlString.raw(source.serviceNameExpression ?? 'ServiceName'),
          serviceName,
          SqlString.raw(source.spanKindExpression ?? 'SpanKind'),
          SqlString.raw(source.statusCodeExpression ?? 'StatusCode'),
        ],
      ),
    });
  }, [dateRange, source, serviceName]);

  const showMetrics =
    totalRequests > 0 && (requestsPerSecond != null || latencyMs != null);

  return (
    <Stack className={styles.toolbar} gap={4} align="stretch" miw={220}>
      <Text
        fw={600}
        size="sm"
        c="var(--color-text)"
        px="xs"
        pt={4}
        lineClamp={1}
        title={serviceName}
      >
        {serviceName}
      </Text>
      <Divider color="var(--color-border)" />
      <Button
        onClick={handleRequestsClick}
        variant="subtle"
        size="xs"
        color="var(--color-text)"
        justify="space-between"
        fullWidth
        rightSection={<IconSearch size={14} />}
      >
        {requestText}
      </Button>
      {errorPercentage > 0 ? (
        <Button
          onClick={handleErrorsClick}
          variant="subtle"
          size="xs"
          color={errorColor}
          justify="space-between"
          fullWidth
          rightSection={<IconSearch size={14} />}
        >
          {errorsText}
        </Button>
      ) : null}
      {showMetrics ? (
        <Stack gap={4} px="xs" py={2} c="var(--color-text)">
          {requestsPerSecond != null ? (
            <Group gap={6} wrap="nowrap">
              <IconActivity size={14} />
              <Text size="xs">{formatRate(requestsPerSecond)}</Text>
            </Group>
          ) : null}
          {latencyMs != null ? (
            <Group gap={6} wrap="nowrap">
              <IconClock size={14} />
              {/* Percentiles are estimated (approximate quantiles, over sampled
                  spans), so prefix each value with ~. */}
              <Text size="xs">
                p50 ~{formatDurationMs(latencyMs.p50)} · p95 ~
                {formatDurationMs(latencyMs.p95)} · p99 ~
                {formatDurationMs(latencyMs.p99)}
              </Text>
            </Group>
          ) : null}
        </Stack>
      ) : null}
      {onFocus ? (
        <>
          <Divider color="var(--color-border)" />
          <Button
            onClick={onFocus}
            variant="secondary"
            size="xs"
            color="gray"
            justify="center"
            fullWidth
            leftSection={<IconTarget size={14} />}
          >
            Focus
          </Button>
        </>
      ) : null}
    </Stack>
  );
}
