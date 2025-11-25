import { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { TSource } from '@hyperdx/common-utils/dist/types';

import { getJSONColumnNames } from '@/components/DBRowDataPanel';

export function getSelectExpressionsForHighlightedAttributes(
  expressions: TSource[
    | 'highlightedRowAttributeExpressions'
    | 'highlightedTraceAttributeExpressions'] = [],
) {
  return expressions.map(({ sqlExpression, alias }) => ({
    valueExpression: sqlExpression,
    alias: alias || sqlExpression,
  }));
}

export function getHighlightedAttributesFromData(
  source: TSource,
  attributes: TSource[
    | 'highlightedRowAttributeExpressions'
    | 'highlightedTraceAttributeExpressions'] = [],
  data: Record<string, unknown>[],
  meta: ResponseJSON['meta'],
) {
  const attributeValuesByDisplayKey = new Map<string, Set<string>>();
  const sqlExpressionsByDisplayKey = new Map<string, string>();
  const luceneExpressionsByDisplayKey = new Map<string, string>();
  const jsonColumns = getJSONColumnNames(meta);

  try {
    for (const row of data) {
      for (const { sqlExpression, luceneExpression, alias } of attributes) {
        const displayName = alias || sqlExpression;

        const isJsonExpression = jsonColumns.includes(
          sqlExpression.split('.')[0],
        );
        const sqlExpressionWithJSONSupport = isJsonExpression
          ? `toString(${sqlExpression})`
          : sqlExpression;

        sqlExpressionsByDisplayKey.set(
          displayName,
          sqlExpressionWithJSONSupport,
        );
        if (luceneExpression) {
          luceneExpressionsByDisplayKey.set(displayName, luceneExpression);
        }

        const value = row[displayName];
        if (value && typeof value === 'string') {
          if (!attributeValuesByDisplayKey.has(displayName)) {
            attributeValuesByDisplayKey.set(displayName, new Set());
          }
          attributeValuesByDisplayKey.get(displayName)!.add(value);
        }
      }
    }
  } catch (e) {
    console.error('Error extracting attributes from data', e);
  }

  return Array.from(attributeValuesByDisplayKey.entries()).flatMap(
    ([key, values]) =>
      [...values].map(value => ({
        displayedKey: key,
        value,
        sql: sqlExpressionsByDisplayKey.get(key)!,
        lucene: luceneExpressionsByDisplayKey.get(key),
        source,
      })),
  );
}

export function isLinkableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
