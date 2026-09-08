import { compileStrict } from '@/core/handlebarsEnv';

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
  let compiled;
  try {
    compiled = compileStrict(template);
  } catch (err) {
    throw new LinkTemplateError(
      err instanceof Error ? err.message : String(err),
    );
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stringifyAndEncode(value: unknown): unknown {
  if (typeof value === 'string') return encodeURIComponent(value);
  if (Array.isArray(value) || isPlainObject(value)) {
    return encodeURIComponent(JSON.stringify(value));
  }
  return value;
}

/**
 * Render a template that produces a URL. Identical to {@link renderLinkTemplate}
 * except that interpolated context (column) values are URL-encoded.
 */
export function renderUrlTemplate(
  template: string,
  ctx: Record<string, unknown>,
): string {
  const encoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    encoded[key] = stringifyAndEncode(value);
  }
  return renderLinkTemplate(template, encoded);
}
