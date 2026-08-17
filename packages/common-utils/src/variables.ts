import {
  escapeSqlString,
  isQuoteEscapedByBackslash,
  splitAndTrimWithBracket,
} from './core/utils';
import { MacroExpansionError, MalformedMacroArgsError } from './macroErrors';
import {
  ChartConfigWithOptDateRange,
  ChartVariable,
  DASHBOARD_VARIABLE_NAME_PATTERN,
  DASHBOARD_VARIABLE_NAME_PATTERN_ANCHORED,
  SavedChartConfig,
  SearchConditionLanguage,
  SelectList,
  SortSpecificationList,
} from './types';

/** Rendering formats a reference can request via `${name:format}`. */
export const VARIABLE_FORMATS = [
  'sqlstring',
  'regex',
  'csv',
  'lucene',
] as const;

export type VariableFormat = (typeof VARIABLE_FORMATS)[number];

const isVariableFormat = (format: string): format is VariableFormat =>
  (VARIABLE_FORMATS as readonly string[]).includes(format);

const escapeRegexValue = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escapeLuceneValue = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * Render a variable's selected values in the requested format. Every format
 * has an "empty selection" rendering that keeps the surrounding query valid.
 */
export function formatVariableValues(
  values: string[],
  format: VariableFormat,
): string {
  switch (format) {
    case 'sqlstring':
      return values.length === 0
        ? 'NULL'
        : values.map(value => `'${escapeSqlString(value)}'`).join(', ');
    case 'regex': {
      if (values.length === 0) return '.*';
      const escaped = values.map(escapeRegexValue);
      return escaped.length === 1 ? escaped[0] : `(${escaped.join('|')})`;
    }
    case 'csv':
      return values.join(',');
    case 'lucene':
      return values.length === 0
        ? '("")'
        : `(${values.map(value => `"${escapeLuceneValue(value)}"`).join(' OR ')})`;
    default:
      format satisfies never; // Unreachable
      throw new Error(`Unknown variable format '${format}'`);
  }
}

// -- Template lexer ---------------------------------------------------------

export type TemplateToken =
  | { kind: 'text'; text: string }
  | { kind: 'macro'; name: string; args: string[]; inStringLiteral: boolean }
  | {
      kind: 'braced';
      name: string;
      format?: string;
      raw: string;
      inStringLiteral: boolean;
    }
  | { kind: 'bare'; name: string; raw: string; inStringLiteral: boolean };

/** Macros whose expansion depends on a variable's selected values. */
export const VARIABLE_MACRO_NAMES = ['filter', 'conditionalAll'] as const;

export type VariableMacroName = (typeof VARIABLE_MACRO_NAMES)[number];

const isVariableMacroName = (name: string): name is VariableMacroName =>
  (VARIABLE_MACRO_NAMES as readonly string[]).includes(name);

// Pattern used for recognizing $var references. (eslint ignored because DASHBOARD_VARIABLE_NAME_PATTERN is a shared constant, not user input)
// eslint-disable-next-line security/detect-non-literal-regexp
const BARE_NAME_REGEX = new RegExp(`^${DASHBOARD_VARIABLE_NAME_PATTERN}`);

// Pattern used for recognizing ${var} and ${var:format} references, and for extracting the name and format.
// (eslint ignored because DASHBOARD_VARIABLE_NAME_PATTERN is a shared constant, not user input)
// eslint-disable-next-line security/detect-non-literal-regexp
const BRACED_REFERENCE_REGEX = new RegExp(
  `^(${DASHBOARD_VARIABLE_NAME_PATTERN})(?::([a-zA-Z][a-zA-Z0-9_]*))?$`,
);

/**
 * ClickHouse's line comment introducers, per the `lineCommentTypes` of the
 * tokenizer this repo already formats and highlights with (`sql-formatter`'s
 * clickhouse dialect).
 */
const LINE_COMMENT_STARTS = ['--', '#'] as const;

