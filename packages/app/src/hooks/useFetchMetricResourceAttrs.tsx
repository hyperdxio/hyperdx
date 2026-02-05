import {
  chSql,
  ResponseJSON,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { getClickhouseClient } from '@/clickhouse';
import { formatAttributeClause, getMetricTableName } from '@/utils';

const METRIC_FETCH_LIMIT = 10000;

export type AttributeCategory =
  | 'ResourceAttributes'
  | 'ScopeAttributes'
  | 'Attributes';

export interface AttributeKey {
  name: string;
  category: AttributeCategory;
}

// Parse suggestion strings to extract unique attribute keys
// SQL format: ResourceAttributes['key']='value'
// Lucene format: ResourceAttributes.key:"value"
export const parseAttributeKeysFromSuggestions = (
  suggestions: string[],
): AttributeKey[] => {
  const categories: AttributeCategory[] = [
    'ResourceAttributes',
    'ScopeAttributes',
    'Attributes',
  ];
  const seen = new Set<string>();
  const attributeKeys: AttributeKey[] = [];

  for (const suggestion of suggestions) {
    for (const category of categories) {
      if (!suggestion.startsWith(category)) continue;

      let name: string | null = null;

      // Try SQL format: Category['key']
      const sqlMatch = suggestion.match(
        new RegExp(`^${category}\\['([^']+)'\\]`),
      );
      if (sqlMatch) {
        name = sqlMatch[1];
      } else {
        // Try Lucene format: Category.key:
        const luceneMatch = suggestion.match(
          new RegExp(`^${category}\\.([^:]+):`),
        );
        if (luceneMatch) {
          name = luceneMatch[1];
        }
      }

      if (name) {
        const uniqueKey = `${category}:${name}`;
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          attributeKeys.push({ name, category });
        }
      }
      break;
    }
  }

  // Sort by category then name
  attributeKeys.sort((a, b) => {
    if (a.category !== b.category) {
      const order = ['ResourceAttributes', 'Attributes', 'ScopeAttributes'];
      return order.indexOf(a.category) - order.indexOf(b.category);
    }
    return a.name.localeCompare(b.name);
  });

  return attributeKeys;
};

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
    console.error('Error parsing metric autocomplete attributes', e);
    return [];
  }
};

interface MetricResourceAttrsProps {
  databaseName: string;
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
  metricType,
  metricName,
  tableSource,
  isSql,
}: MetricResourceAttrsProps) => {
  const tableName = tableSource
    ? (getMetricTableName(tableSource, metricType) ?? '')
    : '';

  const shouldFetch = Boolean(
    databaseName &&
      tableName &&
      metricType &&
      tableSource &&
      tableSource?.kind === SourceKind.Metric,
  );

  return useQuery({
    queryKey: ['metric-attributes', metricType, metricName, isSql, tableSource],
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
        LIMIT ${{ Int32: METRIC_FETCH_LIMIT }}
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
