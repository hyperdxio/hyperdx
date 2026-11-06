import { injectPromqlLabelMatchers } from '@/core/promqlLabelInjection';

describe('injectPromqlLabelMatchers', () => {
  const m = 'job="api"';

  it.each([
    ['up', 'up{job="api"}'],
    ['up{}', 'up{job="api"}'],
    ['up{env="x"}', 'up{env="x", job="api"}'],
    ['up{env="x",}', 'up{env="x",job="api"}'],
    ['up{env="x", # note\n}', 'up{env="x", # note\njob="api"}'],
    ['up{env="x" # a, b\n}', 'up{env="x" # a, b\n, job="api"}'],
    ['up{ # note\n}', 'up{ # note\njob="api"}'],
    ['up{# a, b\nenv="x"}', 'up{# a, b\nenv="x", job="api"}'],
    ['up{env="x" # a, b\n,}', 'up{env="x" # a, b\n,job="api"}'],
    ['up # note', 'up{job="api"} # note'],
    ['up @ 123', 'up{job="api"} @ 123'],
    ['up[5m] @ end()', 'up{job="api"}[5m] @ end()'],
    ['rate(http_requests[5m])', 'rate(http_requests{job="api"}[5m])'],
    [
      'sum by (job) (rate(a{x="1"}[5m])) / on() b offset 1m',
      'sum by (job) (rate(a{x="1", job="api"}[5m])) / on() b{job="api"} offset 1m',
    ],
    ['max_over_time(up[1h:5m])', 'max_over_time(up{job="api"}[1h:5m])'],
    ['{__name__="up"}', '{__name__="up", job="api"}'],
    ['{"my.metric"}', '{"my.metric", job="api"}'],
    [
      'label_replace(up, "dst", "$1", "src", "{x}")',
      'label_replace(up{job="api"}, "dst", "$1", "src", "{x}")',
    ],
    ['1 + 2', '1 + 2'],
  ])('%s', (expression, expected) => {
    expect(injectPromqlLabelMatchers(expression, m)).toBe(expected);
  });

  it('returns the expression unchanged when there are no matchers', () => {
    expect(injectPromqlLabelMatchers('up{', '')).toBe('up{');
  });

  it('throws when the expression does not parse', () => {
    expect(() => injectPromqlLabelMatchers('up{job=}', m)).toThrow(
      /failed to parse/,
    );
  });
});
