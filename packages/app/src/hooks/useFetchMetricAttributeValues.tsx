import {
  chSql,
  ResponseJSON,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { getMetricTableName } from '@/utils';

import { AttributeCategory } from './useFetchMetricResourceAttrs';

const ATTRIBUTE_VALUES_LIMIT = 100;

interface MetricAttributeValuesProps {
  databaseName: string;
  metricName: string;
  attributeName: string;
  attributeCategory: AttributeCategory;
  searchTerm?: string;
  tableSource: TSource | undefined;
  metricType: string;
  enabled?: boolean;
}

interface AttributeValueResponse {
  value: string;
}

export const useFetchMetricAttributeValues = ({
  databaseName,
  metricType,
  metricName,
  attributeName,
  attributeCategory,
  searchTerm,
  tableSource,
  enabled = true,
}: MetricAttributeValuesProps) => {
  const tableName = tableSource
    ? (getMetricTableName(tableSource, metricType) ?? '')
    : '';

  const shouldFetch = Boolean(
    enabled &&
      databaseName &&
      tableName &&
      metricType &&
      metricName &&
      attributeName &&
      attributeCategory &&
      tableSource &&
      tableSource?.kind === SourceKind.Metric,
  );

  return useQuery({
    queryKey: [
      'metric-attribute-values',
      metricName,
      metricType,
      attributeName,
      attributeCategory,
      searchTerm,
      tableSource,
    ],
    queryFn: async ({ signal }) => {
      if (!shouldFetch) {
        return [];
      }

      const clickhouseClient = getClickhouseClient();

      // Build optional search filter
      const searchFilter = searchTerm
        ? chSql` AND ${attributeCategory}[${{ String: attributeName }}] ILIKE ${{ String: `%${searchTerm}%` }}`
        : chSql``;

      const sql = chSql`
        SELECT DISTINCT ${attributeCategory}[${{ String: attributeName }}] as value
        FROM ${tableExpr({ database: databaseName, table: tableName })}
        WHERE MetricName = ${{ String: metricName }}
          AND ${attributeCategory}[${{ String: attributeName }}] != ''
          ${searchFilter}
        ORDER BY value
        LIMIT ${{ Int32: ATTRIBUTE_VALUES_LIMIT }}
      `;

      const result = (await clickhouseClient
        .query<'JSON'>({
          query: sql.sql,
          query_params: sql.params,
          format: 'JSON',
          abort_signal: signal,
          connectionId: tableSource!.connection,
          clickhouse_settings: {
            max_execution_time: 60,
            timeout_overflow_mode: 'break',
          },
        })
        .then(res => res.json())) as ResponseJSON<AttributeValueResponse>;

      if (result?.data) {
        return result.data.map(row => row.value).filter(Boolean);
      }

      return [];
    },
    enabled: shouldFetch,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
};
