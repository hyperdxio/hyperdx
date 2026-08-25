import { createContext, use, useCallback, useMemo } from 'react';
import {
  MacroSuggestion,
  VARIABLE_MACRO_SUGGESTIONS,
} from '@hyperdx/common-utils/dist/macros';
import { ChartVariable } from '@hyperdx/common-utils/dist/types';
import {
  substituteWithContext,
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

/** What `snippet` expands to in SQL against the variable's current selection. */
function describeSqlVariableExpansion(
  snippet: string,
  variable: ChartVariable,
): string | undefined {
  let expansion: string;
  try {
    expansion = substituteWithContext(snippet, {
      variables: [variable],
      defaultFormat: 'sqlstring',
      inputLanguage: 'sql',
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

/** Every reference form of one variable, each with its current expansion. */
function referenceCompletions(variable: ChartVariable): SQLCompletion[] {
  const { name } = variable;

  /** A static description and an expansion preview given the current selection */
  const help = (snippet: string, description: string) => {
    const expansion = describeSqlVariableExpansion(snippet, variable);
    return expansion ? completionInfo(description, expansion) : description;
  };

  return [
    ...(variable.expression
      ? [
          {
            label: `$__filter($${name})`,
            apply: `$__filter($${name})`,
            detail: 'variable filter',
            info: help(
              `$__filter($${name})`,
              `Filters by the ${name} variable using its defined expression. Matches every row when no values are selected for the variable.`,
            ),
            type: 'function',
          },
        ]
      : []),
    {
      label: `$${name}`,
      apply: `$${name}`,
      detail: 'variable',
      info: help(
        `$${name}`,
        `The selected values of ${name}, in the default sqlstring format. Has no valid empty state — prefer $__filter(<expression>, $${name}).`,
      ),
      type: 'variable',
    },
    {
      label: `\${${name}}`,
      apply: `\${${name}}`,
      detail: 'variable',
      info: help(
        `\${${name}}`,
        `The same as $${name}, but delimited — use it when the reference runs into following word characters, as in \${${name}}_total.`,
      ),
      type: 'variable',
    },
    ...VARIABLE_FORMATS.map((format): SQLCompletion => {
      const reference = `\${${name}:${format}}`;
      return {
        label: reference,
        apply: reference,
        detail: 'variable',
        info: help(reference, VARIABLE_FORMAT_DESCRIPTIONS[format]),
        type: 'variable',
      };
    }),
  ];
}

/**
 * Auto-completions for the variables available to a query: the variable
 * macros, then every reference form of each variable.
 */
export function buildVariableCompletions(
  variables: ChartVariable[] | undefined,
): SQLCompletion[] {
  if (!variables?.length) return [];

  return [
    ...VARIABLE_MACRO_SUGGESTIONS.map(toMacroCompletion),
    ...variables.flatMap(referenceCompletions),
  ];
}

/** One bare `$name` suggestion for a Lucene input. */
export type LuceneVariableSuggestion = {
  value: string;
  label: string;
  description: string;
};

/** Expand references the way a Lucene expression is expanded at query time. */
const substituteLucene = (text: string, variables: ChartVariable[]) =>
  substituteWithContext(text, {
    variables,
    defaultFormat: 'lucene',
    inputLanguage: 'lucene',
  });

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
export function useVariableCompletions(
  options?: VariableSupportOptions,
): SQLCompletion[] {
  const variables = useChartVariables(options);
  return useMemo(() => buildVariableCompletions(variables), [variables]);
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
