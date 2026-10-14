import Handlebars from 'handlebars';

const hb = Handlebars.create();

// Remove built-in helpers so templates only have access to the custom helpers registered below.
for (const name of Object.keys(hb.helpers)) {
  hb.unregisterHelper(name);
}

/** Thrown when a template calls a helper that isn't registered here. */
export class UnknownTemplateHelperError extends Error {
  constructor(public helper: string) {
    super(`Unknown helper: "${helper}"`);
    this.name = 'UnknownTemplateHelperError';
  }
}

hb.registerHelper('default', (value: unknown, fallback: unknown) => {
  if (value == null || value === '') return fallback ?? '';
  return value;
});

/**
 * Rounds a number or numeric string down to the nearest integer. Returns an
 * empty string when the input is null, undefined, or not parseable as a
 * finite number.
 */
hb.registerHelper('floor', (value: unknown): string => {
  if (value == null || value === '') return '';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return '';
  return String(Math.floor(num));
});

/** Reads the helper name off the trailing options argument Handlebars passes. */
function helperName(args: unknown[]): string {
  const options = args.at(-1);
  if (options != null && typeof options === 'object' && 'name' in options) {
    const { name } = options;
    if (typeof name === 'string') return name;
  }
  return 'unknown';
}

// Handlebars passes only the options object for a bare `{{name}}`, which is a
// context lookup that should render empty, and passes the call's params for
// `{{name arg}}`, which can only have meant a helper.
hb.registerHelper('helperMissing', (...args: unknown[]) => {
  if (args.length === 1) return '';
  throw new UnknownTemplateHelperError(helperName(args));
});

hb.registerHelper('blockHelperMissing', (...args: unknown[]) => {
  throw new UnknownTemplateHelperError(helperName(args));
});

// The compiler assumes these built-ins exist and emits direct calls to them,
// which crash on `undefined` now that they're unregistered. Marking them
// unknown routes `{{#if x}}` through helperMissing/blockHelperMissing instead,
// so an unsupported helper reports itself by name.
const KNOWN_HELPERS = {
  each: false,
  if: false,
  unless: false,
  with: false,
  log: false,
  lookup: false,
};

function parseAndCompile(
  template: string,
  strict: boolean,
): HandlebarsTemplateDelegate {
  // hb.compile() defers parsing until the first render, which would push
  // syntax errors out to every render call. Parse up front and hand compile()
  // the AST instead, so a malformed template fails here, once.
  // Output is URLs and plain-text legends, so never HTML-escape.
  return hb.compile(hb.parse(template), {
    strict,
    noEscape: true,
    knownHelpers: KNOWN_HELPERS,
  });
}

type CompileResult =
  | { delegate: HandlebarsTemplateDelegate }
  | { error: unknown };

const strictCache = new Map<string, CompileResult>();
const lenientCache = new Map<string, CompileResult>();

function compileCached(
  cache: Map<string, CompileResult>,
  template: string,
  strict: boolean,
): HandlebarsTemplateDelegate {
  let result = cache.get(template);
  if (!result) {
    try {
      result = { delegate: parseAndCompile(template, strict) };
    } catch (error) {
      result = { error };
    }
    cache.set(template, result);
  }
  if ('error' in result) throw result.error;
  return result.delegate;
}

/**
 * Compile a template whose render throws if it references a key that isn't in
 * the context.
 */
export function compileStrict(template: string): HandlebarsTemplateDelegate {
  return compileCached(strictCache, template, true);
}

/**
 * Compile a template whose render leaves missing keys empty. Throws on invalid
 * syntax.
 */
export function compileLenient(template: string): HandlebarsTemplateDelegate {
  return compileCached(lenientCache, template, false);
}

/** Validates a template for Handlebars syntax errors and unknown helpers, without checking for missing variables (since the context may not be known). */
export function validateTemplate(template: string) {
  // Note: We don't cache the compiled template here because the compiled template will not be used outside of this validation.
  const compiled = parseAndCompile(template, false);
  compiled({}); // Empty context since we're just checking for syntax errors, not missing variables.
}

export const clearTemplateCache = () => {
  strictCache.clear();
  lenientCache.clear();
};

export type WebhookTemplateError = {
  message: string;
  line?: number;
  column?: number;
};

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

// Reads a property off a value of unknown shape without a type assertion.
const read = (value: unknown, key: string): unknown =>
  value != null && typeof value === 'object'
    ? Reflect.get(value, key)
    : undefined;

// Handlebars reports 0-based columns.
const toLocation = (line: unknown, column: unknown) => {
  const col = toFiniteNumber(column);
  return {
    line: toFiniteNumber(line),
    column: col == null ? undefined : col + 1,
  };
};

/**
 * Compiles a webhook body template and returns the error, with its line and
 * column where Handlebars knows them, or null when it compiles. Delivery
 * renders with stock Handlebars plus an `eq` helper; helpers don't affect
 * compilation, so stock Handlebars catches the same errors. An empty body
 * compiles: it falls back to the default template.
 */
export function getWebhookTemplateError(
  template: string | undefined,
): WebhookTemplateError | null {
  if (!template?.trim()) return null;
  try {
    // compile() is lazy; precompile() parses and compiles up front.
    Handlebars.precompile(template, { noEscape: true });
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (read(e, 'lineNumber') != null) {
      return {
        message,
        ...toLocation(read(e, 'lineNumber'), read(e, 'column')),
      };
    }
    // Parse errors carry only the line, in the message. The lexer that just
    // failed still holds the offending token's position. Parsing is
    // synchronous, so nothing has run since.
    const loc = read(read(read(Handlebars, 'Parser'), 'lexer'), 'yylloc');
    return {
      message,
      ...toLocation(read(loc, 'first_line'), read(loc, 'first_column')),
    };
  }
}
