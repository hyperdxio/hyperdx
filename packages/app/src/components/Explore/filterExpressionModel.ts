import type {
  FilterRange,
  FilterState,
} from '@hyperdx/common-utils/dist/filters';

import { formatDurationBound } from './durationBound';
import type { QueryLanguage } from './queryModeSafety';

type FilterClauseType = 'included' | 'excluded' | 'range';

export type FilterClause = {
  kind: 'clause';
  field: string;
  value: string;
  type: FilterClauseType;
  rawValue?: string | boolean;
  displayValue?: string;
  range?: FilterRange;
};

export type FilterGroup = {
  kind: 'group';
  op: 'AND' | 'OR';
  children: FilterExpr[];
};

export type FilterExpr = FilterClause | FilterGroup;

export type ClauseLabel = {
  prefix: string;
  field: string;
  operator: string;
  value: string;
};

const LUCENE_QUOTE = /[\s:()[\]{}"]/;

function simplifyExpression(expr: FilterExpr | null): FilterExpr | null {
  if (expr == null) {
    return null;
  }
  if (expr.kind === 'clause') {
    return expr;
  }
  const children = expr.children
    .map(child => simplifyExpression(child))
    .filter((child): child is FilterExpr => child != null);
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { kind: 'group', op: expr.op, children };
}

function clausesForValues(
  field: string,
  values: Iterable<string | boolean>,
  type: 'included' | 'excluded',
): FilterClause[] {
  return Array.from(values).map(rawValue => ({
    kind: 'clause' as const,
    field,
    value: String(rawValue),
    type,
    rawValue,
  }));
}

function hasRangeBound(range: FilterRange): boolean {
  return range.min != null || range.max != null;
}

function rangeFallbackValue(range: FilterRange): string {
  if (range.min != null && range.max != null) {
    return `${range.min} – ${range.max}`;
  }
  if (range.min != null) {
    return `${range.minOp ?? '>='}${range.min}`;
  }
  if (range.max != null) {
    return `${range.maxOp ?? '<='}${range.max}`;
  }
  return '';
}

export function filterStateToExpression(
  filters: FilterState,
): FilterExpr | null {
  const children: FilterExpr[] = [];

  for (const [field, selection] of Object.entries(filters)) {
    const included = clausesForValues(field, selection.included, 'included');
    if (included.length === 1) {
      children.push(included[0]);
    } else if (included.length > 1) {
      children.push({ kind: 'group', op: 'OR', children: included });
    }

    children.push(...clausesForValues(field, selection.excluded, 'excluded'));

    if (selection.range != null && hasRangeBound(selection.range)) {
      children.push({
        kind: 'clause',
        field,
        value: rangeFallbackValue(selection.range),
        type: 'range',
        range: selection.range,
      });
    }
  }

  return simplifyExpression({ kind: 'group', op: 'AND', children });
}

export function removeFilterClause(
  clause: FilterClause,
  mutators: {
    setFilterValue: (
      field: string,
      value: string | boolean,
      action?: 'only' | 'exclude' | 'include',
    ) => void;
    clearFilter: (field: string) => void;
  },
): boolean {
  if (clause.type === 'range') {
    mutators.clearFilter(clause.field);
    return true;
  }
  if (clause.rawValue == null) {
    return false;
  }
  mutators.setFilterValue(
    clause.field,
    clause.rawValue,
    clause.type === 'excluded' ? 'exclude' : undefined,
  );
  return true;
}

export function lastClause(expr: FilterExpr | null): FilterClause | null {
  if (expr == null) {
    return null;
  }
  if (expr.kind === 'clause') {
    return expr;
  }
  for (let i = expr.children.length - 1; i >= 0; i--) {
    const found = lastClause(expr.children[i]);
    if (found != null) {
      return found;
    }
  }
  return null;
}

/** Show AND/OR labels when the group is OR, or an AND that mixes in an OR group. */
export function shouldShowJoins(group: FilterGroup): boolean {
  if (group.op === 'OR') {
    return true;
  }
  return group.children.some(
    child => child.kind === 'group' && child.op === 'OR',
  );
}

function luceneQuote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value;
  }
  if (!LUCENE_QUOTE.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "\\'")}'`;
}

function formatBound(field: string, n: number): string {
  return /duration/i.test(field) ? formatDurationBound(n) : String(n);
}

function formatRangeLabel(
  clause: FilterClause,
  language: QueryLanguage,
  display: string,
): ClauseLabel {
  const min = clause.range?.min;
  const max = clause.range?.max;
  const minOp = clause.range?.minOp ?? '>=';
  const maxOp = clause.range?.maxOp ?? '<=';

  if (min != null && max != null) {
    return language === 'lucene'
      ? {
          prefix: '',
          field: clause.field,
          operator: ':',
          value: `[${min} TO ${max}]`,
        }
      : {
          prefix: '',
          field: clause.field,
          operator: ' BETWEEN ',
          value: `${min} AND ${max}`,
        };
  }

  const bound = min ?? max;
  const op = min != null ? minOp : maxOp;
  if (bound == null) {
    return {
      prefix: '',
      field: clause.field,
      operator: language === 'lucene' ? ':' : ' BETWEEN ',
      value: language === 'lucene' ? luceneQuote(display) : sqlQuote(display),
    };
  }

  if (language === 'lucene') {
    return {
      prefix: '',
      field: clause.field,
      operator: ':',
      value: `${op}${formatBound(clause.field, bound)}`,
    };
  }

  return {
    prefix: '',
    field: clause.field,
    operator: ` ${op} `,
    value: String(bound),
  };
}

export function formatClauseLabel(
  clause: FilterClause,
  language: QueryLanguage,
): ClauseLabel {
  const display = clause.displayValue ?? clause.value;

  if (clause.type === 'range') {
    return formatRangeLabel(clause, language, display);
  }

  if (language === 'lucene') {
    return {
      prefix: clause.type === 'excluded' ? '-' : '',
      field: clause.field,
      operator: ':',
      value: luceneQuote(display),
    };
  }

  return {
    prefix: '',
    field: clause.field,
    operator: clause.type === 'excluded' ? ' != ' : ' = ',
    value: sqlQuote(display),
  };
}
