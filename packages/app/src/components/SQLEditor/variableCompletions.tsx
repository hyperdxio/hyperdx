import { createContext, use, useCallback, useMemo } from 'react';
import {
  MacroSuggestion,
  VARIABLE_MACRO_SUGGESTIONS,
} from '@hyperdx/common-utils/dist/macros';
import { ChartVariable } from '@hyperdx/common-utils/dist/types';
import {
  substituteVariables,
  TemplateLanguage,
  VARIABLE_FORMATS,
  VariableFormat,
} from '@hyperdx/common-utils/dist/variables';

import { type SQLCompletion } from './utils';

/** What each `${name:format}` renders, for the completion's help text. */
const VARIABLE_FORMAT_DESCRIPTIONS: Record<VariableFormat, string> = {
  sqlstring: "Quoted and comma-separated, escaped for SQL. e.g. 'a', 'b', 'c'",
  csv: 'Comma-separated and unquoted. Not SQL-escaped. e.g. a,b,c',
  regex: 'A regex alternation. Regex escaped. e.g. (a|b|c)',
  lucene:
    'An OR of quoted terms, for Lucene inputs. e.g. ("a" OR "b" OR "c"). Quote the reference (field:"$var") for exact-match behavior. Leave unquoted (field:$var) for substring matching.',
};

/** What `snippet` expands to against the variable's current selection. */
function describeVariableExpansion(
  snippet: string,
  variable: ChartVariable,
  language: TemplateLanguage,
): string | undefined {
  let expansion: string;
  try {
    expansion = substituteVariables(snippet, {
      variables: [variable],
      inputLanguage: language,
    });
  } catch {
    return undefined;
  }
  return `Expands to: ${expansion === '' ? '(empty string)' : expansion}`;
}

/**
 * Completion help built as markup rather than a string, so `footnote` sits on
 * its own line.
 *
 * CodeMirror turns a string `info` into a single text node, where a `\n` is
 * subject to the inherited `white-space` and generally collapses to a space.
 * A `Node` is rendered as given, so the break is structural.
 */
function completionInfo(description: string, footnote: string) {
  return () => {
    const dom = document.createElement('div');

    const main = document.createElement('div');
    main.textContent = description;
    dom.appendChild(main);

    const sub = document.createElement('div');
    sub.className = 'cm-completionInfo-footnote';
    sub.textContent = footnote;
    dom.appendChild(sub);

    return dom;
  };
}

export const toMacroCompletion = ({
  name,
  minArgs,
  description,
}: MacroSuggestion): SQLCompletion => ({
  label: `$__${name}`,
  apply: minArgs > 0 ? `$__${name}(` : `$__${name}`,
  detail: 'macro',
  info: description,
  type: 'function',
});

/**
 * Builds one variable's reference completions, previewed under `language`.
 *
 * Every form is inserted exactly as labelled and previews what it expands to
 * against the current selection; what differs between languages is only which
 * forms are offered and what the prose says about them.
 */
function variableCompletionFactory(
  variable: ChartVariable,
  language: TemplateLanguage,
) {
  return (
    label: string,
    description: string,
    overrides?: Partial<SQLCompletion>,
  ): SQLCompletion => {
    const expansion = describeVariableExpansion(label, variable, language);
    return {
      label,
      apply: label,
      detail: 'variable',
      info: expansion ? completionInfo(description, expansion) : description,
      type: 'variable',
      ...overrides,
    };
  };
}

/** Every reference form available in SQL for the given variable, each with its current expansion. */
function getSqlVariableCompletions(variable: ChartVariable): SQLCompletion[] {
  const { name } = variable;
  const buildCompletion = variableCompletionFactory(variable, 'sql');

  return [
    ...(variable.expression
      ? [
          buildCompletion(
            `$__filter($${name})`,
            `Filters by the ${name} variable using its defined expression. Matches every row when no values are selected for the variable.`,
            { detail: 'variable filter', type: 'function' },
          ),
        ]
      : []),
    buildCompletion(
      `$${name}`,
      `The selected values of ${name}, in the default sqlstring format. Has no valid empty state — prefer $__filter(<expression>, $${name}).`,
    ),
    buildCompletion(
      `\${${name}}`,
      `The same as $${name}, but delimited — use it when the reference runs into following word characters, as in \${${name}}_total.`,
    ),
    ...VARIABLE_FORMATS.map(format =>
      buildCompletion(
        `\${${name}:${format}}`,
        VARIABLE_FORMAT_DESCRIPTIONS[format],
      ),
    ),
  ];
}

/**
 * Auto-completions for the variables available to a SQL query: the
 * variable macros, then every reference form of each variable.
 */
export function buildSqlVariableCompletions(
  variables: ChartVariable[] | undefined,
): SQLCompletion[] {
  if (!variables?.length) return [];

  return [
    ...VARIABLE_MACRO_SUGGESTIONS.map(toMacroCompletion),
    ...variables.flatMap(getSqlVariableCompletions),
  ];
}

