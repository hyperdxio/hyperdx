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
