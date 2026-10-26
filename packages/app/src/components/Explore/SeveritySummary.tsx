import { useMemo } from 'react';
import {
  filterColumnMetaByType,
  JSDataType,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Box, Button, Group, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle } from '@tabler/icons-react';
import { keepPreviousData } from '@tanstack/react-query';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { getLogLevelClass } from '@/utils';

type SeverityBucket = 'error' | 'warn';

// Semantic status colors shared with the rest of the app (log level text,
// charts, service map). Keeps the pills consistent with how severity is
// colored everywhere else.
const BUCKET_COLOR: Record<SeverityBucket, string> = {
  error: 'var(--color-chart-error)',
  warn: 'var(--color-chart-warning)',
};

const BUCKET_ICON: Record<
  SeverityBucket,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  error: IconAlertCircle,
  warn: IconAlertTriangle,
};

const BUCKET_TITLE: Record<SeverityBucket, string> = {
  error: 'Error',
  warn: 'Warning',
};

// Reuse the canonical log-level classifier so bucketing matches the log level
// coloring used elsewhere (ERROR/FATAL/CRIT/... → error, WARN → warn).
function classifySeverity(value: string): SeverityBucket | null {
  const cls = getLogLevelClass(value);
  return cls === 'error' ? 'error' : cls === 'warn' ? 'warn' : null;
}

const numberFormatter = new Intl.NumberFormat('en-US');

function inferColumns(meta: ResponseJSON['meta'] | undefined): {
  countColumn: string;
  groupColumn: string;
} | null {
  if (!meta || meta.length === 0) return null;
  const countColumn =
    (meta.find(col => col.name === 'count()') ? 'count()' : undefined) ??
    filterColumnMetaByType(meta, [JSDataType.Number])?.[0]?.name;
  if (!countColumn) return null;
  const groupColumn = meta.find(col => col.name !== countColumn)?.name;
  if (!groupColumn) return null;
  return { countColumn, groupColumn };
}

type BucketResult = { count: number; values: string[] };

/**
 * Compact "N errors / N warnings" pills for the results toolbar. Runs a single
 * grouped count query (severity value → count) in parallel with the main
 * results and buckets the rows client-side. Clicking a pill scopes the search
 * to (or clears) the matching severity values via the structured filter.
 */
export function SeveritySummary({
  config,
  enabled = true,
  queryKeyPrefix,
  activeValues,
  onToggle,
}: {
  config: BuilderChartConfigWithDateRange;
  enabled?: boolean;
  queryKeyPrefix?: string;
  /** Severity values currently included by the structured filter. */
  activeValues?: string[];
  /** Toggle the filter for a bucket. `isActive` reflects the current state. */
  onToggle?: (values: string[], isActive: boolean) => void;
}) {
  const { data } = useQueriedChartConfig(config, {
    queryKey: [queryKeyPrefix, 'severity-summary', config],
    enabled,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  const { error, warn } = useMemo(() => {
    const empty: Record<SeverityBucket, BucketResult> = {
      error: { count: 0, values: [] },
      warn: { count: 0, values: [] },
    };
    const cols = inferColumns(data?.meta);
    if (!cols || !data?.data) return empty;
    for (const row of data.data) {
      const raw = row[cols.groupColumn];
      const value = raw == null ? '' : String(raw);
      const bucket = classifySeverity(value);
      if (!bucket) continue;
      empty[bucket].count += Number(row[cols.countColumn] ?? 0);
      if (value && !empty[bucket].values.includes(value)) {
        empty[bucket].values.push(value);
      }
    }
    return empty;
  }, [data]);

  const activeSet = new Set(activeValues ?? []);
  // Active when every value in this bucket is present in the query. The query
  // may hold both buckets' values at once, so this is a subset test rather than
  // an exact match.
  const isBucketActive = (bucket: BucketResult) =>
    bucket.values.length > 0 && bucket.values.every(v => activeSet.has(v));

  const pills: {
    bucket: SeverityBucket;
    result: BucketResult;
  }[] = [
    { bucket: 'error', result: error },
    { bucket: 'warn', result: warn },
  ];

  return (
    <Group gap="xs" wrap="nowrap">
      {pills.map(({ bucket, result }) => {
        const active = isBucketActive(result);
        const clickable =
          onToggle != null && (result.values.length > 0 || active);
        const color = BUCKET_COLOR[bucket];
        const Icon = BUCKET_ICON[bucket];
        const title = BUCKET_TITLE[bucket];

        // Neutral secondary button (matching the Columns/Sort controls); tinted
        // with the semantic status color only while its filter is active.
        const rootStyle: React.CSSProperties = active
          ? {
              borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
              color,
            }
          : {};

        const countChipStyle: React.CSSProperties = {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 18,
          height: 16,
          padding: '0 5px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1,
          backgroundColor: active
            ? `color-mix(in srgb, ${color} 22%, transparent)`
            : 'var(--mantine-color-default-hover)',
          color: active ? color : 'var(--mantine-color-dimmed)',
        };

        return (
          <Tooltip
            key={bucket}
            label={active ? `Clear ${title} filter` : `Filter to ${title}s`}
            disabled={!clickable}
            withArrow
            position="top"
          >
            <Button
              variant="secondary"
              size="xs"
              disabled={!clickable}
              onClick={
                clickable ? () => onToggle?.(result.values, active) : undefined
              }
              leftSection={
                <Icon size={14} color={active ? color : undefined} />
              }
              style={rootStyle}
              styles={{
                label: { display: 'flex', alignItems: 'center', gap: 6 },
              }}
              data-testid={`severity-summary-${bucket}`}
            >
              {title}
              <Box component="span" style={countChipStyle}>
                {numberFormatter.format(result.count)}
              </Box>
            </Button>
          </Tooltip>
        );
      })}
    </Group>
  );
}
