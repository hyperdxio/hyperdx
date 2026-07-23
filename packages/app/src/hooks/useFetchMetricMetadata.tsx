import {
  chSql,
  ResponseJSON,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import { createMetricNameFilter } from '@hyperdx/common-utils/dist/core/renderChartConfig';
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
