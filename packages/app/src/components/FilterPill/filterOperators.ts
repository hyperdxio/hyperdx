import type { FilterOperatorOption } from './FilterConditionEditor';

export type FilterLanguage = 'sql' | 'promql';

/** One spelling for both languages; each preset's labels show its own wording. */
export type FilterOperator = '=' | '!=' | '=~' | '!~' | 'LIKE' | 'NOT LIKE';

const REGEX_VALUE = {
  valueLabel: 'Pattern',
  valuePlaceholder: 'Regular expression',
};
const LIKE_VALUE = { valuePlaceholder: 'Text the value contains' };

export const SQL_FILTER_OPERATORS: FilterOperatorOption<FilterOperator>[] = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=', negated: true },
  { value: '=~', label: 'regex', ...REGEX_VALUE },
  { value: '!~', label: 'not regex', negated: true, ...REGEX_VALUE },
  { value: 'LIKE', label: 'like', ...LIKE_VALUE },
  { value: 'NOT LIKE', label: 'not like', negated: true, ...LIKE_VALUE },
];

export const PROMQL_FILTER_OPERATORS: FilterOperatorOption<FilterOperator>[] = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=', negated: true },
  { value: '=~', label: '=~', ...REGEX_VALUE },
  { value: '!~', label: '!~', negated: true, ...REGEX_VALUE },
];

export function getFilterOperators(
  language: FilterLanguage,
): FilterOperatorOption<FilterOperator>[] {
  return language === 'promql' ? PROMQL_FILTER_OPERATORS : SQL_FILTER_OPERATORS;
}
