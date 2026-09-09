import { memo } from 'react';
import { NumericUnit } from '@hyperdx/common-utils/dist/types';
import { Box, Group, Progress, Text } from '@mantine/core';

import { formatDurationMs, formatNumber } from '@/utils';
import type { QueryProgressSummary } from '@/utils/queryProgress';

function formatRows(readRows: number): string {
  return formatNumber(readRows, { output: 'number', thousandSeparated: true });
}

function formatBytes(readBytes: number): string {
  return formatNumber(readBytes, {
    output: 'byte',
    numericUnit: NumericUnit.BytesIEC,
    mantissa: 1,
  });
}

export type QueryProgressIndicatorProps = {
  progress: QueryProgressSummary;
  /**
   * `block` stacks a full-width bar over its detail text, for the results
   * footer. `inline` is a short bar with a terse label, for the stats strip
   * beside "Scanned Rows" and "Elapsed Time".
   */
  variant?: 'block' | 'inline';
};

/**
 * Renders live ClickHouse scan progress for an in-flight query.
 *
 * The bar is indeterminate until the server reports a `total_rows_to_read`
 * estimate for at least one window, which it does not do on the first ticks of
 * a query.
 */
function QueryProgressIndicatorComponent({
  progress,
  variant = 'block',
}: QueryProgressIndicatorProps) {
  const { percent, readRows, readBytes, elapsedMs } = progress;
  const isIndeterminate = percent == null;
  const percentLabel = percent != null ? `${Math.floor(percent)}%` : undefined;

  if (variant === 'inline') {
    return (
      <Group gap="xxs" align="center" wrap="nowrap">
        <Progress
          value={percent ?? 100}
          animated={isIndeterminate}
          size="xs"
          w={72}
          color="gray.6"
          aria-label="Query progress"
        />
        <Text size="xs" c="dimmed">
          {[percentLabel, `${formatRows(readRows)} rows read`]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Group>
    );
  }

  return (
    <Box w="100%" maw={420} mt="xxs">
      <Progress
        value={percent ?? 100}
        animated={isIndeterminate}
        size="xs"
        color="gray.6"
        aria-label="Query progress"
      />
      <Group gap="xs" justify="center" mt={4}>
        <Text c="dimmed" size="xxs">
          {[
            `Read ${formatRows(readRows)} rows`,
            readBytes > 0 ? formatBytes(readBytes) : undefined,
            formatDurationMs(elapsedMs),
          ]
            .filter(Boolean)
            .join(' · ')}
          {percentLabel != null ? ` (${percentLabel})` : ''}
        </Text>
      </Group>
    </Box>
  );
}

export const QueryProgressIndicator = memo(QueryProgressIndicatorComponent);
