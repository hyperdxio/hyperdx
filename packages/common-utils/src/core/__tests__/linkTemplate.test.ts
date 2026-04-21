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
