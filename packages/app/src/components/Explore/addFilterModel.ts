import type { FilterRange } from '@hyperdx/common-utils/dist/filters';

export type FilterOperator = 'include' | 'exclude' | '>' | '>=' | '<' | '<=';

/**
 * `is` / `is not` are set membership — several values on one field are OR'd —
 * which is why they stay words while the comparisons stay symbols.
 */
const MEMBERSHIP_OPERATORS = [
  { value: 'include', label: 'is' },
  { value: 'exclude', label: 'is not' },
];

const COMPARISON_OPERATORS = [
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
];

export function isComparison(
  op: FilterOperator,
): op is '>' | '>=' | '<' | '<=' {
  return op === '>' || op === '>=' || op === '<' || op === '<=';
}

export function toFilterOperator(value: string | null): FilterOperator | null {
  switch (value) {
    case 'include':
    case 'exclude':
    case '>':
    case '>=':
    case '<':
    case '<=':
      return value;
    default:
      return null;
  }
}

/**
 * Comparisons are offered only for numeric fields: `rangeToSqlCondition`
 * interpolates the bound unquoted, so `>` on a string column would compile to
 * broken SQL rather than to nothing.
 */
export function operatorOptions(fieldIsNumeric: boolean) {
  return fieldIsNumeric
    ? [...MEMBERSHIP_OPERATORS, ...COMPARISON_OPERATORS]
    : MEMBERSHIP_OPERATORS;
}

/**
 * Guards against a comparison outliving the field that justified it — picking
 * a text field after choosing `>` would otherwise leave an operator selected
 * that is no longer on offer.
 */
export function resolveOperator(
  operator: FilterOperator,
  fieldIsNumeric: boolean,
): FilterOperator {
  return isComparison(operator) && !fieldIsNumeric ? 'include' : operator;
}

export type FilterUpdate =
  | { kind: 'value'; value: string; exclude: boolean }
  | { kind: 'range'; range: FilterRange };

/**
 * Turns the popover's three inputs into one change, or null when the pair does
 * not make sense yet — which is also what disables the Add button.
 *
 * A new bound is merged into whatever bound the field already carries, so
 * adding `<900` on top of `>500` narrows to a BETWEEN rather than discarding
 * the min.
 */
export function buildFilterUpdate({
  operator,
  value,
  existingRange,
}: {
  operator: FilterOperator;
  value: string;
  existingRange?: FilterRange;
}): FilterUpdate | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  if (!isComparison(operator)) {
    return { kind: 'value', value: trimmed, exclude: operator === 'exclude' };
  }

  const bound = Number(trimmed);
  if (!Number.isFinite(bound)) {
    return null;
  }
  return {
    kind: 'range',
    range:
      operator === '>' || operator === '>='
        ? { ...existingRange, min: bound, minOp: operator }
        : { ...existingRange, max: bound, maxOp: operator },
  };
}
