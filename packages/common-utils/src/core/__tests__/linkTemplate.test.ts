import {
  clearLinkTemplateCache,
  LinkTemplateError,
  MissingTemplateVariableError,
  renderLinkTemplate,
  validateTemplate,
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

  it('supports the default helper', () => {
    expect(renderLinkTemplate('x={{default missing "fallback"}}', {})).toBe(
      'x=fallback',
    );
    expect(
      renderLinkTemplate('x={{default v "fallback"}}', { v: 'present' }),
    ).toBe('x=present');
  });

  it('supports the floor helper', () => {
    expect(renderLinkTemplate('{{floor n}}', { n: '123.456' })).toBe('123');
    expect(renderLinkTemplate('{{floor n}}', { n: '123' })).toBe('123');
    expect(renderLinkTemplate('{{floor n}}', { n: '123.567' })).toBe('123');
    expect(renderLinkTemplate('{{floor n}}', { n: 123.567 })).toBe('123');
  });

  it('throws LinkTemplateError on malformed template', () => {
    expect(() => renderLinkTemplate('{{#if', { v: 1 })).toThrow(
      LinkTemplateError,
    );
  });

  it('does not HTML-escape output', () => {
    expect(renderLinkTemplate('{{v}}', { v: '<&>' })).toBe('<&>');
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

  it('does not throw when a referenced variable is absent (non-strict mode)', () => {
    // Strict mode would throw MissingTemplateVariableError here; validate must not.
    expect(() => validateTemplate('{{missing}}')).not.toThrow();
  });
});
