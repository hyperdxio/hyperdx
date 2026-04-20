import Handlebars from 'handlebars';

const compileCache = new Map<string, HandlebarsTemplateDelegate>();

const hb = Handlebars.create();

// Strip every built-in helper (`if`, `each`, `with`, `unless`, `lookup`,
// `log`, `helperMissing`, `blockHelperMissing`) so templates only have access
// to the vetted custom helpers registered below. Strict mode already throws
// on unknown references, so removing `helperMissing` / `blockHelperMissing`
// doesn't regress behavior.
for (const name of Object.keys(hb.helpers)) {
  hb.unregisterHelper(name);
}

hb.registerHelper('encodeURIComponent', (value: unknown) => {
  if (value == null) return '';
  return encodeURIComponent(String(value));
});

hb.registerHelper('json', (value: unknown) => JSON.stringify(value ?? null));

hb.registerHelper('default', (value: unknown, fallback: unknown) => {
  if (value == null || value === '') return fallback ?? '';
  return value;
});

hb.registerHelper(
  'eq',
  function (
    this: unknown,
    a: unknown,
    b: unknown,
    options: Handlebars.HelperOptions,
  ) {
    if (a === b) return options.fn(this);
    return options.inverse(this);
  },
);

/**
 * Rounds a number or numeric string to the nearest integer. Returns an
 * empty string when the input is null, undefined, or not parseable as a
 * finite number — consistent with the `default` helper's fallback shape.
 */
hb.registerHelper('int', (value: unknown): string => {
  if (value == null || value === '') return '';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return '';
  return String(Math.round(num));
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
const STRICT_MISSING_RE = /^"([^"]+)" not defined/;

export function renderLinkTemplate(
  template: string,
  ctx: Record<string, unknown>,
): string {
  let compiled = compileCache.get(template);
  if (!compiled) {
    try {
      // Strict mode throws when a template references a context key that
      // isn't set. We lean on that rather than an upfront AST walk so the
      // check respects runtime branching (e.g. `{{#if x}}{{y}}{{/if}}`).
      compiled = hb.compile(template, { noEscape: true, strict: true });
    } catch (err) {
      throw new LinkTemplateError(
        err instanceof Error ? err.message : String(err),
      );
    }
    compileCache.set(template, compiled);
  }
  try {
    return compiled(ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = STRICT_MISSING_RE.exec(msg);
    if (match) throw new MissingTemplateVariableError(match[1]);
    throw new LinkTemplateError(msg);
  }
}

export function clearLinkTemplateCache(): void {
  compileCache.clear();
}
