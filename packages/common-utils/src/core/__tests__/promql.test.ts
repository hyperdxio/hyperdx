import {
  appliesPromqlReducer,
  displayTypeSupportsInstantQuery,
  displayTypeSupportsReducer,
  getExemplarPromqlExpression,
  getPromqlMacroInputs,
  getPromqlSeries,
  getQueriedPromqlSeries,
  isRangeQuery,
  PROMQL_MACROS,
  promqlSeriesQueryType,
  promqlStep,
  reducePromqlSamples,
} from '@/core/promql';
import { DisplayType, PromqlReducer } from '@/types';

describe('getExemplarPromqlExpression', () => {
  it('returns the only expression, in either saved shape', () => {
    expect(getExemplarPromqlExpression('up')).toBe('up');
    expect(
      getExemplarPromqlExpression([{ expression: 'up' }, { expression: ' ' }]),
    ).toBe('up');
  });

  it('returns undefined for several expressions or none', () => {
    expect(
      getExemplarPromqlExpression([{ expression: 'a' }, { expression: 'b' }]),
    ).toBeUndefined();
    expect(getExemplarPromqlExpression(undefined)).toBeUndefined();
  });
});

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

describe('displayTypeSupportsInstantQuery', () => {
  it.each([
    DisplayType.Number,
    DisplayType.Table,
    DisplayType.Pie,
    DisplayType.Bar,
  ])('offers an instant query on %s tiles', displayType => {
    expect(displayTypeSupportsInstantQuery({ displayType })).toBe(true);
  });

  it.each([DisplayType.Line, DisplayType.StackedBar])(
    'always range-queries %s tiles',
    displayType => {
      expect(displayTypeSupportsInstantQuery({ displayType })).toBe(false);
    },
  );
});

describe('displayTypeSupportsReducer', () => {
  it.each([DisplayType.Number, DisplayType.Pie, DisplayType.Bar])(
    'reduces range buckets on %s tiles',
    displayType => {
      expect(displayTypeSupportsReducer({ displayType })).toBe(true);
    },
  );

  it('keeps every sample on table tiles', () => {
    expect(displayTypeSupportsReducer({ displayType: DisplayType.Table })).toBe(
      false,
    );
  });
});

describe('promqlSeriesQueryType', () => {
  it('defaults to a range query', () => {
    expect(promqlSeriesQueryType({ expression: 'up' })).toBe('range');
  });

  it("honours the expression's own choice", () => {
    expect(
      promqlSeriesQueryType({ expression: 'up', queryType: 'instant' }),
    ).toBe('instant');
    expect(
      promqlSeriesQueryType({ expression: 'up', queryType: 'range' }),
    ).toBe('range');
  });
});

