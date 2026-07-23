import { useMemo } from 'react';
import {
  chSql,
  ResponseJSON,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import { createMetricNameFilter } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { metricMinDisplayBucketSeconds } from '@hyperdx/common-utils/dist/core/utils';
import {
  isMetricsV2Tables,
  METRICS_V2_METRIC_TYPE,
  MetricsDataType,
  SourceKind,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { getMetadata } from '@/metadata';
import { getMetricTableName } from '@/utils';

export interface MetricMetadata {
  unit: string;
  description: string;
}

interface MetricMetadataProps {
  databaseName: string;
  metricType?: string;
  metricName?: string;
  tableSource: TMetricSource | undefined;
}

interface MetricMetadataResponse {
  MetricUnit: string;
  MetricDescription: string;
}

export const useFetchMetricMetadata = ({
  databaseName,
  metricType,
  metricName,
  tableSource,
}: MetricMetadataProps) => {
  // Metrics v2 (series/points split): unit/description live on the families
  // table under different column names.
  const isV2 =
    tableSource?.kind === SourceKind.Metric &&
    isMetricsV2Tables(tableSource.metricTables);
  const v2FamiliesTable = isV2
    ? (tableSource?.metricTables?.families ?? '')
    : '';

  const tableName = isV2
    ? v2FamiliesTable
    : tableSource
      ? (getMetricTableName(tableSource, metricType) ?? '')
      : '';

  const shouldFetch = Boolean(
    databaseName &&
      metricType &&
      metricName &&
      tableSource &&
      tableName &&
      tableSource?.kind === SourceKind.Metric,
  );

  return useQuery({
    queryKey: ['metric-metadata', databaseName, metricType, metricName, isV2],
    queryFn: async ({ signal }) => {
      if (!shouldFetch || !metricName) {
        return null;
      }

      const clickhouseClient = getClickhouseClient();
      const sql = isV2
        ? chSql`
        SELECT
          Unit AS MetricUnit,
          Description AS MetricDescription
        FROM ${tableExpr({ database: databaseName, table: tableName })}
        WHERE MetricName = ${{ String: metricName }}
        LIMIT 1
      `
        : chSql`
        SELECT
          MetricUnit,
          MetricDescription
        FROM ${tableExpr({ database: databaseName, table: tableName })}
        WHERE MetricName = ${{ String: metricName }}
        LIMIT 1
      `;

      const result = (await clickhouseClient
        .query<'JSON'>({
          query: sql.sql,
          query_params: sql.params,
          format: 'JSON',
          abort_signal: signal,
          connectionId: tableSource!.connection,
        })
        .then(res => res.json())) as ResponseJSON<MetricMetadataResponse>;

      if (result?.data?.[0]) {
        return {
          unit: result.data[0].MetricUnit || '',
          description: result.data[0].MetricDescription || '',
        };
      }

      return null;
    },
    enabled: shouldFetch,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
};

interface MetricSeriesProfileProps {
  databaseName: string;
  metricType?: MetricsDataType;
  metricName?: string;
  tableSource: TMetricSource | undefined;
  dateRange?: [Date, Date];
}

/**
 * Temporality/monotonicity profile for a v2 metric — the SAME cached
 * Metadata.getMetricSeriesProfile lookup the query translator performs at
 * render time (identical metricNameCondition/metricTypeValue/day-bounds
 * cache key), so consulting it here for picker gating / badges adds no
 * per-chart-query latency: whichever side asks first warms the shared
 * MetadataCache for the other.
 */
export const useMetricSeriesProfile = ({
  databaseName,
  metricType,
  metricName,
  tableSource,
  dateRange,
}: MetricSeriesProfileProps) => {
  // getMetadata() is the same singleton (and MetadataCache) that
  // useMetadataWithSettings decorates — sharing the cache without pulling
  // the api.useMe hook into every consumer.
  const metadata = getMetadata();
  const isV2 =
    tableSource?.kind === SourceKind.Metric &&
    isMetricsV2Tables(tableSource.metricTables);
  const seriesTable = isV2 ? (tableSource?.metricTables?.series ?? '') : '';
  const enabled = Boolean(
    isV2 && databaseName && metricName && metricType && seriesTable,
  );
  const dayBounds = dateRange?.map(d => d.toISOString().slice(0, 10));
  return useQuery({
    queryKey: [
      'metric-series-profile',
      tableSource?.connection,
      databaseName,
      seriesTable,
      metricName,
      metricType,
      dayBounds,
    ],
    queryFn: async () =>
      metadata.getMetricSeriesProfile({
        databaseName,
        tableName: seriesTable,
        metricNameCondition: createMetricNameFilter(metricName!),
        metricTypeValue: METRICS_V2_METRIC_TYPE[metricType!],
        dateRange,
        connectionId: tableSource!.connection,
      }),
    enabled,
    staleTime: 1000 * 60 * 5,
  });
};

/** v2 points table holding a metric type's raw samples (same mapping the
 * query translator uses to pick its scan table). */
const V2_POINTS_TABLE_KEY: Record<
  MetricsDataType,
  'points' | 'histogramPoints' | 'expHistogramPoints' | 'summaryPoints'
> = {
  [MetricsDataType.Gauge]: 'points',
  [MetricsDataType.Sum]: 'points',
  [MetricsDataType.Histogram]: 'histogramPoints',
  [MetricsDataType.ExponentialHistogram]: 'expHistogramPoints',
  [MetricsDataType.Summary]: 'summaryPoints',
};

interface MetricScrapeIntervalSnapProps {
  databaseName?: string;
  connection?: string;
  metricTables?: Parameters<typeof isMetricsV2Tables>[0];
  /** Every metric plotted on the panel — the snap takes the MAX honest
   * bucket across them (over-widening is safe; under-widening aliases). */
  metrics: { metricType?: MetricsDataType; metricName?: string }[];
  /** Panel window: historical windows anchor the estimator's sample at the
   * window end (a live-only sample 0-sentinels on old data). */
  dateRange?: [Date, Date];
  enabled?: boolean;
}

/**
 * Minimum honest display-bucket width for a panel's metrics, from the SAME
 * day-cached Metadata.getMetricScrapeIntervalEstimate lookup the query
 * translator uses for lookback padding and its own auto-granularity snap —
 * whichever side asks first warms the shared MetadataCache for the other.
 * Returns null fields when no estimate is available (fail open: no snap,
 * no warning).
 */
export const useMetricScrapeIntervalSnap = ({
  databaseName,
  connection,
  metricTables,
  metrics,
  dateRange,
  enabled = true,
}: MetricScrapeIntervalSnapProps) => {
  const metadata = getMetadata();
  const isV2 = isMetricsV2Tables(metricTables);
  const tables: Partial<Record<string, string>> | undefined = isV2
    ? metricTables
    : undefined;
  // Dedupe (metric, points table) pairs — several series often plot the
  // same metric.
  const targets = [
    ...new Map(
      metrics.flatMap(m => {
        const table = m.metricType
          ? tables?.[V2_POINTS_TABLE_KEY[m.metricType]]
          : undefined;
        return m.metricName && table
          ? [
              [
                `${table}:${m.metricName}`,
                { metricName: m.metricName, table },
              ] as const,
            ]
          : [];
      }),
    ).values(),
  ];
  // Live windows share one key; historical windows key by their end day —
  // mirrors the metadata-cache anchor so react-query and MetadataCache
  // agree on identity.
  const anchorDay = useMemo(
    () =>
      // eslint-disable-next-line no-restricted-syntax, react-hooks/purity -- boundary check between live and historical windows; a stale "now" only shifts WHICH cache key is used near the 6h edge
      dateRange && Date.now() - dateRange[1].getTime() >= 6 * 3600_000
        ? dateRange[1].toISOString().slice(0, 10)
        : 'live',
    [dateRange],
  );
  return useQuery({
    queryKey: [
      'metric-scrape-interval-snap',
      connection,
      databaseName,
      anchorDay,
      targets.map(t => `${t.table}:${t.metricName}`),
    ],
    queryFn: async () => {
      const estimates = await Promise.all(
        targets.map(t =>
          metadata.getMetricScrapeIntervalEstimate({
            databaseName: databaseName!,
            tableName: t.table,
            metricNameCondition: createMetricNameFilter(t.metricName),
            connectionId: connection!,
            dateRange,
          }),
        ),
      );
      const minBuckets = estimates
        .map(metricMinDisplayBucketSeconds)
        .filter((s): s is number => s != null);
      const intervals = estimates
        .map(e => e?.intervalSeconds ?? 0)
        .filter(s => s > 0);
      return {
        minBucketSeconds: minBuckets.length ? Math.max(...minBuckets) : null,
        intervalSeconds: intervals.length ? Math.max(...intervals) : null,
      };
    },
    enabled: Boolean(
      enabled && isV2 && databaseName && connection && targets.length > 0,
    ),
    staleTime: 1000 * 60 * 5,
  });
};
