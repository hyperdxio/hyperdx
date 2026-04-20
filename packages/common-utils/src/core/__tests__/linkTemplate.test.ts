import {
  clearLinkTemplateCache,
  LinkTemplateError,
  MissingTemplateVariableError,
  renderLinkTemplate,
} from '../linkTemplate';

describe('renderLinkTemplate', () => {
  beforeEach(() => clearLinkTemplateCache());

  it('substitutes row column values', () => {
    expect(
      renderLinkTemplate('svc={{ServiceName}}', { ServiceName: 'api' }),
    ).toBe('svc=api');
  });

  it('throws MissingTemplateVariableError on missing context keys (strict mode)', () => {
    try {
      renderLinkTemplate('x={{ServiceName}}', {});
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingTemplateVariableError);
      if (err instanceof MissingTemplateVariableError) {
        expect(err.variable).toBe('ServiceName');
      }
    }
  });

  it('supports the encodeURIComponent helper', () => {
    expect(
      renderLinkTemplate('x={{encodeURIComponent v}}', { v: 'a b&c' }),
    ).toBe('x=a%20b%26c');
  });

  it('supports the json helper', () => {
    expect(renderLinkTemplate('x={{json v}}', { v: { a: 1 } })).toBe(
      'x={"a":1}',
    );
  });

  it('supports the default helper', () => {
    expect(renderLinkTemplate('x={{default missing "fallback"}}', {})).toBe(
      'x=fallback',
    );
    expect(
      renderLinkTemplate('x={{default v "fallback"}}', { v: 'present' }),
    ).toBe('x=present');
  });

  it('supports the eq helper', () => {
    expect(
      renderLinkTemplate('{{#eq v "a"}}yes{{else}}no{{/eq}}', { v: 'a' }),
    ).toBe('yes');
    expect(
      renderLinkTemplate('{{#eq v "a"}}yes{{else}}no{{/eq}}', { v: 'b' }),
    ).toBe('no');
  });

  it('throws LinkTemplateError on malformed template', () => {
    expect(() => renderLinkTemplate('{{#if', { v: 1 })).toThrow(
      LinkTemplateError,
    );
  });

  it('caches compiled templates', () => {
    // Second render of the same string exercises the cache path — just verify
    // the behavior is stable.
    expect(renderLinkTemplate('{{v}}', { v: '1' })).toBe('1');
    expect(renderLinkTemplate('{{v}}', { v: '2' })).toBe('2');
  });

  it('does not HTML-escape output', () => {
    expect(renderLinkTemplate('{{v}}', { v: '<&>' })).toBe('<&>');
  });

  describe('int helper', () => {
    it('rounds numbers to the nearest integer', () => {
      expect(renderLinkTemplate('{{int v}}', { v: 3.4 })).toBe('3');
      expect(renderLinkTemplate('{{int v}}', { v: 3.6 })).toBe('4');
      expect(renderLinkTemplate('{{int v}}', { v: -2.5 })).toBe('-2');
      expect(renderLinkTemplate('{{int v}}', { v: 42 })).toBe('42');
    });

    it('parses numeric strings', () => {
      expect(renderLinkTemplate('{{int v}}', { v: '3.4' })).toBe('3');
      expect(renderLinkTemplate('{{int v}}', { v: '  99 ' })).toBe('99');
    });

    it('returns empty string for non-numeric or nullish values', () => {
      expect(renderLinkTemplate('{{int v}}', { v: null })).toBe('');
      expect(renderLinkTemplate('{{int v}}', { v: 'abc' })).toBe('');
      expect(renderLinkTemplate('{{int v}}', { v: '' })).toBe('');
      expect(renderLinkTemplate('{{int v}}', { v: Number.NaN })).toBe('');
      expect(renderLinkTemplate('{{int v}}', { v: Infinity })).toBe('');
    });
  });

  describe('built-in helpers are disabled', () => {
    it('does not expose Handlebars #if', () => {
      // Without #if registered, the block falls back to blockHelperMissing —
      // which we also removed, so strict mode surfaces it as unknown.
      expect(() =>
        renderLinkTemplate('{{#if v}}yes{{/if}}', { v: true }),
      ).toThrow();
    });

    it('does not expose Handlebars #each', () => {
      expect(() =>
        renderLinkTemplate('{{#each xs}}{{this}}{{/each}}', { xs: [1, 2, 3] }),
      ).toThrow();
    });

    it('does not expose Handlebars #with', () => {
      expect(() =>
        renderLinkTemplate('{{#with v}}{{a}}{{/with}}', { v: { a: 1 } }),
      ).toThrow();
    });

    it('does not expose Handlebars lookup', () => {
      expect(() =>
        renderLinkTemplate('{{lookup v "a"}}', { v: { a: 1 } }),
      ).toThrow();
    });
  });
});
