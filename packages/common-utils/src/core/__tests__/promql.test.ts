import { getPromqlSeries, resolveLegendTemplate } from '@/core/promql';

describe('getPromqlSeries', () => {
  it('returns the expression list as-is', () => {
    const promqlExpression = [
      { expression: 'up', alias: 'a' },
      { expression: 'rate(x[5m])', legendTemplate: '{{pod}}' },
    ];
    expect(getPromqlSeries({ promqlExpression })).toEqual(promqlExpression);
  });

  it('normalizes the legacy bare-string shape', () => {
    expect(getPromqlSeries({ promqlExpression: 'up' })).toEqual([
      { expression: 'up' },
    ]);
    // A blank string still yields a row, so the editor has one to render.
    expect(getPromqlSeries({ promqlExpression: '' })).toEqual([
      { expression: '' },
    ]);
  });

  it('returns nothing when the field is unset or empty', () => {
    expect(getPromqlSeries({})).toEqual([]);
    expect(getPromqlSeries({ promqlExpression: [] })).toEqual([]);
  });
});

describe('resolveLegendTemplate', () => {
  it("prefers the expression's own template", () => {
    expect(
      resolveLegendTemplate(
        { expression: 'up', legendTemplate: '{{pod}}' },
        { legendTemplate: '{{namespace}}' },
      ),
    ).toBe('{{pod}}');
  });

  it('falls back to the chart-level template', () => {
    expect(
      resolveLegendTemplate(
        { expression: 'up' },
        {
          legendTemplate: '{{namespace}}',
        },
      ),
    ).toBe('{{namespace}}');
  });

  it('treats blank templates as unset', () => {
    expect(
      resolveLegendTemplate(
        { expression: 'up', legendTemplate: '   ' },
        { legendTemplate: '{{namespace}}' },
      ),
    ).toBe('{{namespace}}');
    expect(resolveLegendTemplate({ expression: 'up' }, {})).toBeUndefined();
  });

  it('trims the template it returns', () => {
    expect(
      resolveLegendTemplate(
        { expression: 'up', legendTemplate: '  {{pod}} ' },
        {},
      ),
    ).toBe('{{pod}}');
  });
});
