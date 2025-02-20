import { getClickhouseClient } from "@/clickhouse";
import { chSql } from "@hyperdx/common-utils/dist/clickhouse";
import { SourceKind } from "@hyperdx/common-utils/dist/types";
import { useQuery } from "@tanstack/react-query";
import { TSource } from "@hyperdx/common-utils/dist/types";
import { ResponseJSON } from "@clickhouse/client";
import { formatAttributeClause } from "@/utils";

const METRIC_FETCH_LIMIT = 25;

const extractAttributeKeys = (attributesArr: { 
  ScopeAttributes?: object, 
  ResourceAttributes?: object, 
  Attributes?: object 
}[], isSql: boolean) => {
  try {
    const resultSet = new Set<string>();
    for (const attribute of attributesArr) {
        if (attribute.ScopeAttributes) {
            Object.entries(attribute.ScopeAttributes).forEach(([key, value]) => {
                const clause = formatAttributeClause('ScopeAttributes', key, value, isSql);
                resultSet.add(clause);
            });
        }
        
        if (attribute.ResourceAttributes) {
            Object.entries(attribute.ResourceAttributes).forEach(([key, value]) => {
                const clause = formatAttributeClause('ResourceAttributes', key, value, isSql);
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

export const useFetchMetricResourceAttrs = (databaseName: string, tableName: string, metricType: string, metricName: string, tableSource: TSource, isSql: boolean) => {
    return useQuery({
        queryKey: ['metric-attributes', databaseName, tableName, metricType],
        queryFn: async ({ signal }) => {
            if (!databaseName || !tableName || tableSource?.kind !== SourceKind.Metric) {
        return [];
      }
  
      const clickhouseClient = getClickhouseClient();
      
      const sql = chSql`
        SELECT 
          ScopeAttributes,
          ResourceAttributes,
          Attributes
        FROM ${tableName}
        WHERE MetricName='${metricName}'
        LIMIT ${METRIC_FETCH_LIMIT.toString()}
      `;
  
      const result = await clickhouseClient.query<'JSON'>({
        query: sql.sql,
        query_params: sql.params,
        format: 'JSON',
        abort_signal: signal,
        connectionId: tableSource.connection,
      }).then(res => res.json()) as ResponseJSON<{ Attributes: object }>;
      if (result?.data) {
        return extractAttributeKeys(result.data, isSql);
      }
  
      return [];
    },
    enabled: Boolean(databaseName && tableName && tableSource?.kind === SourceKind.Metric),
  });
}