/**
 * Index just past the SQL comment starting at `start`, or `start` when no
 * comment starts there. Callers must check they are outside a string first,
 * since `'a -- b'` is a string, not a comment.
 */
export function findCommentEnd(input: string, start: number): number {
  if (LINE_COMMENT_STARTS.some(marker => input.startsWith(marker, start))) {
    const newline = input.indexOf('\n', start);
    return newline < 0 ? input.length : newline;
  }
  if (input.startsWith('/*', start)) {
    const close = input.indexOf('*/', start + 2);
    return close < 0 ? input.length : close + 2;
  }
  return start;
}

const isWordChar = (char: string | undefined) =>
  char !== undefined && /[A-Za-z0-9_]/.test(char);

/**
 * Index of the `)` closing the `(` at `start`, or -1 when it is unclosed.
 *
 * Quote-aware: parens inside single- or double-quoted strings don't count, so
 * `$__conditionalAll(col = 'a)b', name)` terminates where it should.
 */
export function findBalancedParens(input: string, start: number): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = start; i < input.length; i++) {
    const c = input.charAt(i);

    if (c === '"' && !inSingleQuote && !isQuoteEscapedByBackslash(input, i)) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (c === "'" && !inDoubleQuote && !isQuoteEscapedByBackslash(input, i)) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;

    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Split a template into text and macro/variable token spans in a single left-to-right pass.
 *
 * At each `$` the scanner tries, in order:
 * 1. a known `$__<name>` macro (longest match, requiring a non-word char after the name so `$__filter` never matches the prefix of `$__filters`),
 * 2. a `${name}` / `${name:format}` reference, then a
 * 3. bare `$name` reference (maximal munch). Anything else is plain text, and an unknown `$__x` is emitted verbatim.
 *
 * `onMalformed` controls what happens when a macro's argument list has no
 * closing paren: `throw` (substitution — the query is broken and the user
 * needs to know) or `skip` (detection — must not crash on malformed saved SQL).
 */
export function scanTemplateTokens(
  input: string,
  macroNames: readonly string[],
  { onMalformed = 'throw' }: { onMalformed?: 'throw' | 'skip' } = {},
): TemplateToken[] {
  // Longest name first so `$__filters` isn't matched as `$__filter` + `s`, etc.
  const sortedMacroNames = [...macroNames].sort((a, b) => b.length - a.length);

  const tokens: TemplateToken[] = [];
  let text = '';
  const flushText = () => {
    if (text.length > 0) {
      tokens.push({ kind: 'text', text });
      text = '';
    }
  };

  // Quote state at the current position, so tokens can record whether they sit
  // inside a string literal.
  let inSingleQuote = false;
  let inDoubleQuote = false;

  let i = 0;
  while (i < input.length) {
    // Consume any comments starting at this position
    if (!inSingleQuote && !inDoubleQuote) {
      const commentEnd = findCommentEnd(input, i);
      if (commentEnd > i) {
        text += input.slice(i, commentEnd);
        i = commentEnd;
        continue;
      }
    }

    if (input.charAt(i) !== '$') {
      const c = input.charAt(i);
      if (c === '"' && !inSingleQuote && !isQuoteEscapedByBackslash(input, i)) {
        inDoubleQuote = !inDoubleQuote;
      } else if (
        c === "'" &&
        !inDoubleQuote &&
        !isQuoteEscapedByBackslash(input, i)
      ) {
        inSingleQuote = !inSingleQuote;
      }
      text += c;
      i++;
      continue;
    }

    const inStringLiteral = inSingleQuote || inDoubleQuote;

    // Attempt to match a known macro, with or without an argument list
    if (input.startsWith('$__', i)) {
      const nameStart = i + 3;
      const name = sortedMacroNames.find(
        macroName =>
          input.startsWith(macroName, nameStart) &&
          !isWordChar(input.charAt(nameStart + macroName.length) || undefined),
      );

      // Unknown macro — emit verbatim and keep scanning after the prefix.
      if (name == null) {
        text += '$__';
        i = nameStart;
        continue;
      }

      const argsStart = nameStart + name.length;
      if (input.charAt(argsStart) !== '(') {
        flushText();
        tokens.push({ kind: 'macro', name, args: [], inStringLiteral });
        i = argsStart;
        continue;
      }

      const closeIndex = findBalancedParens(input, argsStart);
      if (closeIndex < 0) {
        if (onMalformed === 'throw') {
          throw new MalformedMacroArgsError();
        }
        text += input.slice(i, argsStart);
        i = argsStart;
        continue;
      }

      flushText();
      tokens.push({
        kind: 'macro',
        name,
        args: splitAndTrimWithBracket(input.slice(argsStart + 1, closeIndex)),
        inStringLiteral,
      });
      i = closeIndex + 1;
      continue;
    }

    // Attempt to match a braced `${var}` or `${var:format}` reference
    if (input.charAt(i + 1) === '{') {
      const closeIndex = input.indexOf('}', i + 2); // no escaping because variable names can't contain `}` or `\`
      const match =
        closeIndex > 0
          ? input.slice(i + 2, closeIndex).match(BRACED_REFERENCE_REGEX)
          : null;
      if (match) {
        flushText();
        tokens.push({
          kind: 'braced',
          name: match[1],
          format: match[2],
          raw: input.slice(i, closeIndex + 1),
          inStringLiteral,
        });
        i = closeIndex + 1;
        continue;
      }
      text += '$';
      i++;
      continue;
    }

    const bareMatch = input.slice(i + 1).match(BARE_NAME_REGEX);
    if (bareMatch) {
      flushText();
      tokens.push({
        kind: 'bare',
        name: bareMatch[0],
        raw: `$${bareMatch[0]}`,
        inStringLiteral,
      });
      i += 1 + bareMatch[0].length;
      continue;
    }

    text += '$';
    i++;
  }

  flushText();
  return tokens;
}

/**
 * The argument a variable macro reads as a variable *name* rather than as a
 * template, or undefined for a macro with no such argument. Nothing is expanded
 * there: `$__filter(ServiceName, svc)` has to see `svc`, not its selected values.
 */
function variableNameArgIndex(
  macroName: string,
  argCount: number,
): number | undefined {
  if (!isVariableMacroName(macroName)) return undefined;

  // $__filter(name) | $__filter(expression, name) | $__conditionalAll(condition, name)
  switch (macroName) {
    case 'filter':
      return argCount - 1;
    case 'conditionalAll':
      return 1;
    default:
      macroName satisfies never;
      throw new Error('Unexpected macro name in variableNameArgIndex');
  }
}

export type TemplateExpander = {
  macroNames: readonly string[];
  /** Expand a macro token whose arguments have already been expanded. */
  expandMacro: (token: Extract<TemplateToken, { kind: 'macro' }>) => string;
  /** Expand a `$name` / `${name}` / `${name:format}` reference. */
  expandReference: (
    token: Exclude<TemplateToken, { kind: 'text' | 'macro' }>,
  ) => string;
};

/**
 * Expand a template, recursing into each macro argument first so a variable or
 * macro nested in an argument resolves before the enclosing macro sees it —
 * `$__timeFilter(${TsColumn:csv})` filters on the selected column. The one
 * exception is a variable macro's name argument, which stays as written.
 *
 * Only template *source* is recursed into; an expansion is never re-scanned, so
 * a selected value that looks like `$foo` or `$__fromTime` stays inert.
 */
export function expandTemplate(
  input: string,
  expander: TemplateExpander,
): string {
  return scanTemplateTokens(input, expander.macroNames)
    .map(token => {
      if (token.kind === 'text') return token.text;
      if (token.kind !== 'macro') return expander.expandReference(token);

      const nameIndex = variableNameArgIndex(token.name, token.args.length);
      const args = token.args.map((arg, index) =>
        index === nameIndex ? arg : expandTemplate(arg, expander),
      );
      return expander.expandMacro({ ...token, args });
    })
    .join('');
}

// -- Variable expansion -----------------------------------------------------

export type VariableContext = {
  variables: ChartVariable[];
  /** Format used by references that don't request one. */
  defaultFormat: VariableFormat;
  /**
   * When true, `$__filter` and `$__conditionalAll` are left exactly as
   * written. They expand to SQL predicates, so they have no meaning in a
   * Lucene expression — expanding one there would splice SQL into a query
   * that is about to be parsed as Lucene.
   */
  disableMacros?: boolean;
};

const sqlNoOp = (name: string) =>
  `(1=1 /** no values selected for variable '${name}' */)`;

/** Read the variable name out of a macro argument - either `name` or `$name` */
function parseVariableNameArg(arg: string): string {
  const trimmed = arg.trim();
  return trimmed.startsWith('$') ? trimmed.slice(1) : trimmed;
}

/** Require that a variable with the given name exists in the context. Throws an error if not found. */
function requireVariable(
  ctx: VariableContext,
  macroName: VariableMacroName,
  variableName: string,
): ChartVariable {
  const variable = ctx.variables.find(v => v.name === variableName);
  if (!variable) {
    throw new MacroExpansionError(
      macroName,
      `Macro '$__${macroName}' references unknown variable '${variableName}'. ` +
        `Available variables: ${
          ctx.variables.length > 0
            ? ctx.variables.map(v => v.name).join(', ')
            : '(none)'
        }.`,
    );
  }
  return variable;
}

function expandFilterMacro(args: string[], ctx: VariableContext): string {
  if (args.length < 1 || args.length > 2) {
    throw new MacroExpansionError(
      'filter',
      `Macro 'filter' expects 1-2 argument(s), but got ${args.length}`,
    );
  }

  const variableName = parseVariableNameArg(args[args.length - 1]);
  const variable = requireVariable(ctx, 'filter', variableName);

  // Resolve the filtered expression before the empty-selection shortcut so a
  // structurally invalid usage reports regardless of what's selected.
  let expression: string;
  if (args.length === 2) {
    // Already expanded by `expandTemplate`, which walks arguments first.
    expression = args[0];
  } else {
    if (!variable.expression) {
      throw new MacroExpansionError(
        'filter',
        `Macro '$__filter(${variableName})' requires the variable's filter expression, ` +
          `which is not available — pass it explicitly, e.g. $__filter(<expression>, ${variableName}).`,
      );
    }
    // Wrap in toString() to match how the broadcast path renders the same
    // filter, so both forms produce identical SQL for identical selections.
    expression = `toString(${variable.expression})`;
  }

  if (variable.values.length === 0) return sqlNoOp(variableName);

  return `(${expression} IN (${formatVariableValues(variable.values, 'sqlstring')}))`;
}

function expandConditionalAllMacro(
  args: string[],
  ctx: VariableContext,
): string {
  if (args.length !== 2) {
    throw new MacroExpansionError(
      'conditionalAll',
      `Macro 'conditionalAll' expects 2 argument(s), but got ${args.length}`,
    );
  }

  const variableName = parseVariableNameArg(args[1]);
  const variable = requireVariable(ctx, 'conditionalAll', variableName);

  if (variable.values.length === 0) return sqlNoOp(variableName);

  // The condition is already expanded by `expandTemplate`.
  return `(${args[0]})`;
}

/**
 * Expand one non-text token against a variable context. A macro token's
 * arguments must already be expanded, so call this through `expandTemplate`.
 *
 * Unknown *reference* names are emitted verbatim (a SQL literal that happens
 * to look like `$foo` must survive untouched), while a macro naming an unknown
 * variable is an error — it can't produce meaningful SQL either way.
 */
export function expandVariableToken(
  token: Exclude<TemplateToken, { kind: 'text' }>,
  ctx: VariableContext,
): string {
  if (token.kind === 'macro') {
    return token.name === 'filter'
      ? expandFilterMacro(token.args, ctx)
      : expandConditionalAllMacro(token.args, ctx);
  }

  const variable = ctx.variables.find(v => v.name === token.name);
  if (!variable) return token.raw;

  const requestedFormat = token.kind === 'braced' ? token.format : undefined;
  if (requestedFormat != null && !isVariableFormat(requestedFormat)) {
    throw new Error(
      `Unknown variable format '${requestedFormat}' in '${token.raw}'. ` +
        `Expected one of: ${VARIABLE_FORMATS.join(', ')}.`,
    );
  }

  return formatVariableValues(
    variable.values,
    requestedFormat ?? ctx.defaultFormat,
  );
}

function substituteWithContext(input: string, ctx: VariableContext): string {
  return expandTemplate(input, {
    // Unregistering the macro names is what leaves them verbatim: the scanner
    // emits an unknown `$__x` as plain text, arguments and all.
    macroNames: ctx.disableMacros ? [] : VARIABLE_MACRO_NAMES,
    expandMacro: token => expandVariableToken(token, ctx),
    expandReference: token => expandVariableToken(token, ctx),
  });
}

/**
 * Expand variable references and the variable macros in a template fragment.
 *
 * Standard macros (`$__timeFilter` and friends) are *not* known here, so they
 * pass through as text — raw SQL goes through `replaceMacros`, which scans for
 * both sets in one pass. This entry point is for the surfaces that only carry
 * variables (chart-builder where/having, PromQL expressions).
 */
export function substituteVariables(
  input: string,
  variables: ChartVariable[],
  {
    defaultFormat = 'sqlstring',
    disableMacros,
  }: { defaultFormat?: VariableFormat; disableMacros?: boolean } = {},
): string {
  return substituteWithContext(input, {
    variables,
    defaultFormat,
    disableMacros,
  });
}

/**
 * Expand a template for the language its renderer will parse it as.
 * A Lucene expression renders values in the `lucene` format and gets no macros.
 */
export function substituteVariablesForLanguage(
  input: string,
  variables: ChartVariable[],
  language: SearchConditionLanguage,
): string {
  const isLucene = language === 'lucene';
  return substituteVariables(input, variables, {
    defaultFormat: isLucene ? 'lucene' : 'sqlstring',
    disableMacros: isLucene,
  });
}

// -- Chart builder configs --------------------------------------------------

/**
 * The chart builder fields whose expressions may reference variables. Kept
 * structural rather than tied to one config type so both runtime configs (which
 * carry `variables`) and saved configs (which don't) can be walked.
 */
type BuilderVariableFields = {
  select: SelectList;
  where?: string;
  whereLanguage?: SearchConditionLanguage;
  having?: string;
  havingLanguage?: SearchConditionLanguage;
  groupBy?: SelectList;
  orderBy?: SortSpecificationList;
};

/**
 * Rewrites the given template. `language` is the language the renderer will parse
 * that expression as, so a reference can be expanded in a matching format.
 */
type TemplateMapper = (
  template: string,
  language: SearchConditionLanguage,
) => string;

const mapSelectList = (list: SelectList, map: TemplateMapper): SelectList =>
  typeof list === 'string'
    ? map(list, 'sql')
    : list.map(column => ({
        ...column,
        valueExpression: map(
          column.valueExpression,
          column.valueExpressionLanguage ?? 'sql',
        ),
        // Left absent when absent: the select union makes `aggCondition`
        // required for some aggregations and optional for others.
        ...(column.aggCondition
          ? {
              aggCondition: map(
                column.aggCondition,
                column.aggConditionLanguage ?? 'lucene',
              ),
            }
          : {}),
      }));

const mapSortList = (
  list: SortSpecificationList,
  map: TemplateMapper,
): SortSpecificationList =>
  typeof list === 'string'
    ? map(list, 'sql')
    : list.map(spec => ({
        ...spec,
        // `renderSortSpecificationList` always renders items as SQL
        valueExpression: map(spec.valueExpression, 'sql'),
      }));

/**
 * Calls the given map function to rewrite every chart builder expression
 * that may contain variable references, leaving the rest of the config untouched.
 */
function mapBuilderVariableTemplates<T extends BuilderVariableFields>(
  config: T,
  map: TemplateMapper,
): T {
  return {
    ...config,
    select: mapSelectList(config.select, map),
    ...(config.where
      ? { where: map(config.where, config.whereLanguage ?? 'sql') }
      : {}),
    ...(config.having
      ? { having: map(config.having, config.havingLanguage ?? 'sql') }
      : {}),
    ...(config.groupBy != null
      ? { groupBy: mapSelectList(config.groupBy, map) }
      : {}),
    ...(config.orderBy != null
      ? { orderBy: mapSortList(config.orderBy, map) }
      : {}),
  };
}

/**
 * Expand variable references and the variable macros throughout a chart builder
 * config, returning the config with `variables` consumed. `variables` being
 * undefined means this is a no-op.
 *
 * Each expression is expanded for the language it will be parsed as. A Lucene
 * expression renders values in the `lucene` format and gets no macros.
 *
 * Dropping `variables` from the result ensures that variables are never substituted
 * twice, even when the config is passed through `substituteChartConfigVariables`
 * recursively (eg. for CTEs or Metrics).
 */
export function substituteChartConfigVariables<
  T extends BuilderVariableFields & { variables?: ChartVariable[] },
>(config: T): T {
  const { variables } = config;
  if (variables == null) return config;

  const substituted = mapBuilderVariableTemplates(
    config,
    (template, language) =>
      substituteVariablesForLanguage(template, variables, language),
  );

  return { ...substituted, variables: undefined };
}

/**
 * Every variable reference across a chart builder config's expressions.
 * Never throws: it runs over saved configs that may be mid-edit or malformed.
 */
function getBuilderVariableReferences(
  config: BuilderVariableFields,
): VariableReference[] {
  const references: VariableReference[] = [];
  mapBuilderVariableTemplates(config, template => {
    references.push(...getVariableReferences(template));
    return template;
  });
  return references;
}

/** One occurrence of a variable reference in a template. */
export type VariableReference = {
  name: string;
  /** `macro` covers `$__filter`/`$__conditionalAll`; the rest are value references. */
  kind: 'macro' | 'bare' | 'braced';
  /** The requested format, only ever set for `${name:format}`. */
  format?: string;
  /** Whether the reference sits inside a single- or double-quoted string. */
  inStringLiteral: boolean;
  /**
   * The variable whose selection gates whether this reference is emitted at
   * all, set when the reference sits in a variable macro's expression argument.
   */
  guardedBy?: string;
  /** The reference as written, for use in user-facing messages. */
  raw: string;
};

/**
 * Every variable reference in a template, in source order, including repeats.
 * Never throws: it runs over saved SQL that may be mid-edit or malformed.
 *
 * Names that aren't token-safe are dropped — a macro argument like
 * `$__filter(x, ${svc})` can't name a variable, and expansion reports it.
 */
export function getVariableReferences(input: string): VariableReference[] {
  const references: VariableReference[] = [];

  /** Returns the referenced name, or undefined when the argument isn't one. */
  const addMacroRef = (
    macroName: VariableMacroName,
    arg: string,
    inStringLiteral: boolean,
    guardedBy: string | undefined,
  ): string | undefined => {
    const name = parseVariableNameArg(arg);
    if (!DASHBOARD_VARIABLE_NAME_PATTERN_ANCHORED.test(name)) return undefined;
    references.push({
      name,
      kind: 'macro',
      inStringLiteral,
      guardedBy,
      raw: `$__${macroName}`,
    });
    return name;
  };

  const visit = (text: string, guardedBy?: string) => {
    for (const token of scanTemplateTokens(text, VARIABLE_MACRO_NAMES, {
      onMalformed: 'skip',
    })) {
      if (token.kind === 'text') continue;
      if (token.kind !== 'macro') {
        references.push({
          name: token.name,
          kind: token.kind,
          format: token.kind === 'braced' ? token.format : undefined,
          inStringLiteral: token.inStringLiteral,
          guardedBy,
          raw: token.raw,
        });
        continue;
      }

      if (!isVariableMacroName(token.name)) continue;
      switch (token.name) {
        case 'filter': {
          // $__filter(name) | $__filter(expression, name)
          const [first, second] = token.args;
          if (second != null) {
            const name = addMacroRef(
              'filter',
              second,
              token.inStringLiteral,
              guardedBy,
            );
            visit(first, name ?? guardedBy);
          } else if (first != null) {
            addMacroRef('filter', first, token.inStringLiteral, guardedBy);
          }
          break;
        }
        case 'conditionalAll': {
          // $__conditionalAll(expression, name)
          const [expression, name] = token.args;
          const guard =
            name != null
              ? addMacroRef(
                  'conditionalAll',
                  name,
                  token.inStringLiteral,
                  guardedBy,
                )
              : undefined;
          if (expression != null) visit(expression, guard ?? guardedBy);
          break;
        }
        default:
          token.name satisfies never;
      }
    }
  };

  visit(input);
  return references;
}

/** `$a, $b` — deduplicated, in source order, for use in a message. */
function formatReferenceList(references: VariableReference[]): string {
  return [...new Set(references.map(reference => reference.raw))].join(', ');
}

export type VariableReferenceIssues = { errors: string[]; warnings: string[] };

/**
 * Checks on the dashboard variables a single expression references.
 *
 * `variables` is tri-state and each state means something different here:
 * `undefined` is "no variable context" (the chart explorer, or a dashboard with
 * the feature flag off) where nothing is substituted at all; `[]` is a dashboard
 * whose filters expose no variables.
 *
 * Only *value* references (`$name`, `${name}`, `${name:format}`) are inspected.
 * The macro forms either expand correctly or throw, and those messages reach
 * the user through expansion — except in the two cases where expansion never
 * runs and they would pass through silently: no context at all, and a Lucene
 * expression. Both are reported here.
 */
export function validateVariableReferencesInTemplate(
  template: string,
  variables: ChartVariable[] | undefined,
  {
    subject = 'SQL',
    language = 'sql',
  }: {
    /** The sentence subject of each message, e.g. `SQL references ...`. */
    subject?: string;
    /** The language the renderer parses this template as. */
    language?: SearchConditionLanguage;
  } = {},
): VariableReferenceIssues {
  const errors: string[] = [];
  const warnings: string[] = [];

  const references = getVariableReferences(template);
  if (references.length === 0) return { errors, warnings };

  const macroReferences = references.filter(r => r.kind === 'macro');
  const valueReferences = references.filter(r => r.kind !== 'macro');

  // Variables are not available on chart explorer (and maybe other contexts)
  if (variables == null) {
    // Macros are always an error, we assume no query will intentionally include them without variable context.
    if (macroReferences.length > 0) {
      errors.push(
        `${subject} uses ${formatReferenceList(macroReferences)}, but no variables are available here.`,
      );
    }

    // $var and ${var} references only trigger a warning since they may be a literal the user means to keep.
    if (valueReferences.length > 0) {
      warnings.push(
        `${subject} references ${formatReferenceList(valueReferences)}, but no variables are available here.`,
      );
    }
    return { errors, warnings };
  }

  const knownVariableNames = new Set(variables.map(variable => variable.name));
  const available =
    variables.length > 0
      ? variables.map(variable => variable.name).join(', ')
      : '(none)';

  const unknown = valueReferences.filter(r => !knownVariableNames.has(r.name));
  if (unknown.length > 0) {
    warnings.push(
      `${subject} references unknown variable ${formatReferenceList(unknown)}. Available variables: ${available}.`,
    );
  }

  // Macros are not supported in lucene
  if (language === 'lucene') {
    if (macroReferences.length > 0) {
      const [{ name }] = macroReferences;
      errors.push(
        `${formatReferenceList(macroReferences)} has no meaning in a Lucene expression — it is left as written and matched as literal text. Switch this input to SQL, or reference the variable directly, as in <field>:$${name}.`,
      );
    }
    // The two checks below are specific to the `sqlstring` default format.
    return { errors, warnings };
  }

  // An unrecognized format throws during expansion, so it is already reported.
  const resolved = valueReferences.filter(
    r =>
      knownVariableNames.has(r.name) &&
      (r.format == null || isVariableFormat(r.format)),
  );

  const quoted = resolved.filter(
    r => (r.format ?? 'sqlstring') === 'sqlstring' && r.inStringLiteral,
  );
  if (quoted.length > 0) {
    const [{ name }] = quoted;
    errors.push(
      `${formatReferenceList(quoted)} is wrapped in quotes, but the default sqlstring format already quotes each value. Did you mean to use $__filter(<expression>, ${name}) or \${${name}:csv} instead?`,
    );
  }

  const unguarded = resolved.filter(
    r =>
      (r.format ?? 'sqlstring') === 'sqlstring' &&
      !r.inStringLiteral &&
      r.guardedBy !== r.name,
  );
  if (unguarded.length > 0) {
    const [{ name }] = unguarded;
    warnings.push(
      `${formatReferenceList(unguarded)} has no valid empty-selection value — it renders as NULL before anything is selected. Prefer $__filter(<expression>, ${name}) or $__conditionalAll(<condition>, ${name}) so the query stays valid when no values are selected.`,
    );
  }

  return { errors, warnings };
}

/**
 * Returns the names of every variable the template could reference.
 * Never throws: it runs over saved SQL that may be mid-edit or malformed.
 */
export function getReferencedVariableNames(input: string): string[] {
  const names = new Set<string>(
    getVariableReferences(input).map(ref => ref.name),
  );
  return Array.from(names);
}

/** Whether the template uses `$__filter` or `$__conditionalAll` at all. */
export function hasVariableMacro(input: string): boolean {
  return scanTemplateTokens(input, VARIABLE_MACRO_NAMES, {
    onMalformed: 'skip',
  }).some(token => token.kind === 'macro');
}

/**
 * Returns the subset of `variables` that `config` actually references.
 *
 * Keying a tile's query on only these keeps it from re-running when an
 * unrelated variable's selection changes.
 */
export function filterReferencedVariables(
  config: ChartConfigWithOptDateRange | SavedChartConfig,
  variables: ChartVariable[],
): ChartVariable[] {
  let names: string[];
  if ('configType' in config && config.configType === 'sql') {
    names = getReferencedVariableNames(config.sqlTemplate);
  } else if ('configType' in config && config.configType === 'promql') {
    // PromQL queries don't support variables yet.
    return [];
  } else {
    names = getBuilderVariableReferences(config).map(
      reference => reference.name,
    );
  }

  const referenced = new Set(names);
  return variables.filter(variable => referenced.has(variable.name));
}

/** The warning an alerting tile shows when its query references dashboard variables. */
export function getAlertVariableWarning(
  config: ChartConfigWithOptDateRange | SavedChartConfig,
  variables: ChartVariable[] | undefined,
): string | undefined {
  if (!variables?.length) return undefined;

  const referenced = filterReferencedVariables(config, variables);
  if (referenced.length === 0) return undefined;

  const names = referenced.map(variable => `$${variable.name}`).join(', ');
  return (
    `This tile references ${names}. Alerts run with every dashboard variable ` +
    `in its empty state, not the values selected here.`
  );
}
