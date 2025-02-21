import { ResponseJSON } from '@clickhouse/client';
import { chSql, tableExpr } from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { formatAttributeClause } from '@/utils';

const METRIC_FETCH_LIMIT = 10000;

const extractAttributeKeys = (
  attributesArr: MetricAttributesResponse[],
  isSql: boolean,
) => {
  try {
    const resultSet = new Set<string>();
    for (const attribute of attributesArr) {
      if (attribute.ScopeAttributes) {
        Object.entries(attribute.ScopeAttributes).forEach(([key, value]) => {
          const clause = formatAttributeClause(
            'ScopeAttributes',
            key,
            value,
            isSql,
          );
          resultSet.add(clause);
        });
      }

      if (attribute.ResourceAttributes) {
        Object.entries(attribute.ResourceAttributes).forEach(([key, value]) => {
          const clause = formatAttributeClause(
            'ResourceAttributes',
            key,
            value,
            isSql,
          );
          resultSet.add(clause);
        });
      }

      if (attribute.Attributes) {
        Object.entries(attribute.Attributes).forEach(([key, value]) => {
          const clause = formatAttributeClause('Attributes', key, value, isSql);
          resultSet.add(clause);
        });
      }
    }
    return Array.from(resultSet);
  } catch (e) {
    console.error('Error parsing metric autocompleteattributes', e);
    return [];
  }
};

interface MetricResourceAttrsProps {
  databaseName: string;
  tableName: string;
  metricType: string;
  metricName: string;
  tableSource: TSource | undefined;
  isSql: boolean;
}

interface MetricAttributesResponse {
    ScopeAttributes?: Record<string, string>;
    ResourceAttributes?: Record<string, string>;
    Attributes?: Record<string, string>;
}

export const useFetchMetricResourceAttrs = ({
  databaseName,
  tableName,
  metricType,
  metricName,
  tableSource,
  isSql,
}: MetricResourceAttrsProps) => {
  const shouldFetch = Boolean(
    databaseName &&
      tableName &&
      tableSource &&
      tableSource?.kind === SourceKind.Metric,
  );

  return useQuery({
    queryKey: ['metric-attributes', databaseName, tableName, metricType, metricName, isSql],
    queryFn: async ({ signal }) => {
      if (!shouldFetch) {
        return [];
      }

      const clickhouseClient = getClickhouseClient();
      const sql = chSql`
        SELECT DISTINCT
          ScopeAttributes,
          ResourceAttributes,
          Attributes
        FROM ${tableExpr({ database: databaseName, table: tableName })}
        WHERE MetricName=${{ String: metricName }}
        LIMIT ${{ Int32: METRIC_FETCH_LIMIT}}
      `;

      const result = (await clickhouseClient
        .query<'JSON'>({
          query: sql.sql,
          query_params: sql.params,
          format: 'JSON',
          abort_signal: signal,
          connectionId: tableSource!.connection,
        })
        .then(res => res.json())) as ResponseJSON<MetricAttributesResponse>;

      if (result?.data) {
        return extractAttributeKeys(result.data, isSql);
      }

      return [];
    },
    enabled: shouldFetch,
  });
};