describe('reducePromqlSamples', () => {
  const samples = [3, 1, 4, 1, 5];

  it('reduces to the last sample by default', () => {
    expect(reducePromqlSamples(samples)).toBe(5);
  });

  it.each([
    [PromqlReducer.LastNotNull, 5],
    [PromqlReducer.Min, 1],
    [PromqlReducer.Max, 5],
    [PromqlReducer.Mean, 2.8],
    [PromqlReducer.Sum, 14],
    [PromqlReducer.Count, 5],
  ])('reduces with %s', (reducer, expected) => {
    expect(reducePromqlSamples(samples, reducer)).toBe(expected);
  });

  // Prometheus reports a gap or a division by zero as NaN; averaging or
  // summing those would poison the whole result.
  it('skips non-finite samples', () => {
    const withGaps = [2, Number.NaN, 4, Number.NaN];
    expect(reducePromqlSamples(withGaps, PromqlReducer.Mean)).toBe(3);
    expect(reducePromqlSamples(withGaps, PromqlReducer.Sum)).toBe(6);
    expect(reducePromqlSamples(withGaps, PromqlReducer.Count)).toBe(2);
    expect(reducePromqlSamples(withGaps, PromqlReducer.LastNotNull)).toBe(4);
  });

  it('reports no value rather than zero when nothing is usable', () => {
    expect(reducePromqlSamples([])).toBeUndefined();
    expect(
      reducePromqlSamples([Number.NaN], PromqlReducer.Sum),
    ).toBeUndefined();
  });

  it('keeps negative samples', () => {
    expect(reducePromqlSamples([-5, -1], PromqlReducer.Min)).toBe(-5);
    expect(reducePromqlSamples([-5, -1], PromqlReducer.Max)).toBe(-1);
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

describe('promqlStep with a window', () => {
  const hour: [Date, Date] = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T01:00:00Z'),
  ];
  const month: [Date, Date] = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-31T00:00:00Z'),
  ];

  it('still prefers the granularity the tile carries', () => {
    expect(promqlStep('5 minute', hour)).toBe('300s');
  });

  it('resolves auto against the window', () => {
    expect(promqlStep('auto', hour)).toBe('60s');
    expect(promqlStep(undefined, hour)).toBe('60s');
    expect(promqlStep('auto', month)).not.toBe('60s');
  });

  it('floors an auto step at minGranularitySeconds', () => {
    expect(promqlStep('auto', hour, 300)).toBe('300s');
    expect(promqlStep(undefined, hour, 300)).toBe('300s');
  });

  it('leaves an auto step alone when it is already above the floor', () => {
    expect(promqlStep('auto', month, 60)).toBe(promqlStep('auto', month));
  });

  it('never floors a granularity the tile picked', () => {
    expect(promqlStep('15 second', hour, 300)).toBe('15s');
  });
});

describe('PROMQL_MACROS', () => {
  const hour: [Date, Date] = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T01:00:00Z'),
  ];
  const expandMacro = (
    name: string,
    granularity: string,
    dateRange: [Date, Date],
    minGranularitySeconds?: number,
  ) =>
    PROMQL_MACROS.find(macro => macro.name === name)?.expand(
      getPromqlMacroInputs(granularity, dateRange, minGranularitySeconds),
    );

  it('uses the step for $__interval', () => {
    expect(expandMacro('interval', '5 minute', hour)).toBe('300s');
    expect(expandMacro('interval', 'auto', hour)).toBe(
      promqlStep('auto', hour),
    );
  });

  it('rounds the window length to seconds for $__range', () => {
    expect(expandMacro('range', '1 minute', hour)).toBe('3600s');
    expect(
      expandMacro('range', '1 minute', [
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-01T00:00:10.600Z'),
      ]),
    ).toBe('11s');
    expect(expandMacro('range', '1 minute', [hour[0], hour[0]])).toBe('1s');
  });

  it('floors $__rate_interval at four scrape intervals', () => {
    expect(expandMacro('rate_interval', '15 second', hour)).toBe('60s');
    expect(expandMacro('rate_interval', '1 minute', hour)).toBe('75s');
    expect(expandMacro('rate_interval', '5 minute', hour)).toBe('315s');
  });

  it('floors an auto $__interval at minGranularitySeconds', () => {
    expect(expandMacro('interval', 'auto', hour, 300)).toBe('300s');
  });

  it('sizes $__rate_interval from minGranularitySeconds as the scrape interval', () => {
    // max(60 + 60, 4 * 60)
    expect(expandMacro('rate_interval', '1 minute', hour, 60)).toBe('240s');
    // max(300 + 300, 4 * 300)
    expect(expandMacro('rate_interval', 'auto', hour, 300)).toBe('1200s');
  });

  it('sizes $__rate_interval from the floor even when the tile picked its granularity', () => {
    // The step stays 15s, but the data only arrives every 60s:
    // max(15 + 60, 4 * 60)
    expect(expandMacro('interval', '15 second', hour, 60)).toBe('15s');
    expect(expandMacro('rate_interval', '15 second', hour, 60)).toBe('240s');
  });

  it('assumes a 15s scrape interval when there is no floor', () => {
    expect(expandMacro('rate_interval', '15 second', hour, undefined)).toBe(
      '60s',
    );
    expect(expandMacro('rate_interval', '15 second', hour, 0)).toBe('60s');
  });
});

describe('isRangeQuery', () => {
  it('is false while every queried expression is an instant query', () => {
    expect(
      isRangeQuery({
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
        displayType: DisplayType.Number,
      }),
    ).toBe(false);
  });

  it('is true once a queried expression asks for a range', () => {
    expect(
      isRangeQuery({
        promqlExpression: [{ expression: 'up', queryType: 'range' }],
        displayType: DisplayType.Number,
      }),
    ).toBe(true);
  });

  it('is true for an expression that never chose, which ranges by default', () => {
    expect(
      isRangeQuery({
        promqlExpression: [{ expression: 'up' }],
        displayType: DisplayType.Number,
      }),
    ).toBe(true);
  });

  it('ignores expressions the chart does not query', () => {
    expect(
      isRangeQuery({
        promqlExpression: [
          { expression: 'up', queryType: 'instant' },
          // A single-value chart queries only its first expression, so a range setting
          // on a later one changes nothing.
          { expression: 'down', queryType: 'range' },
        ],
        displayType: DisplayType.Number,
      }),
    ).toBe(false);
  });

  it('reads a later expression of a time series chart', () => {
    expect(
      isRangeQuery({
        promqlExpression: [
          { expression: 'up', queryType: 'instant' },
          // A time series chart queries every expression, so any one of them ranging
          // gives the tile a step to read.
          { expression: 'down', queryType: 'range' },
        ],
        displayType: DisplayType.Line,
      }),
    ).toBe(true);
  });

  it('is false when nothing is queried', () => {
    expect(isRangeQuery({ displayType: DisplayType.Line })).toBe(false);
  });
});

describe('appliesPromqlReducer', () => {
  it.each(['instant', 'range'] as const)(
    'applies to a %s query on a reducing display type',
    queryType => {
      expect(
        appliesPromqlReducer({
          promqlExpression: [
            { expression: 'up', queryType, reducer: PromqlReducer.Max },
          ],
          displayType: DisplayType.Pie,
        }),
      ).toBe(true);
    },
  );

  it('does not apply when no reducer is named', () => {
    expect(
      appliesPromqlReducer({
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
        displayType: DisplayType.Number,
      }),
    ).toBe(false);
  });

  it('does not apply to a display type that plots every sample', () => {
    expect(
      appliesPromqlReducer({
        promqlExpression: [{ expression: 'up', reducer: PromqlReducer.Max }],
        displayType: DisplayType.Line,
      }),
    ).toBe(false);
  });
});
