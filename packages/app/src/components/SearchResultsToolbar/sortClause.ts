import { findBalancedParens } from '@hyperdx/common-utils/dist/variables';

import { splitClauseList } from '@/utils';
import { parseAsSortingStateString } from '@/utils/queryParsers';

export type SortKey = { id: string; desc: boolean };
export type SortRow = SortKey & { rowId: string };

let rowSeq = 0;

export function newSortRow(id: string, desc: boolean): SortRow {
  return { id, desc, rowId: `sort-${rowSeq++}` };
}

export const toRows = (keys: SortKey[] | null): SortRow[] | null =>
  keys?.map(key => newSortRow(key.id, key.desc)) ?? null;

/**
 * Sort keys the picker can edit. A parenthesized list with one direction,
 * `(toDateTime(Timestamp), Timestamp) DESC`, is several fields sharing that
 * direction, including function calls. The parentheses have to wrap that whole
 * expression: `(a, b) ASC, (c, d) DESC` is two keys, not one list. Anything
 * without a plain ASC/DESC on each field stays in SQL.
 */
export function parseSortKeys(orderBy: string): SortKey[] | null {
  const trimmed = orderBy.trim();
  if (!trimmed) return [];

  // [\s\S] so a newline inside `(toDateTime(Timestamp),\n Timestamp) DESC`
  // still counts as one direction. `.` would miss it and hide the Fields controls.
  const direction = trimmed.match(/^([\s\S]*)\s+(asc|desc)$/i);
  const expr = direction?.[1].trim() ?? '';
  if (
    direction &&
    expr.startsWith('(') &&
    findBalancedParens(expr, 0) === expr.length - 1
  ) {
    const ids = splitClauseList(expr.slice(1, -1));
    if (ids.length > 1 && ids.every(id => id.length > 0)) {
      const desc = direction[2].toUpperCase() === 'DESC';
      return ids.map(id => ({ id, desc }));
    }
  }

  const keys: SortKey[] = [];
  for (const part of splitClauseList(trimmed)) {
    const parsed = parseAsSortingStateString.parse(part);
    if (parsed == null || parsed.id.length === 0) return null;
    keys.push({ id: parsed.id, desc: parsed.desc });
  }
  return keys;
}

export function serializeSortKeys(keys: SortKey[]) {
  return keys
    .filter(key => key.id.trim())
    .map(key =>
      parseAsSortingStateString.serialize({
        id: key.id.trim(),
        desc: key.desc,
      }),
    )
    .join(', ');
}

export function sameKeys(a: SortKey[], b: SortKey[]) {
  return (
    a.length === b.length &&
    a.every((key, i) => key.id === b[i].id && key.desc === b[i].desc)
  );
}

export function sortSummary(orderBy: string): {
  summary: string;
  count: number;
} {
  const keys = parseSortKeys(orderBy);
  if (keys == null) {
    const summary = orderBy.trim() || 'none';
    // An expression the field list cannot split stays one value. A number
    // would invent a field count the user cannot see in the list.
    return { summary, count: summary === 'none' ? 0 : 1 };
  }
  if (keys.length === 0) return { summary: 'none', count: 0 };
  if (keys.length === 1) {
    return {
      summary: `${keys[0].id} ${keys[0].desc ? 'desc' : 'asc'}`,
      count: 1,
    };
  }
  return { summary: `${keys.length} fields`, count: keys.length };
}
