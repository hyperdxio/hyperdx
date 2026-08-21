import {
  aggFnToSelectFields,
  migrateLegacyAggToSeries,
  parseExploreSeries,
} from '@/components/Search/SearchAggControls';

describe('parseExploreSeries', () => {
  it('accepts a count series', () => {
    expect(
      parseExploreSeries([
        {
          aggFn: 'count',
          valueExpression: '',
          aggCondition: 'level:error',
          aggConditionLanguage: 'lucene',
          alias: 'errors',
        },
      ]),
    ).toEqual([
      {
        aggFn: 'count',
        valueExpression: '',
        aggCondition: 'level:error',
        aggConditionLanguage: 'lucene',
        alias: 'errors',
      },
    ]);
  });

  it('defaults quantile level when missing', () => {
    const parsed = parseExploreSeries([
      { aggFn: 'quantile', valueExpression: 'Duration' },
    ]);
    expect(parsed?.[0]).toMatchObject({
      aggFn: 'quantile',
      level: 0.95,
      valueExpression: 'Duration',
    });
  });

  it('rejects an empty array', () => {
    expect(parseExploreSeries([])).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parseExploreSeries(['count'])).toBeNull();
  });
});

describe('migrateLegacyAggToSeries', () => {
  it('maps p95 to quantile + level', () => {
    expect(
      migrateLegacyAggToSeries({ agg: 'p95', aggExpr: 'Duration' }),
    ).toEqual({
      aggFn: 'quantile',
      level: 0.95,
      aggCondition: '',
      aggConditionLanguage: 'lucene',
      valueExpression: 'Duration',
    });
  });

  it('maps metric scalars onto a Value series', () => {
    expect(
      migrateLegacyAggToSeries({
        agg: 'avg',
        metric: 'http.server.duration',
        metricType: 'gauge',
      }),
    ).toMatchObject({
      aggFn: 'avg',
      valueExpression: 'Value',
      metricName: 'http.server.duration',
      metricType: 'gauge',
    });
  });
});

describe('aggFnToSelectFields', () => {
  it('passes count through', () => {
    expect(aggFnToSelectFields('count')).toEqual({ aggFn: 'count' });
  });
});
