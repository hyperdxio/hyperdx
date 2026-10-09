import {
  clearTemplateCache,
  compileLenient,
  compileStrict,
  getWebhookTemplateError,
  UnknownTemplateHelperError,
  validateTemplate,
} from '@/core/handlebarsEnv';
import {
  DEFAULT_GENERIC_WEBHOOK_BODY,
  DEFAULT_INCIDENT_IO_WEBHOOK_BODY,
} from '@/types';

describe.each([
  ['compileStrict', compileStrict],
  ['compileLenient', compileLenient],
])('%s', (_name, compile) => {
  beforeEach(() => clearTemplateCache());

  it('throws on a syntax error at compile time, not render time', () => {
    expect(() => compile('{{#if')).toThrow();
  });

  it('rethrows the memoized error on every later call', () => {
    const first = (() => {
      try {
        compile('{{unclosed');
      } catch (err) {
        return err;
      }
    })();
    expect(first).toBeInstanceOf(Error);
    expect(() => compile('{{unclosed')).toThrow(first as Error);
  });

  it('returns the same delegate for a repeated template', () => {
    expect(compile('{{a}}')).toBe(compile('{{a}}'));
  });

  it.each([
    '{{uppercase a}}',
    '{{#if a}}y{{/if}}',
    '{{#each a}}y{{/each}}',
    '{{#bogus}}y{{/bogus}}',
  ])('rejects the unregistered helper in %s', template => {
    expect(() => compile(template)({ a: [1] })).toThrow();
  });
});

describe('compileStrict', () => {
  beforeEach(() => clearTemplateCache());

  it('throws when rendering a template with a missing key', () => {
    expect(() => compileStrict('{{a}}')({})).toThrow(/not defined/);
  });

  it('reports an unknown helper as an unresolved name', () => {
    // Strict lookup fails before helperMissing runs, so the lenient path's
    // UnknownTemplateHelperError isn't reachable here.
    expect(() => compileStrict('{{uppercase a}}')({ a: 'x' })).toThrow(
      /"uppercase" not defined/,
    );
  });
});

describe('compileLenient', () => {
  beforeEach(() => clearTemplateCache());

  it('renders missing keys as empty', () => {
    expect(compileLenient('a={{missing}}')({})).toBe('a=');
  });

  it('names the helper in an unknown-helper error', () => {
    expect(() => compileLenient('{{uppercase a}}')({ a: 'x' })).toThrow(
      UnknownTemplateHelperError,
    );
    expect(() => compileLenient('{{uppercase a}}')({ a: 'x' })).toThrow(
      /Unknown helper: "uppercase"/,
    );
  });

  it.each([
    '{{#if a}}y{{/if}}',
    '{{#each a}}y{{/each}}',
    '{{#bogus}}y{{/bogus}}',
  ])('reports the unregistered block helper in %s by name', template => {
    expect(() => compileLenient(template)({ a: [1] })).toThrow(
      UnknownTemplateHelperError,
    );
  });

  it('caches independently of the strict variant', () => {
    const lenient = compileLenient('{{a}}');
    expect(lenient).not.toBe(compileStrict('{{a}}'));
    expect(lenient({})).toBe('');
  });
});

describe('validateTemplate', () => {
  it('accepts a plain string with no handlebars expressions', () => {
    expect(() => validateTemplate('just a string')).not.toThrow();
  });

  it('accepts templates that reference variables without a known context', () => {
    expect(() => validateTemplate('svc={{ServiceName}}')).not.toThrow();
    expect(() => validateTemplate('{{a}} {{b}} {{c.d.e}}')).not.toThrow();
  });

  it('accepts templates using registered helpers', () => {
    expect(() =>
      validateTemplate('{{default missing "fallback"}}'),
    ).not.toThrow();
    expect(() => validateTemplate('{{floor n}}')).not.toThrow();
  });

  it('throws on malformed template syntax', () => {
    expect(() => validateTemplate('{{#if')).toThrow();
    expect(() => validateTemplate('{{unclosed')).toThrow();
    expect(() => validateTemplate('{{#if x}}no-close')).toThrow();
  });

  it('throws a named error on an unknown helper', () => {
    expect(() => validateTemplate('{{bogus n}}')).toThrow(
      UnknownTemplateHelperError,
    );
    expect(() => validateTemplate('{{#if x}}y{{/if}}')).toThrow(
      UnknownTemplateHelperError,
    );
  });

  it('does not throw when a referenced variable is absent (non-strict mode)', () => {
    // Strict mode would throw MissingTemplateVariableError here; validate must not.
    expect(() => validateTemplate('{{missing}}')).not.toThrow();
  });
});

describe('getWebhookTemplateError', () => {
  it('accepts a template that is invalid JSON before rendering', () => {
    const body =
      '{"status": "{{#if (eq state "ALERT")}}firing{{else}}resolved{{/if}}"}';
    expect(() => JSON.parse(body)).toThrow();
    expect(getWebhookTemplateError(body)).toBe(null);
  });

  it.each([DEFAULT_GENERIC_WEBHOOK_BODY, DEFAULT_INCIDENT_IO_WEBHOOK_BODY])(
    'accepts the default body %#',
    body => {
      expect(getWebhookTemplateError(body)).toBe(null);
    },
  );

  it('rejects JSON-escaped quotes inside a helper call', () => {
    const body =
      '{"status": "{{#if (eq state \\"ALERT\\")}}firing{{else}}resolved{{/if}}"}';
    expect(() => JSON.parse(body)).not.toThrow();
    expect(getWebhookTemplateError(body)).toEqual({
      message: expect.stringContaining('Parse error on line 1'),
      line: 1,
      column: 29,
    });
  });

  it('reports the line and column of a parse error on a later line', () => {
    expect(getWebhookTemplateError('{\n  "a": "{{title}"\n}')).toMatchObject({
      line: 2,
      column: 16,
    });
  });

  it('reports the location of a mismatched block', () => {
    expect(getWebhookTemplateError('{{#if x}}{{/each}}')).toMatchObject({
      message: expect.stringContaining("if doesn't match each"),
      line: 1,
    });
  });

  it.each(['', '   \n', undefined])('accepts an empty body (%p)', body => {
    expect(getWebhookTemplateError(body)).toBe(null);
  });
});
