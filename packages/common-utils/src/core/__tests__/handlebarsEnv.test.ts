import {
  clearTemplateCache,
  compileLenient,
  compileStrict,
  UnknownTemplateHelperError,
  validateTemplate,
} from '@/core/handlebarsEnv';

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
