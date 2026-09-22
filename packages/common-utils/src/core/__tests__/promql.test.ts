import {
  getPromqlSeries,
  getQueriedPromqlSeries,
  promqlStep,
} from '@/core/promql';
import { DisplayType } from '@/types';

describe('getPromqlSeries', () => {
  it('returns the expression list as-is', () => {
    const promqlExpression = [
      { expression: 'up', alias: 'a' },
      { expression: 'rate(x[5m])' },
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

describe('getQueriedPromqlSeries', () => {
  const promqlExpression = [
    { expression: 'up', alias: 'up' },
    { expression: 'rate(errors[5m])' },
  ];

  it('keeps every expression for a time series chart', () => {
    for (const displayType of [DisplayType.Line, DisplayType.StackedBar]) {
      expect(getQueriedPromqlSeries({ promqlExpression, displayType })).toEqual(
        promqlExpression,
      );
    }
  });

  it('keeps only the first expression for other display types', () => {
    for (const displayType of [
      DisplayType.Number,
      DisplayType.Table,
      DisplayType.Pie,
      DisplayType.Bar,
      undefined,
    ]) {
      expect(getQueriedPromqlSeries({ promqlExpression, displayType })).toEqual(
        [promqlExpression[0]],
      );
    }
  });

  it('normalizes the legacy bare-string shape', () => {
    expect(
      getQueriedPromqlSeries({
        promqlExpression: 'up',
        displayType: DisplayType.Number,
      }),
    ).toEqual([{ expression: 'up' }]);
  });

  it('returns nothing when the field is unset', () => {
    expect(getQueriedPromqlSeries({ displayType: DisplayType.Line })).toEqual(
      [],
    );
  });

  // The editor keeps a row the user hasn't filled in yet, so blanks reach
  // here and must not be queried.
  it('skips blank expressions', () => {
    expect(
      getQueriedPromqlSeries({
        promqlExpression: [
          { expression: '  ' },
          { expression: 'up' },
          { expression: '' },
        ],
        displayType: DisplayType.Line,
      }),
    ).toEqual([{ expression: 'up' }]);
  });

  // Reaching past a blank first row would plot an expression the user did not
  // put first; leaving it out instead reads as an unfinished chart.
  it('queries nothing when the first expression of a non-time-series chart is blank', () => {
    expect(
      getQueriedPromqlSeries({
        promqlExpression: [{ expression: '' }, { expression: 'up' }],
        displayType: DisplayType.Number,
      }),
    ).toEqual([]);
  });
});

describe('promqlStep', () => {
  it('converts a granularity to a step', () => {
    expect(promqlStep('15 second')).toBe('15s');
    expect(promqlStep('5 minute')).toBe('300s');
    expect(promqlStep('1 day')).toBe('86400s');
    expect(promqlStep('7 day')).toBe('604800s');
  });

  it('defaults to a minute when the granularity is absent or unknown', () => {
    expect(promqlStep(undefined)).toBe('60s');
    expect(promqlStep('auto')).toBe('60s');
    expect(promqlStep('3 fortnights')).toBe('60s');
  });
});
