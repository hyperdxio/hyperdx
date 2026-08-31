import { validateFormula } from '@hyperdx/common-utils/dist/core/formula';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { insertSeriesRefAtCursor } from '@/components/Explore/ExploreFormulaCard';
import {
  canAddExploreFormula,
  parseExploreFormulas,
} from '@/components/Search/exploreFormulas';
import {
  aggFnToSelectFields,
  canAddExploreSeries,
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

  it('keeps an explicit lucene condition so old links still render', () => {
    expect(
      parseExploreSeries([
        {
          aggFn: 'count',
          aggCondition: 'level:error',
          aggConditionLanguage: 'lucene',
        },
      ])?.[0],
    ).toMatchObject({ aggConditionLanguage: 'lucene' });
  });

  it('reads an unset condition language as SQL', () => {
    expect(
      parseExploreSeries([{ aggFn: 'count', valueExpression: '' }])?.[0],
    ).toMatchObject({ aggConditionLanguage: 'sql' });
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
      aggConditionLanguage: 'sql',
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

describe('parseExploreFormulas', () => {
  it('accepts an empty array', () => {
    expect(parseExploreFormulas([])).toEqual([]);
  });

  it('accepts expression and optional alias', () => {
    expect(
      parseExploreFormulas([{ expression: 'A / B', alias: 'ratio' }]),
    ).toEqual([{ expression: 'A / B', alias: 'ratio' }]);
  });

  it('keeps an unknown series ref for live validation', () => {
    expect(parseExploreFormulas([{ expression: 'A / C' }])).toEqual([
      { expression: 'A / C' },
    ]);
    const result = validateFormula('A / C', { seriesCount: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('unknown-series-ref');
      expect(result.errors[0]?.message).toContain('Unknown series "C"');
    }
  });

  it('rejects a non-array', () => {
    expect(parseExploreFormulas({ expression: 'A' })).toBeNull();
  });
});

describe('canAddExploreFormula', () => {
  it('allows time series and table formulas on log sources', () => {
    expect(canAddExploreFormula('timeseries', 0, SourceKind.Log)).toBe(true);
    expect(canAddExploreFormula('table', 1, SourceKind.Trace)).toBe(true);
  });

  it('caps number at one formula', () => {
    expect(canAddExploreFormula('number', 0, SourceKind.Metric)).toBe(true);
    expect(canAddExploreFormula('number', 1, SourceKind.Metric)).toBe(false);
  });

  it('rejects pie, bar, and session sources', () => {
    expect(canAddExploreFormula('pie', 0, SourceKind.Log)).toBe(false);
    expect(canAddExploreFormula('bar', 0, SourceKind.Log)).toBe(false);
    expect(canAddExploreFormula('timeseries', 0, SourceKind.Session)).toBe(
      false,
    );
  });
});

describe('canAddExploreSeries', () => {
  it('lifts the number series cap when a formula exists', () => {
    expect(canAddExploreSeries('number', 2)).toBe(false);
    expect(canAddExploreSeries('number', 2, true)).toBe(true);
  });
});

describe('insertSeriesRefAtCursor', () => {
  it('inserts a letter into an empty expression', () => {
    expect(insertSeriesRefAtCursor('', 'A', 0, 0)).toEqual({
      next: 'A',
      cursor: 1,
    });
  });

  it('pads a letter when appending after another ref', () => {
    expect(insertSeriesRefAtCursor('A', 'B', 1, 1)).toEqual({
      next: 'A B',
      cursor: 3,
    });
  });

  it('replaces the current selection', () => {
    expect(insertSeriesRefAtCursor('A / X', 'B', 4, 5)).toEqual({
      next: 'A / B',
      cursor: 5,
    });
  });
});
