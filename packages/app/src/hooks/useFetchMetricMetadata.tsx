import {
  chSql,
  mergeQueryAttribution,
  ResponseJSON,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind, TMetricSource } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { useQueryAttribution } from '@/queryAttribution';
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
  const tableName = tableSource
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

  // Page context first so its ids are kept, then `metadata` pinned over the
  // top: these are metric lookups, not the page's own chart queries.
  const attribution = mergeQueryAttribution(useQueryAttribution(), {
    surface: 'metadata',
  });

  return useQuery({
    queryKey: ['metric-metadata', databaseName, metricType, metricName],
    queryFn: async ({ signal }) => {
      if (!shouldFetch || !metricName) {
        return null;
      }

      const clickhouseClient = getClickhouseClient({ attribution });
      const sql = chSql`
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
