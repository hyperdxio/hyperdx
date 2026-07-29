import {
  labelDistinguishesSeries,
  promqlSeriesLabelRule,
} from '@/components/Exemplars/promqlSeriesLabels';

/**
 * The rule decides whether two raw Prometheus series are the same *plotted* line.
 * Both failure directions are silent, so both are pinned here:
 *
 * - too strict (`all` when the query really did aggregate) empties the overlay;
 * - too loose (dropping a label that really does distinguish lines) merges
 *   distinct series and renders markers against a line they don't belong to.
 *
 * The second is worse, so every ambiguous shape must resolve to `all`.
 */
describe('promqlSeriesLabelRule', () => {
  const distinguishing = (expression: string, labels: string[]) => {
    const rule = promqlSeriesLabelRule(expression);
    return labels.filter(l => labelDistinguishesSeries(rule, l));
  };

  it('keeps only the `by` labels', () => {
    // The canonical latency query: one plotted line, so `instance` must stop
    // counting or the multi-target fan-out empties the overlay.
    expect(
      distinguishing(
        'histogram_quantile(0.95, sum(rate(http_latency_bucket[5m])) by (le))',
        ['le', 'instance', 'pod'],
      ),
    ).toEqual(['le']);
  });

  it('reads the prefix form of `by` as well as the suffix form', () => {
    expect(
      distinguishing(
        'histogram_quantile(0.95, sum by (le) (rate(http_latency_bucket[5m])))',
        ['le', 'instance'],
      ),
    ).toEqual(['le']);
  });

  it('excludes only the `without` labels when there is no `by`', () => {
    // The regression this covers: a `without`-only expression previously fell
    // through to "every label counts", so the without-spelling of the query above
    // still dropped the whole overlay.
    expect(
      distinguishing(
        'histogram_quantile(0.95, sum(rate(http_latency_bucket[5m])) without (instance))',
        ['le', 'instance', 'pod'],
      ),
    ).toEqual(['le', 'pod']);
  });

  it('treats a bare selector as fully distinguishing', () => {
    // No aggregation: this really does draw one line per instance.
    expect(
      distinguishing(
        'histogram_quantile(0.95, rate(http_latency_bucket[5m]))',
        ['le', 'instance'],
      ),
    ).toEqual(['le', 'instance']);
  });

  describe('falls back to fully-distinguishing on anything ambiguous', () => {
    // Each of these could otherwise shrink the identity and merge real series.
    it.each([
      [
        'both by and without present',
        'sum(rate(a[5m])) by (le) + sum(rate(b[5m])) without (instance)',
      ],
      [
        'differing by sets (nested aggregation)',
        'max by (service) (histogram_quantile(0.95, sum by (le, service, pod) (rate(x[5m]))))',
      ],
      [
        'top-level arithmetic',
        'histogram_quantile(0.95, sum(rate(a[5m])) by (le)) * 1000',
      ],
      [
        'top-level comparison',
        'histogram_quantile(0.95, sum(rate(a[5m])) by (le)) > 0.5',
      ],
      ['two without clauses', 'sum(sum(rate(a[5m])) without (x)) without (y)'],
    ])('%s', (_name, expression) => {
      expect(promqlSeriesLabelRule(expression)).toEqual({ mode: 'all' });
    });
  });

  it('ignores clause-like text inside string literals', () => {
    // A label *value* containing `by (` must not be read as syntax.
    expect(promqlSeriesLabelRule('rate(x{job="sum by (le)"}[5m])')).toEqual({
      mode: 'all',
    });
    expect(
      distinguishing('sum(rate(x{path="/a+b"}[5m])) by (le)', [
        'le',
        'instance',
      ]),
    ).toEqual(['le']);
  });

  it('does not read a rate interval or label list as division', () => {
    // `[5m]` and the `/` in a path matcher previously risked tripping the
    // binary-operator bail-out, which would silently disable the whole fix.
    expect(
      distinguishing('sum(rate(http_latency_bucket[5m])) by (le)', [
        'le',
        'instance',
      ]),
    ).toEqual(['le']);
  });

  it('is fully distinguishing for an empty or missing expression', () => {
    expect(promqlSeriesLabelRule(undefined)).toEqual({ mode: 'all' });
    expect(promqlSeriesLabelRule('')).toEqual({ mode: 'all' });
  });
});