/** Every reference form available in PromQL for the given variable, each with its current expansion. */
function getPromqlVariableCompletions(
  variable: ChartVariable,
): SQLCompletion[] {
  const { name } = variable;
  const reference = variableCompletionFactory(variable, 'promql');

  return [
    reference(
      `$${name}`,
      `The selected values of ${name} as a regex alternation, for use inside a matcher such as {label=~"$${name}"}. Matches everything when nothing is selected.`,
    ),
    reference(
      `\${${name}}`,
      `The same as $${name}, but delimited — use it when the reference runs into following word characters.`,
    ),
    reference(
      `\${${name}:regex}`,
      'The default format, written out. A regex alternation, escaped for the string literal it sits in. e.g. (a|b|c)',
    ),
    reference(
      `\${${name}:csv}`,
      'Comma-separated and unquoted, with no escaping. Use it to interpolate something that is not a matcher value, such as a metric or label name.',
    ),
  ];
}

/**
 * Auto-completions for the variables available to a PromQL expression: every
 * PromQL-valid reference form of each variable.
 */
export function buildPromqlVariableCompletions(
  variables: ChartVariable[] | undefined,
): SQLCompletion[] {
  if (!variables?.length) return [];

  return variables.flatMap(getPromqlVariableCompletions);
}

/** One bare `$name` suggestion for a Lucene input. */
export type LuceneVariableSuggestion = {
  value: string;
  label: string;
  description: string;
};

/** Expand references the way a Lucene expression is expanded at query time. */
const substituteLucene = (text: string, variables: ChartVariable[]) =>
  substituteVariables(text, { variables, inputLanguage: 'lucene' });

/**
 * Suggestions for a Lucene expression: the bare `$name` reference of each
 * variable, and nothing else.
 *
 * The macros are deliberately absent — they expand to SQL predicates, and
 * the lucene format empty state `("")` is safe without needing macros.
 */
export function buildLuceneVariableSuggestions(
  variables: ChartVariable[] | undefined,
): LuceneVariableSuggestion[] {
  return (variables ?? []).map(variable => {
    const reference = `$${variable.name}`;
    const expansion = substituteLucene(reference, [variable]);
    return {
      value: reference,
      label: reference,
      description: `The selected values of ${variable.name}. Expands to: ${expansion} by default, or (Field:"value1" OR Field:"value2") when quoted like Field:"$${variable.name}".`,
    };
  });
}

/**
 * Expand the dashboard variables in a Lucene expression, for display only —
 * the input's plain-English summary describes the query that will really run,
 * rather than naming the placeholders.
 *
 * Only variables with a selection are substituted. An empty one renders as
 * `("")`, which the English serializer reads as `'field' is <blank>` even
 * though that form filters nothing; leaving the reference as written is the
 * honest rendering of "no value chosen yet".
 *
 * Expansion can throw on a reference that is well-formed but not yet valid —
 * `${name:l}` is a keystroke on the way to `${name:lucene}` — and this runs on
 * every keystroke, so a failure falls back to the text as written.
 */
export function expandLuceneVariablesForEnglishDisplay(
  text: string,
  variables: ChartVariable[] | undefined,
): string {
  const selected = (variables ?? []).filter(
    variable => variable.values.length > 0,
  );
  if (selected.length === 0) return text;
  try {
    return substituteLucene(text, selected);
  } catch {
    return text;
  }
}

/** Context providing in-scope dashboard variables for descendant inputs. */
const SqlVariablesContext = createContext<ChartVariable[] | undefined>(
  undefined,
);

export function SqlVariablesProvider({
  variables,
  children,
}: {
  variables: ChartVariable[] | undefined;
  children: React.ReactNode;
}) {
  return (
    <SqlVariablesContext value={variables}>{children}</SqlVariablesContext>
  );
}

export type VariableSupportOptions = { enabled?: boolean };

/**
 * The variables an input can use, or undefined when there are none to use.
 *
 * An empty scope is undefined here rather than `[]`: to an input there is no
 * difference between a dashboard that declares no variables, one with the
 * feature disabled, and somewhere that is not a dashboard at all — in each case
 * nothing is substituted, so there is nothing to offer and nothing to check.
 */
export function useChartVariables({
  enabled = true,
}: VariableSupportOptions = {}): ChartVariable[] | undefined {
  const variables = use(SqlVariablesContext);
  return enabled && variables?.length ? variables : undefined;
}

/** Variable completions for a SQL input inside a `SqlVariablesProvider`. */
export function useSqlVariableCompletions(
  options?: VariableSupportOptions,
): SQLCompletion[] {
  const variables = useChartVariables(options);
  return useMemo(() => buildSqlVariableCompletions(variables), [variables]);
}

/**
 * Variable completions for a PromQL input inside a `SqlVariablesProvider`.
 */
export function usePromqlVariableCompletions(
  options?: VariableSupportOptions,
): SQLCompletion[] {
  const variables = useChartVariables(options);
  return useMemo(() => buildPromqlVariableCompletions(variables), [variables]);
}

/** Variable suggestions for a Lucene input inside a `SqlVariablesProvider`. */
export function useLuceneVariableSuggestions(
  options?: VariableSupportOptions,
): LuceneVariableSuggestion[] {
  const variables = useChartVariables(options);
  return useMemo(() => buildLuceneVariableSuggestions(variables), [variables]);
}

/** Expands variables in a Lucene expression for an input's English summary */
export function useLuceneVariableEnglishExpander(
  options?: VariableSupportOptions,
): (text: string) => string {
  const variables = useChartVariables(options);
  return useCallback(
    (text: string) => expandLuceneVariablesForEnglishDisplay(text, variables),
    [variables],
  );
}
