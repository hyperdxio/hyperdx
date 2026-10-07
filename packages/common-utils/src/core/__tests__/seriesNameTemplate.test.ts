import { clearTemplateCache } from '@/core/handlebarsEnv';
import { renderPromqlSeriesNames } from '@/core/seriesNameTemplate';

describe('renderPromqlSeriesNames', () => {
  beforeEach(() => clearTemplateCache());

  const series = (metric: Record<string, string>) => ({ metric });

  it('groups the names by expression', () => {
    expect(
      renderPromqlSeriesNames([
        {
          expression: 'up',
          result: [
            series({ __name__: 'up', pod: 'a' }),
            series({ __name__: 'up', pod: 'b' }),
          ],
        },
        { expression: 'requests', result: [series({ __name__: 'requests' })] },
      ]),
    ).toEqual([['up{pod="a"}', 'up{pod="b"}'], ['requests']]);
  });

  // Grafana-style: a label shared by every series says nothing about any of
  // them, so only the ones that differ are shown.
  it('names series after the labels that differ', () => {
    expect(
      renderPromqlSeriesNames([
        {
          expression: 'up',
          result: [
            series({ __name__: 'up', env: 'prod', pod: 'a' }),
            series({ __name__: 'up', env: 'prod', pod: 'b' }),
          ],
        },
      ]),
    ).toEqual([['up{pod="a"}', 'up{pod="b"}']]);
  });

  // The label is constant within each expression, so only a chart-wide view
  // of the series sees that it is what separates them.
  it('names series after a label that only differs across expressions', () => {
    expect(
      renderPromqlSeriesNames([
        {
          expression: 'up{pod="a"}',
          result: [series({ __name__: 'up', env: 'prod', pod: 'a' })],
        },
        {
          expression: 'up{pod="b"}',
          result: [series({ __name__: 'up', env: 'prod', pod: 'b' })],
        },
      ]),
    ).toEqual([['up{pod="a"}'], ['up{pod="b"}']]);
  });

  it('combines labels that differ within and across expressions', () => {
    expect(
      renderPromqlSeriesNames([
        {
          expression: 'up{env="prod"}',
          result: [
            series({ __name__: 'up', env: 'prod', pod: 'a' }),
            series({ __name__: 'up', env: 'prod', pod: 'b' }),
          ],
        },
        {
          expression: 'up{env="dev"}',
          result: [
            series({ __name__: 'up', env: 'dev', pod: 'a' }),
            series({ __name__: 'up', env: 'dev', pod: 'b' }),
          ],
        },
      ]),
    ).toEqual([
      ['up{env="prod", pod="a"}', 'up{env="prod", pod="b"}'],
      ['up{env="dev", pod="a"}', 'up{env="dev", pod="b"}'],
    ]);
  });

  it('falls back to the expression for a result with no name or labels', () => {
    expect(
      renderPromqlSeriesNames([
        { expression: 'sum(rate(up[5m]))', result: [series({})] },
      ]),
    ).toEqual([['sum(rate(up[5m]))']]);
  });

  it('applies the chart template to every expression', () => {
    expect(
      renderPromqlSeriesNames(
        [
          {
            expression: 'up',
            result: [series({ __name__: 'up', namespace: 'prod', pod: 'a' })],
          },
          {
            expression: 'requests',
            result: [
              series({ __name__: 'requests', namespace: 'prod', pod: 'b' }),
            ],
          },
        ],
        '{{namespace}}/{{pod}}',
      ),
    ).toEqual([['prod/a'], ['prod/b']]);
  });

  describe('legend templates', () => {
    // One series named by the chart's template, with the expression standing
    // in as its default name (an unnamed, unlabelled result has nothing else).
    const nameOne = (metric: Record<string, string>, template?: string) =>
      renderPromqlSeriesNames(
        [{ expression: 'sum(rate(up[5m]))', result: [series(metric)] }],
        template,
      )[0][0];

    it('resolves __name__', () => {
      expect(nameOne({ __name__: 'http_requests_total' }, '{{__name__}}')).toBe(
        'http_requests_total',
      );
    });

    it('renders missing labels as empty (non-strict)', () => {
      expect(nameOne({ namespace: 'prod' }, '{{namespace}}/{{missing}}')).toBe(
        'prod/',
      );
    });

    it('trims the rendered output', () => {
      expect(nameOne({ pod: 'a-123' }, '  {{pod}}  ')).toBe('a-123');
    });

    it('uses the default name when the template renders blank', () => {
      expect(nameOne({}, '{{missing}}')).toBe('sum(rate(up[5m]))');
    });

    it('uses the default name on a syntax error', () => {
      expect(nameOne({ pod: 'a' }, '{{unclosed')).toBe('sum(rate(up[5m]))');
    });
  });

  describe('aliases', () => {
    it('names a single series after its alias, trimmed', () => {
      expect(
        renderPromqlSeriesNames([
          {
            expression: 'up',
            alias: '  total  ',
            result: [series({ __name__: 'up' })],
          },
        ]),
      ).toEqual([['total']]);
    });

    it('shows a rendered template behind the alias', () => {
      expect(
        renderPromqlSeriesNames(
          [
            {
              expression: 'up',
              alias: 'errors',
              result: [series({ __name__: 'up', pod: 'a' })],
            },
          ],
          'pod:{{pod}}',
        ),
      ).toEqual([['errors · pod:a']]);
    });

    it("names an alias' series after their labels when it covers several", () => {
      expect(
        renderPromqlSeriesNames([
          {
            expression: 'up',
            alias: 'errors',
            result: [
              series({ __name__: 'up', pod: 'a' }),
              series({ __name__: 'up', pod: 'b' }),
            ],
          },
          {
            expression: 'requests',
            alias: 'total',
            result: [series({ __name__: 'requests' })],
          },
        ]),
      ).toEqual([['errors · up{pod="a"}', 'errors · up{pod="b"}'], ['total']]);
    });

    it('expands two expressions sharing an alias', () => {
      expect(
        renderPromqlSeriesNames([
          {
            expression: 'up',
            alias: 'rate',
            result: [series({ __name__: 'up' })],
          },
          {
            expression: 'requests',
            alias: 'rate',
            result: [series({ __name__: 'requests' })],
          },
        ]),
      ).toEqual([['rate · up'], ['rate · requests']]);
    });

    // A template the labels can't satisfy asked for a name it couldn't give,
    // which says nothing about the alias the user typed themselves.
    it('uses an alias alone when the template renders nothing', () => {
      expect(
        renderPromqlSeriesNames(
          [
            {
              expression: 'sum(rate(a[5m]))',
              alias: 'a',
              result: [series({})],
            },
            {
              expression: 'sum(rate(b[5m]))',
              alias: 'b',
              result: [series({})],
            },
          ],
          '{{service}}',
        ),
      ).toEqual([['a'], ['b']]);
    });

    it('falls back when a blank render leaves one alias on both series', () => {
      expect(
        renderPromqlSeriesNames(
          [
            {
              expression: 'up',
              alias: 'up',
              result: [
                series({ __name__: 'up', pod: 'a' }),
                series({ __name__: 'up', pod: 'b' }),
              ],
            },
          ],
          '{{service}}',
        ),
      ).toEqual([['up · up{pod="a"}', 'up · up{pod="b"}']]);
    });
  });

  describe('collisions', () => {
    it('numbers identical expressions', () => {
      expect(
        renderPromqlSeriesNames([
          { expression: 'up', result: [series({ __name__: 'up' })] },
          { expression: 'up', result: [series({ __name__: 'up' })] },
        ]),
      ).toEqual([['up'], ['up (2)']]);
    });

    it('qualifies colliding template renders with the default name', () => {
      expect(
        renderPromqlSeriesNames(
          [
            {
              expression: 'up',
              result: [
                series({ __name__: 'up', namespace: 'prod', pod: 'a' }),
                series({ __name__: 'up', namespace: 'prod', pod: 'b' }),
                series({ __name__: 'up', namespace: 'dev', pod: 'c' }),
              ],
            },
          ],
          '{{namespace}}',
        ),
      ).toEqual([
        [
          'prod (up{namespace="prod", pod="a"})',
          'prod (up{namespace="prod", pod="b"})',
          'dev',
        ],
      ]);
    });

    it('qualifies across expressions, aliased ones included', () => {
      expect(
        renderPromqlSeriesNames(
          [
            {
              expression: 'up',
              result: [series({ __name__: 'up', pod: 'a' })],
            },
            {
              expression: 'requests',
              result: [series({ __name__: 'requests', pod: 'a' })],
            },
            {
              expression: 'requests',
              alias: 'aliased',
              result: [series({ __name__: 'requests', pod: 'a' })],
            },
          ],
          '{{pod}}',
        ),
      ).toEqual([['a (up)'], ['a (requests)'], ['aliased · a']]);
    });

    it('numbers names the default name cannot separate', () => {
      // The same expression added three times under the same alias: identical
      // labels, identical default names, so the qualifier has nothing to add.
      const expression = {
        expression: 'up',
        alias: 'up',
        result: [series({ __name__: 'up', pod: 'a' })],
      };
      expect(
        renderPromqlSeriesNames([expression, expression, expression]),
      ).toEqual([['up · up'], ['up · up (2)'], ['up · up (3)']]);
    });

    // A name that already is the series' default gains nothing from the
    // suffix, so only the other side of the collision is qualified.
    it('qualifies a blank render that collides with a rendered name', () => {
      expect(
        renderPromqlSeriesNames(
          [
            { expression: 'a_expr', result: [series({ pod: 'b_expr' })] },
            { expression: 'b_expr', result: [series({})] },
          ],
          '{{pod}}',
        ),
      ).toEqual([['b_expr (a_expr)'], ['b_expr']]);
    });
  });
});
