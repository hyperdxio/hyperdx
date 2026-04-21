import Handlebars from 'handlebars';

const hb = Handlebars.create();

// Cache compiled templates to avoid the overhead of recompiling on every render.
const compiledTemplateCache = new Map<string, HandlebarsTemplateDelegate>();

// Remove built-in helpers so templates only have access to the custom helpers registered below.
for (const name of Object.keys(hb.helpers)) {
  hb.unregisterHelper(name);
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

export class LinkTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkTemplateError';
  }
}

/**
 * Thrown when a template references a context variable that isn't in the
 * row data. Surfaced distinctly so callers can show a friendlier warning
 * than a generic "template error".
 */
export class MissingTemplateVariableError extends LinkTemplateError {
  constructor(public variable: string) {
    super(`Template references unknown variable: ${variable}`);
    this.name = 'MissingTemplateVariableError';
  }
}

// Handlebars strict-mode message: `"varname" not defined in { ... } - <loc>`
const MISSING_CONTEXT_KEY_ERROR_PATTERN = /^"([^"]+)" not defined/;

export function renderLinkTemplate(
  template: string,
  ctx: Record<string, unknown>,
): string {
  let compiled = compiledTemplateCache.get(template);
  if (!compiled) {
    try {
      // Strict mode throws when a template references a context key that isn't set.
      // Don't escape output as HTML since we're rendering URLs, not HTML.
      compiled = hb.compile(template, { strict: true, noEscape: true });
      compiledTemplateCache.set(template, compiled);
    } catch (err) {
      throw new LinkTemplateError(
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  try {
    return compiled(ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = MISSING_CONTEXT_KEY_ERROR_PATTERN.exec(msg);
    if (match) throw new MissingTemplateVariableError(match[1]);
    throw new LinkTemplateError(msg);
  }
}

export const clearLinkTemplateCache = () => {
  compiledTemplateCache.clear();
};
