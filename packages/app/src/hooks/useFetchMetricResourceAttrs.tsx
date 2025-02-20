import { getClickhouseClient } from "@/clickhouse";
import { chSql } from "@hyperdx/common-utils/dist/clickhouse";
import { SourceKind } from "@hyperdx/common-utils/dist/types";
import { useQuery } from "@tanstack/react-query";
import { TSource } from "@hyperdx/common-utils/dist/types";
import { ResponseJSON } from "@clickhouse/client";

// Add this helper function to extract keys from the attributes object
const extractAttributeKeys = (attributesArr: { 
  ScopeAttributes?: object, 
  ResourceAttributes?: object, 
  Attributes?: object 
}[]) => {
  try {
    const resultSet = new Set<string>();
    for (const attribute of attributesArr) {
        if (attribute.ScopeAttributes) {
            Object.entries(attribute.ScopeAttributes).forEach(([key, value]) => {
                resultSet.add(`ScopeAttributes['${key}']=${value}`);
            });
        }
        
        if (attribute.ResourceAttributes) {
            Object.entries(attribute.ResourceAttributes).forEach(([key, value]) => {
                resultSet.add(`ResourceAttributes['${key}']=${value}`);
            });
        }
        
        if (attribute.Attributes) {
            Object.entries(attribute.Attributes).forEach(([key, value]) => {
                resultSet.add(`Attributes['${key}']=${value}`);
            });
        }
    }
    return Array.from(resultSet);
  } catch (e) {
    console.error('Error parsing metric autocompleteattributes', e);
    return [];
  }
};

export const useFetchMetricResourceAttrs = (databaseName: string, tableName: string, metricType: string, metricName: string, tableSource: TSource) => {
    return useQuery({
        queryKey: ['metric-attributes', databaseName, tableName, metricType],
        queryFn: async ({ signal }) => {
            if (!databaseName || !tableName || tableSource?.kind !== SourceKind.Metric) {
        return [];
      }
  
      const clickhouseClient = getClickhouseClient();
      
      // TODO: should probably configure the LIMIT. Not sure if 25 rows is enough
      const sql = chSql`
        SELECT 
          ScopeAttributes,
          ResourceAttributes,
          Attributes
        FROM ${tableName}
        WHERE MetricName='${metricName}'
        LIMIT 25
      `;
  
      const result = await clickhouseClient.query<'JSON'>({
        query: sql.sql,
        query_params: sql.params,
        format: 'JSON',
        abort_signal: signal,
        connectionId: tableSource.connection,
      }).then(res => res.json()) as ResponseJSON<{ Attributes: object }>;
      if (result?.data) {
        return extractAttributeKeys(result.data);
      }
  
      return [];
    },
    enabled: Boolean(databaseName && tableName && tableSource?.kind === SourceKind.Metric),
  });
}