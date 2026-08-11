import {
  escapeSqlString,
  isQuoteEscapedByBackslash,
  splitAndTrimWithBracket,
} from './core/utils';
import {
  ChartConfigWithOptDateRange,
  ChartVariable,
  DASHBOARD_VARIABLE_NAME_PATTERN,
  DASHBOARD_VARIABLE_NAME_PATTERN_ANCHORED,
  SavedChartConfig,
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
        ? '*'
        : `(${values.map(value => `"${escapeLuceneValue(value)}"`).join(' OR ')})`;
    default:
      format satisfies never; // Unreachable
      throw new Error(`Unknown variable format '${format}'`);
  }
}

// -- Template lexer ---------------------------------------------------------

export type TemplateToken =
  | { kind: 'text'; text: string }
  | { kind: 'macro'; name: string; args: string[] }
  | { kind: 'braced'; name: string; format?: string; raw: string }
  | { kind: 'bare'; name: string; raw: string };

/** Macros whose expansion depends on a variable's selected values. */
export const VARIABLE_MACRO_NAMES = ['filter', 'conditionalAll'] as const;

export type VariableMacroName = (typeof VARIABLE_MACRO_NAMES)[number];

const isVariableMacroName = (name: string): name is VariableMacroName =>
  (VARIABLE_MACRO_NAMES as readonly string[]).includes(name);

// Pattern used for recognizing $var references.
// eslint-disable-next-line security/detect-non-literal-regexp
const BARE_NAME_REGEX = new RegExp(`^${DASHBOARD_VARIABLE_NAME_PATTERN}`);

// Pattern used for recognizing ${var} and ${var:format} references, and for extracting the name and format.
// eslint-disable-next-line security/detect-non-literal-regexp
const BRACED_REFERENCE_REGEX = new RegExp(
  `^(${DASHBOARD_VARIABLE_NAME_PATTERN})(?::([a-zA-Z][a-zA-Z0-9_]*))?$`,
);

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

  let i = 0;
  while (i < input.length) {
    if (input.charAt(i) !== '$') {
      text += input.charAt(i);
      i++;
      continue;
    }

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
        tokens.push({ kind: 'macro', name, args: [] });
        i = argsStart;
        continue;
      }

      const closeIndex = findBalancedParens(input, argsStart);
      if (closeIndex < 0) {
        if (onMalformed === 'throw') {
          throw new Error('Failed to parse macro arguments');
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

// -- Variable expansion -----------------------------------------------------

export type VariableContext = {
  variables: ChartVariable[];
  /** Format used by references that don't request one. */
  defaultFormat: VariableFormat;
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
  macroName: string,
  variableName: string,
): ChartVariable {
  const variable = ctx.variables.find(v => v.name === variableName);
  if (!variable) {
    throw new Error(
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
    throw new Error(
      `Macro 'filter' expects 1-2 argument(s), but got ${args.length}`,
    );
  }

  const variableName = parseVariableNameArg(args[args.length - 1]);
  const variable = requireVariable(ctx, 'filter', variableName);

  // Resolve the filtered expression before the empty-selection shortcut so a
  // structurally invalid usage reports regardless of what's selected.
  let expression: string;
  if (args.length === 2) {
    expression = substituteWithContext(args[0], ctx);
  } else {
    if (!variable.expression) {
      throw new Error(
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
    throw new Error(
      `Macro 'conditionalAll' expects 2 argument(s), but got ${args.length}`,
    );
  }

  const variableName = parseVariableNameArg(args[1]);
  const variable = requireVariable(ctx, 'conditionalAll', variableName);

  if (variable.values.length === 0) return sqlNoOp(variableName);

  return `(${substituteWithContext(args[0], ctx)})`;
}

/**
 * Expand one non-text token against a variable context.
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
  return scanTemplateTokens(input, VARIABLE_MACRO_NAMES)
    .map(token =>
      token.kind === 'text' ? token.text : expandVariableToken(token, ctx),
    )
    .join('');
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
  { defaultFormat = 'sqlstring' }: { defaultFormat?: VariableFormat } = {},
): string {
  return substituteWithContext(input, { variables, defaultFormat });
}

/**
 * Returns the names of every variable the template could reference.
 * Never throws: it runs over saved SQL that may be mid-edit or malformed.
 */
export function getReferencedVariableNames(input: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  const add = (name: string) => {
    if (!DASHBOARD_VARIABLE_NAME_PATTERN_ANCHORED.test(name) || seen.has(name))
      return;
    seen.add(name);
    names.push(name);
  };

  const visit = (text: string) => {
    for (const token of scanTemplateTokens(text, VARIABLE_MACRO_NAMES, {
      onMalformed: 'skip',
    })) {
      if (token.kind === 'text') continue;
      if (token.kind !== 'macro') {
        add(token.name);
        continue;
      }

      if (!isVariableMacroName(token.name)) continue;
      switch (token.name) {
        case 'filter': {
          // $__filter(name) | $__filter(expression, name)
          const [first, second] = token.args;
          if (second != null) {
            add(parseVariableNameArg(second));
            visit(first);
          } else if (first != null) {
            add(parseVariableNameArg(first));
          }
          break;
        }
        case 'conditionalAll': {
          // $__conditionalAll(expression, name)
          const [expression, name] = token.args;
          if (name != null) add(parseVariableNameArg(name));
          if (expression != null) visit(expression);
          break;
        }
        default:
          token.name satisfies never;
      }
    }
  };

  visit(input);
  return names;
}

/** Returns the subset of `variables` that `config` actually references. */
export function filterReferencedVariables(
  config: ChartConfigWithOptDateRange | SavedChartConfig,
  variables: ChartVariable[],
): ChartVariable[] {
  // Only Raw SQL configs can reference variables today.
  if (!('configType' in config) || config.configType !== 'sql') {
    return [];
  }
  const referenced = new Set(getReferencedVariableNames(config.sqlTemplate));
  return variables.filter(variable => referenced.has(variable.name));
}
