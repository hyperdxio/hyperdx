import {
  AlertChartConfig,
  AlertChartConfigSchema,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import {
  convertAlertChartConfigToExternal,
  convertExternalAlertChartConfigToInternal,
  EVALUATION_INERT_CONFIG_KEYS,
  EXTERNAL_TO_INTERNAL_KEY,
  KNOWN_LOSSY_CONFIG_KEYS,
} from '@/routers/external-api/v2/utils/alertChartConfig';
import {
  externalAlertBuilderChartConfigSchema,
  ExternalAlertChartConfig,
  externalAlertChartConfigSchema,
  externalAlertRawSqlChartConfigSchema,
} from '@/utils/zod';

const SOURCE_ID = '65f5e4a3b9e77c001a123456';
const CONNECTION_ID = '65f5e4a3b9e77c001a789012';

const countItem = (where = '') => ({
  aggFn: 'count' as const,
  where,
  whereLanguage: 'lucene' as const,
  valueExpression: '',
});

const baseInternal = (
  overrides: Partial<Record<string, unknown>> = {},
): AlertChartConfig =>
  ({
    displayType: DisplayType.Line,
    source: SOURCE_ID,
    select: [
      {
        aggFn: 'count',
        aggCondition: '',
        aggConditionLanguage: 'lucene',
        valueExpression: '',
      },
    ],
    where: '',
    whereLanguage: 'lucene',
    ...overrides,
  }) as AlertChartConfig;

describe('externalAlertChartConfigSchema configType routing', () => {
  const builderBody = (overrides: Record<string, unknown> = {}) => ({
    displayType: DisplayType.Line,
    sourceId: SOURCE_ID,
    select: [{ aggFn: 'count', where: '' }],
    ...overrides,
  });

  const messages = (body: unknown) => {
    const result = externalAlertChartConfigSchema.safeParse(body);
    return result.success
      ? []
      : result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
  };

  it('rejects a configType the router does not recognize', () => {
    // Routing keys on configType === 'sql', so an unrecognized value would
    // otherwise parse as a builder config (unknown keys stripped) and skip
    // the builder-only rules below.
    expect(messages(builderBody({ configType: 'promql' }))).toEqual([
      'configType: configType must be "sql" or omitted (builder configs carry no configType)',
    ]);
  });

  it('still applies the builder rules to a config carrying an unsupported configType', () => {
    // The bypass this guards: both bodies parse against the builder union.
    expect(
      messages(
        builderBody({
          configType: 'promql',
          formulas: [{ expression: 'B * 2' }],
        }),
      ).join(' '),
    ).toContain('configType must be "sql" or omitted');
    expect(
      messages(
        builderBody({
          configType: 'promql',
          displayType: DisplayType.Number,
          select: [
            { aggFn: 'count', where: '' },
            { aggFn: 'count', where: 'level:error' },
          ],
        }),
      ).join(' '),
    ).toContain('configType must be "sql" or omitted');
  });

  it('applies the builder rules when configType is omitted', () => {
    expect(
      messages(builderBody({ formulas: [{ expression: 'B * 2' }] })).join(' '),
    ).toContain('Unknown series "B"');
    expect(
      messages(
        builderBody({
          displayType: DisplayType.Number,
          select: [
            { aggFn: 'count', where: '' },
            { aggFn: 'count', where: 'level:error' },
          ],
        }),
      ).join(' '),
    ).toContain('Number charts support a single select item');
  });

  it('accepts the raw SQL dialect', () => {
    expect(
      messages({
        configType: 'sql',
        displayType: DisplayType.Line,
        connectionId: CONNECTION_ID,
        sqlTemplate:
          'SELECT $__timeInterval(Timestamp) AS ts, count() FROM t WHERE $__timeFilter(Timestamp) GROUP BY ts',
      }),
    ).toEqual([]);
  });
});

describe('convertExternalAlertChartConfigToInternal', () => {
  it('maps the external dialect onto the internal one', () => {
    const internal = convertExternalAlertChartConfigToInternal({
      displayType: DisplayType.Line,
      sourceId: SOURCE_ID,
      name: 'Error Rate Query',
      where: 'ServiceName:api',
      whereLanguage: 'lucene',
      groupBy: 'ServiceName',
      asRatio: true,
      select: [
        {
          aggFn: 'avg',
          valueExpression: 'Value',
          where: 'level:error',
          whereLanguage: 'lucene',
          alias: 'CPU',
          metricType: 'gauge',
          metricName: 'system.cpu.utilization',
          periodAggFn: 'delta',
        },
        countItem(),
      ],
    } as ExternalAlertChartConfig);

    expect(internal).toMatchObject({
      displayType: DisplayType.Line,
      source: SOURCE_ID,
      name: 'Error Rate Query',
      where: 'ServiceName:api',
      whereLanguage: 'lucene',
      groupBy: 'ServiceName',
      seriesReturnType: 'ratio',
      select: [
        {
          aggFn: 'avg',
          valueExpression: 'Value',
          aggCondition: 'level:error',
          aggConditionLanguage: 'lucene',
          alias: 'CPU',
          metricType: 'gauge',
          metricName: 'system.cpu.utilization',
          isDelta: true,
        },
        { aggFn: 'count', aggCondition: '', isDelta: false },
      ],
    });
    expect('alert' in internal).toBe(false);
  });

  it('omits the synthetic tile name and never persists an alert field', () => {
    const internal = convertExternalAlertChartConfigToInternal({
      displayType: DisplayType.Line,
      sourceId: SOURCE_ID,
      select: [countItem()],
    } as ExternalAlertChartConfig);

    expect('name' in internal).toBe(false);
    expect('alert' in internal).toBe(false);
  });
});

describe('external <-> internal round-trip', () => {
  it('round-trips a builder line config, including alert-only and metric fields', () => {
    const external = {
      displayType: DisplayType.Line,
      sourceId: SOURCE_ID,
      name: 'Error Rate Query',
      where: 'ServiceName:api',
      whereLanguage: 'lucene' as const,
      groupBy: 'ServiceName',
      asRatio: true,
      seriesLimit: 5,
      fillNulls: false,
      numberFormat: { output: 'number' as const },
      select: [
        {
          aggFn: 'avg' as const,
          valueExpression: 'Value',
          where: 'level:error',
          whereLanguage: 'lucene' as const,
          alias: 'CPU',
          metricType: 'gauge' as const,
          metricName: 'system.cpu.utilization',
          periodAggFn: 'delta' as const,
        },
        countItem(),
      ],
    } as ExternalAlertChartConfig;

    const roundTripped = convertAlertChartConfigToExternal(
      convertExternalAlertChartConfigToInternal(external),
    );

    expect(roundTripped).toEqual(external);
  });

  it('round-trips a quantile select item with its level', () => {
    const external = {
      displayType: DisplayType.StackedBar,
      sourceId: SOURCE_ID,
      select: [
        {
          aggFn: 'quantile' as const,
          level: 0.95 as const,
          valueExpression: 'Duration',
          where: '',
          whereLanguage: 'lucene' as const,
        },
      ],
    } as ExternalAlertChartConfig;

    const roundTripped = convertAlertChartConfigToExternal(
      convertExternalAlertChartConfigToInternal(external),
    );

    expect(roundTripped).toMatchObject({
      displayType: DisplayType.StackedBar,
      select: [{ aggFn: 'quantile', level: 0.95, valueExpression: 'Duration' }],
    });
  });

  it('round-trips a raw SQL config', () => {
    const external = {
      configType: 'sql' as const,
      displayType: DisplayType.Line,
      connectionId: CONNECTION_ID,
      sourceId: SOURCE_ID,
      sqlTemplate: 'SELECT $__timeInterval(Timestamp) AS ts, count() ...',
      name: 'Raw SQL Alert Query',
      fillNulls: true,
    } as ExternalAlertChartConfig;

    const roundTripped = convertAlertChartConfigToExternal(
      convertExternalAlertChartConfigToInternal(external),
    );

    expect(roundTripped).toEqual(external);
  });
});

describe('convertAlertChartConfigToExternal', () => {
  it('emits a number config', () => {
    const external = convertAlertChartConfigToExternal(
      baseInternal({
        displayType: DisplayType.Number,
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
        ],
      }),
    );

    expect(external).toMatchObject({
      displayType: DisplayType.Number,
      sourceId: SOURCE_ID,
    });
  });

  it('still emits configs carrying evaluation-inert extras', () => {
    const external = convertAlertChartConfigToExternal(
      baseInternal({
        seriesReturnType: 'column',
        fillNulls: 0,
        markdown: '',
        groupByColumnsOnLeft: true,
        compareToPreviousPeriod: true,
        color: 'chart-blue',
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
            color: 'chart-red',
          },
        ],
      }),
    );

    expect(external).toMatchObject({ displayType: DisplayType.Line });
  });

  it.each([
    [
      'filters',
      { filters: [{ type: 'sql', condition: "ServiceName = 'api'" }] },
    ],
    ['having', { having: 'count() > 5', havingLanguage: 'sql' }],
    ['orderBy', { orderBy: 'Timestamp DESC' }],
    ['limit', { limit: { limit: 10 } }],
    ['ratioMode', { ratioMode: 'total' }],
    ['selectGroupBy', { selectGroupBy: true }],
    ['granularity', { granularity: '5 minute' }],
    ['implicitColumnExpression', { implicitColumnExpression: 'Body' }],
    ['sampleWeightExpression', { sampleWeightExpression: 'SampleRate' }],
    ['a raw SQL select expression string', { select: 'count() as count' }],
    [
      'an unknown future field',
      { someFutureEvaluationKnob: 'on' } as Record<string, unknown>,
    ],
  ])('refuses to emit a config carrying %s', (_label, overrides) => {
    expect(
      convertAlertChartConfigToExternal(baseInternal(overrides)),
    ).toBeUndefined();
  });

  // The internal schema leaves these strings uncapped / this shape legal;
  // the post-conversion parse against externalAlertChartConfigSchema (the
  // exact schema PUT enforces) is what refuses them, so an emitted body is
  // valid PUT input by construction.
  it('refuses a chart-level where longer than the external cap', () => {
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({ where: 'a'.repeat(10001) }),
      ),
    ).toBeUndefined();
  });

  it('refuses select-item strings longer than the external caps', () => {
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({
          select: [
            {
              aggFn: 'count',
              aggCondition: 'a'.repeat(10001),
              aggConditionLanguage: 'lucene',
              valueExpression: '',
            },
          ],
        }),
      ),
    ).toBeUndefined();

    expect(
      convertAlertChartConfigToExternal(
        baseInternal({
          select: [
            {
              aggFn: 'avg',
              aggCondition: '',
              aggConditionLanguage: 'lucene',
              valueExpression: 'a'.repeat(10001),
            },
          ],
        }),
      ),
    ).toBeUndefined();

    expect(
      convertAlertChartConfigToExternal(
        baseInternal({
          select: [
            {
              aggFn: 'count',
              aggCondition: '',
              aggConditionLanguage: 'lucene',
              valueExpression: '',
              alias: 'a'.repeat(10001),
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it('refuses a non-count aggregation with an empty valueExpression', () => {
    // Legal internally, but the external select-item schema requires a value
    // expression for non-count aggregations — emitting it would produce a
    // body that 400s on echo-PUT.
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({
          select: [
            {
              aggFn: 'avg',
              aggCondition: '',
              aggConditionLanguage: 'lucene',
              valueExpression: '',
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it('refuses an array groupBy the tile dialect cannot carry', () => {
    // renderSelectList evaluates array groupBys, so the alert task honors
    // them; the tile converter silently omits the field, which would let an
    // echo-PUT strip the grouping from a live alert.
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({
          groupBy: [{ valueExpression: 'ServiceName' }],
        }),
      ),
    ).toBeUndefined();

    // The string form the tile dialect does carry still round-trips.
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({ groupBy: 'ServiceName' }),
      ),
    ).toMatchObject({ groupBy: 'ServiceName' });
  });

  it('refuses a select item whose aggFn the external enum cannot express', () => {
    // The internal schema admits aggregations the external one does not
    // (histogram, quantileMerge, the *Merge combinators).
    // convertToExternalSelectItem would emit aggFn: 'none' for these, so a
    // GET -> PUT would silently rewrite the aggregation.
    for (const aggFn of ['sumIfMerge', 'quantileMerge', 'histogram']) {
      expect(
        convertAlertChartConfigToExternal(
          baseInternal({
            select: [
              {
                aggFn,
                aggCondition: '',
                aggConditionLanguage: 'lucene',
                valueExpression: 'Value',
                ...(aggFn === 'quantileMerge' ? { level: 0.95 } : {}),
              },
            ],
          }),
        ),
      ).toBeUndefined();
    }
  });

  it('refuses a quantile level outside the external set', () => {
    // The internal `level` is any number; the external dialect admits only
    // 0.5/0.9/0.95/0.99, and the converter drops anything else — emitting a
    // quantile with no level.
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({
          select: [
            {
              aggFn: 'quantile',
              level: 0.75,
              aggCondition: '',
              aggConditionLanguage: 'lucene',
              valueExpression: 'Duration',
            },
          ],
        }),
      ),
    ).toBeUndefined();

    // A level the dialect does admit still round-trips.
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({
          select: [
            {
              aggFn: 'quantile',
              level: 0.95,
              aggCondition: '',
              aggConditionLanguage: 'lucene',
              valueExpression: 'Duration',
            },
          ],
        }),
      ),
    ).toMatchObject({ select: [{ aggFn: 'quantile', level: 0.95 }] });
  });

  it('refuses an empty select instead of throwing on a number config', () => {
    // A persisted number config with select: [] used to TypeError in the
    // tile converter (select[0] is undefined) and surface as a 500 from
    // GET /api/v2/alerts/:id.
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({ displayType: DisplayType.Number, select: [] }),
      ),
    ).toBeUndefined();
    expect(
      convertAlertChartConfigToExternal(baseInternal({ select: [] })),
    ).toBeUndefined();
  });

  it('refuses more than 20 select items', () => {
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({
          select: Array.from({ length: 21 }, () => ({
            aggFn: 'count',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          })),
        }),
      ),
    ).toBeUndefined();
  });

  it('refuses a formula-less number config with multiple select items', () => {
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({
          displayType: DisplayType.Number,
          select: [
            {
              aggFn: 'count',
              aggCondition: '',
              aggConditionLanguage: 'lucene',
              valueExpression: '',
            },
            {
              aggFn: 'count',
              aggCondition: 'level:error',
              aggConditionLanguage: 'lucene',
              valueExpression: '',
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it('refuses unsupported display types and PromQL configs', () => {
    expect(
      convertAlertChartConfigToExternal(
        baseInternal({ displayType: DisplayType.Table }),
      ),
    ).toBeUndefined();
    expect(
      convertAlertChartConfigToExternal({
        configType: 'promql',
        promqlQuery: 'up',
        source: SOURCE_ID,
      } as unknown as AlertChartConfig),
    ).toBeUndefined();
  });
});

// Drift guard: every field the internal alert chart config can persist must
// be deliberately classified as externally representable, evaluation-inert,
// or known-lossy. A new field on the internal schema breaks this test and
// forces a decision instead of silently leaking through the external
// round-trip (unknown fields refuse at runtime either way — this test is
// about intent, not safety).
describe('internal schema field classification', () => {
  const representableInternalKeys = new Set(
    [
      ...externalAlertBuilderChartConfigSchema.options,
      ...externalAlertRawSqlChartConfigSchema.options,
    ].flatMap(member =>
      Object.keys(member.shape).map(
        key => EXTERNAL_TO_INTERNAL_KEY[key] ?? key,
      ),
    ),
  );

  it.each(
    AlertChartConfigSchema.options.flatMap((member, i) =>
      Object.keys(member.shape).map(
        key => [i === 0 ? 'builder' : 'raw SQL', key] as const,
      ),
    ),
  )('classifies the internal %s config field "%s"', (_variant, key) => {
    const classified =
      representableInternalKeys.has(key) ||
      EVALUATION_INERT_CONFIG_KEYS.has(key) ||
      KNOWN_LOSSY_CONFIG_KEYS.has(key);
    expect(classified).toBe(true);
  });
});
