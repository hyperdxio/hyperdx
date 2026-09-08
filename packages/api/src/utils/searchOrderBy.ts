import {
  getFirstTimestampValueExpression,
  splitAndTrimWithBracket,
} from '@hyperdx/common-utils/dist/core/utils';
import type { TSource } from '@hyperdx/common-utils/dist/types';
import { isLogSource, isTraceSource } from '@hyperdx/common-utils/dist/types';

// Mirrors `optimizeDefaultOrderBy` + `useDefaultOrderBy` from DBSearchPage.tsx.
// Uses `source.orderByExpression` when set, otherwise derives an ORDER BY string
// from the source's timestamp expressions.
//
// The UI version also folds in `tableMetadata.sorting_key` (fetched from CH) to
// pick up extra timestamp-like columns from the table's sort key. We skip that
// step here to avoid an extra CH round-trip on the critical path. Sources that
// need the full sorting-key-aware behaviour should set `orderByExpression`.
export function resolveSearchOrderBy(source: TSource): string {
  const explicit =
    isLogSource(source) || isTraceSource(source)
      ? source.orderByExpression?.trim()
      : undefined;
  if (explicit) return explicit;

  const timestampExpr = source.timestampValueExpression ?? '';
  const displayedExpr =
    isLogSource(source) || isTraceSource(source)
      ? source.displayedTimestampValueExpression?.trim()
      : undefined;

  const timestampParts = splitAndTrimWithBracket(timestampExpr);
  const candidates = displayedExpr
    ? [...timestampParts, displayedExpr]
    : [...timestampParts];

  const seen = new Set<string>();
  const orderByParts: string[] = [];
  for (const key of candidates) {
    if (!seen.has(key)) {
      seen.add(key);
      orderByParts.push(key);
    }
  }

  if (orderByParts.length === 0) {
    orderByParts.push(
      getFirstTimestampValueExpression(timestampExpr) ?? 'Timestamp',
    );
  }

  return orderByParts.length > 1
    ? `(${orderByParts.join(', ')}) DESC`
    : `${orderByParts[0]} DESC`;
}
