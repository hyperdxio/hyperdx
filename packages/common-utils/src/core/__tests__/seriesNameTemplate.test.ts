import { clearTemplateCache } from '@/core/handlebarsEnv';
import {
  renderSeriesNames,
  renderSeriesNameTemplate,
} from '@/core/seriesNameTemplate';

describe('renderSeriesNameTemplate', () => {
  beforeEach(() => clearTemplateCache());

  it('substitutes label values', () => {
    expect(
      renderSeriesNameTemplate(
        '{{namespace}}/{{pod}}',
        { namespace: 'prod', pod: 'a-123' },
        'fallback',
      ),
    ).toBe('prod/a-123');
  });

  it('resolves __name__', () => {
    expect(
      renderSeriesNameTemplate(
        '{{__name__}}',
        { __name__: 'http_requests_total' },
        'fallback',
      ),
    ).toBe('http_requests_total');
  });

  it('renders missing labels as empty (non-strict)', () => {
    expect(
      renderSeriesNameTemplate(
        '{{namespace}}/{{missing}}',
        { namespace: 'prod' },
        'fallback',
      ),
    ).toBe('prod/');
  });

  it('falls back when the rendered output is blank', () => {
    expect(renderSeriesNameTemplate('{{missing}}', {}, 'fallback')).toBe(
      'fallback',
    );
    expect(renderSeriesNameTemplate('  {{missing}}  ', {}, 'fallback')).toBe(
      'fallback',
    );
  });

  it('trims the rendered output', () => {
    expect(
      renderSeriesNameTemplate('  {{pod}}  ', { pod: 'a-123' }, 'fallback'),
    ).toBe('a-123');
  });

  it('falls back on syntax errors, repeatably', () => {
    expect(
      renderSeriesNameTemplate('{{unclosed', { pod: 'a' }, 'fallback'),
    ).toBe('fallback');
    // Failed compiles are cached; the second call must not throw either.
    expect(
      renderSeriesNameTemplate('{{unclosed', { pod: 'a' }, 'fallback'),
    ).toBe('fallback');
  });

  it('resolves non-identifier keys via segment literals', () => {
    expect(
      renderSeriesNameTemplate(
        '{{[some-label]}}',
        { 'some-label': 'value' },
        'fallback',
      ),
    ).toBe('value');
  });

  it('does not HTML-escape label values', () => {
    expect(renderSeriesNameTemplate('{{v}}', { v: 'a<b&c' }, 'fallback')).toBe(
      'a<b&c',
    );
  });

  it('supports the default helper', () => {
    expect(
      renderSeriesNameTemplate('{{default pod "unknown"}}', {}, 'fallback'),
    ).toBe('unknown');
    expect(
      renderSeriesNameTemplate(
        '{{default pod "unknown"}}',
        { pod: 'a-123' },
        'fallback',
      ),
    ).toBe('a-123');
  });

  it('supports the floor helper', () => {
    expect(
      renderSeriesNameTemplate('{{floor n}}', { n: '3.7' }, 'fallback'),
    ).toBe('3');
  });
});

describe('renderSeriesNames', () => {
  beforeEach(() => clearTemplateCache());

  it('passes unique names through unchanged', () => {
    expect(
      renderSeriesNames([
        { labels: { pod: 'a' }, fallback: 'up{pod="a"}', template: '{{pod}}' },
        { labels: { pod: 'b' }, fallback: 'up{pod="b"}', template: '{{pod}}' },
      ]),
    ).toEqual(['a', 'b']);
  });

  it('uses the fallback for series without a template', () => {
    expect(
      renderSeriesNames([
        { labels: { pod: 'a' }, fallback: 'up{pod="a"}' },
        { labels: { pod: 'b' }, fallback: 'up{pod="b"}', template: '{{pod}}' },
      ]),
    ).toEqual(['up{pod="a"}', 'b']);
  });

  it('prefixes names with the expression alias', () => {
    expect(
      renderSeriesNames([
        {
          labels: { pod: 'a' },
          fallback: 'up{pod="a"}',
          template: '{{pod}}',
          prefix: 'errors · ',
        },
        { labels: { pod: 'a' }, fallback: 'up{pod="a"}', prefix: 'total · ' },
      ]),
    ).toEqual(['errors · a', 'total · up{pod="a"}']);
  });

  it('disambiguates every colliding series with its fallback', () => {
    expect(
      renderSeriesNames([
        {
          labels: { namespace: 'prod', pod: 'a' },
          fallback: 'up{pod="a"}',
          template: '{{namespace}}',
        },
        {
          labels: { namespace: 'prod', pod: 'b' },
          fallback: 'up{pod="b"}',
          template: '{{namespace}}',
        },
        {
          labels: { namespace: 'dev', pod: 'c' },
          fallback: 'up{pod="c"}',
          template: '{{namespace}}',
        },
      ]),
    ).toEqual(['prod (up{pod="a"})', 'prod (up{pod="b"})', 'dev']);
  });

  it('disambiguates across expressions, templates included', () => {
    // Two expressions rendering the same label, one of them aliased.
    expect(
      renderSeriesNames([
        { labels: { pod: 'a' }, fallback: 'up{pod="a"}', template: '{{pod}}' },
        {
          labels: { pod: 'a' },
          fallback: 'requests{pod="a"}',
          template: '{{pod}}',
        },
        {
          labels: { pod: 'a' },
          fallback: 'requests{pod="a"}',
          template: '{{pod}}',
          prefix: 'aliased · ',
        },
      ]),
    ).toEqual(['a (up{pod="a"})', 'a (requests{pod="a"})', 'aliased · a']);
  });

  it('numbers names the fallback cannot separate', () => {
    // The same expression added twice under the same alias: identical labels,
    // identical fallbacks, so the qualifier above leaves them colliding.
    expect(
      renderSeriesNames([
        { labels: { pod: 'a' }, fallback: 'up{pod="a"}', prefix: 'up · ' },
        { labels: { pod: 'a' }, fallback: 'up{pod="a"}', prefix: 'up · ' },
        { labels: { pod: 'a' }, fallback: 'up{pod="a"}', prefix: 'up · ' },
      ]),
    ).toEqual([
      'up · up{pod="a"}',
      'up · up{pod="a"} (2)',
      'up · up{pod="a"} (3)',
    ]);
  });

  it('dedupes per-series fallbacks against successful renders', () => {
    // Both blank renders fall back; the fallbacks themselves are unique so
    // they pass through, while matching successful renders still collide.
    expect(
      renderSeriesNames([
        { labels: {}, fallback: 'up{pod="a"}', template: '{{missing}}' },
        { labels: {}, fallback: 'up{pod="b"}', template: '{{missing}}' },
      ]),
    ).toEqual(['up{pod="a"}', 'up{pod="b"}']);
    expect(
      renderSeriesNames([
        {
          labels: { pod: 'up{pod="b"}' },
          fallback: 'up{pod="a"}',
          template: '{{pod}}',
        },
        { labels: {}, fallback: 'up{pod="b"}', template: '{{pod}}' },
      ]),
    ).toEqual(['up{pod="b"} (up{pod="a"})', 'up{pod="b"}']);
  });
});
