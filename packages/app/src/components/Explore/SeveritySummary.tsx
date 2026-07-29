import { useMemo } from 'react';
import {
  filterColumnMetaByType,
  JSDataType,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Box, Group, Tooltip, UnstyledButton } from '@mantine/core';
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
  const isBucketActive = (bucket: BucketResult) =>
    bucket.values.length > 0 &&
    bucket.values.every(v => activeSet.has(v)) &&
    activeSet.size === bucket.values.length;

  const pills: {
    bucket: SeverityBucket;
    result: BucketResult;
    label: string;
  }[] = [
    { bucket: 'error', result: error, label: 'error' },
    { bucket: 'warn', result: warn, label: 'warning' },
  ];

  const visiblePills = pills.filter(
    p => p.result.count > 0 || isBucketActive(p.result),
  );
  if (visiblePills.length === 0) return null;

  return (
    <Group gap={6} wrap="nowrap">
      {visiblePills.map(({ bucket, result, label }) => {
        const active = isBucketActive(result);
        const clickable = onToggle != null && result.values.length > 0;
        const color = BUCKET_COLOR[bucket];
        const text = `${numberFormatter.format(result.count)} ${
          result.count === 1 ? label : `${label}s`
        }`;
        const pillStyle: React.CSSProperties = {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 22,
          padding: '0 8px',
          borderRadius: 'var(--mantine-radius-sm)',
          fontSize: 'var(--mantine-font-size-xs)',
          fontWeight: 500,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          color: active ? '#fff' : color,
          backgroundColor: active
            ? color
            : `color-mix(in srgb, ${color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} ${
            active ? '0%' : '35%'
          }, transparent)`,
          cursor: clickable ? 'pointer' : 'default',
        };
        const dot = (
          <Box
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: active ? '#fff' : color,
              flexShrink: 0,
            }}
          />
        );
        const pill = clickable ? (
          <UnstyledButton
            style={pillStyle}
            onClick={() => onToggle?.(result.values, active)}
            data-testid={`severity-summary-${bucket}`}
          >
            {dot}
            {text}
          </UnstyledButton>
        ) : (
          <Box
            component="span"
            style={pillStyle}
            data-testid={`severity-summary-${bucket}`}
          >
            {dot}
            {text}
          </Box>
        );
        return (
          <Tooltip
            key={bucket}
            label={active ? `Clear ${label} filter` : `Filter to ${label}s`}
            disabled={!clickable}
            withArrow
            position="top"
          >
            {pill}
          </Tooltip>
        );
      })}
    </Group>
  );
}
