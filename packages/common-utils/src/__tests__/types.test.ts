import { z } from 'zod';

import { MAX_FORMULA_EXPRESSION_LENGTH } from '@/core/formula';
import {
  BackgroundChartSchema,
  ColorConditionSchema,
  DASHBOARD_VARIABLE_NAME_MAX_LENGTH,
  DashboardFilterSchema,
  DerivedColumnSchema,
  MetricFormulaSchema,
  SavedChartConfigSchema,
} from '@/types';

describe('ColorConditionSchema', () => {
  // ─── Positive cases ─────────────────────────────────────────────────────────

  describe('numeric ordered operators', () => {
    it.each(['gt', 'gte', 'lt', 'lte'] as const)(
      'parses operator %s with a valid numeric value',
      operator => {
        const result = ColorConditionSchema.safeParse({
          operator,
          value: 42,
          color: 'chart-success',
        });
        expect(result.success).toBe(true);
      },
    );

    it('parses with an optional label', () => {
      const result = ColorConditionSchema.safeParse({
        operator: 'gte',
        value: 100,
        color: 'chart-warning',
        label: 'High',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('between operator', () => {
    it('parses a valid between rule', () => {
      const result = ColorConditionSchema.safeParse({
        operator: 'between',
        value: [10, 100],
        color: 'chart-blue',
      });
      expect(result.success).toBe(true);
    });

    it('allows inverted between (first > second)', () => {
      const result = ColorConditionSchema.safeParse({
        operator: 'between',
        value: [100, 10],
        color: 'chart-blue',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('eq / neq operators', () => {
    it('parses eq with a number value', () => {
      const result = ColorConditionSchema.safeParse({
        operator: 'eq',
        value: 5,
        color: 'chart-error',
      });
      expect(result.success).toBe(true);
    });

    it('parses eq with a string value', () => {
      const result = ColorConditionSchema.safeParse({
        operator: 'eq',
        value: 'CRIT',
        color: 'chart-error',
      });
      expect(result.success).toBe(true);
    });

    it('parses neq with a number value', () => {
      const result = ColorConditionSchema.safeParse({
        operator: 'neq',
        value: 0,
        color: 'chart-orange',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('string operators', () => {
    it.each(['contains', 'startsWith', 'endsWith'] as const)(
      'parses operator %s with a non-empty string value',
      operator => {
        const result = ColorConditionSchema.safeParse({
          operator,
          value: 'error',
          color: 'chart-error',
        });
        expect(result.success).toBe(true);
      },
    );

    it('parses regex with a valid pattern', () => {
      const result = ColorConditionSchema.safeParse({
        operator: 'regex',
        value: '^error.*',
        color: 'chart-error',
      });
      expect(result.success).toBe(true);
    });
  });

  it('parses with all palette tokens', () => {
    const tokens = [
      'chart-blue',
      'chart-orange',
      'chart-red',
      'chart-cyan',
      'chart-green',
      'chart-pink',
      'chart-purple',
      'chart-light-blue',
      'chart-brown',
      'chart-gray',
      'chart-success',
      'chart-warning',
      'chart-error',
    ] as const;
    for (const token of tokens) {
      const result = ColorConditionSchema.safeParse({
        operator: 'gt',
        value: 0,
        color: token,
      });
      expect(result.success).toBe(true);
    }
  });

  // ─── Negative cases ──────────────────────────────────────────────────────────

  it('rejects an unknown operator', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'notAnOp',
      value: 1,
      color: 'chart-blue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects NaN on numeric operators', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'gt',
      value: Number.NaN,
      color: 'chart-blue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects Infinity on numeric operators', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'lt',
      value: Infinity,
      color: 'chart-blue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a string value on a numeric operator (gt)', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'gt',
      value: 'oops',
      color: 'chart-blue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a number value on a string operator (contains)', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'contains',
      value: 42,
      color: 'chart-blue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid palette token', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'gt',
      value: 1,
      color: 'not-a-token',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty string on contains', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'contains',
      value: '',
      color: 'chart-blue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty string on startsWith', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'startsWith',
      value: '',
      color: 'chart-blue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty string on endsWith', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'endsWith',
      value: '',
      color: 'chart-blue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty string on regex', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'regex',
      value: '',
      color: 'chart-blue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unparseable regex pattern', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'regex',
      value: '[invalid',
      color: 'chart-blue',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a label longer than 40 characters', () => {
    const result = ColorConditionSchema.safeParse({
      operator: 'gt',
      value: 1,
      color: 'chart-blue',
      label: 'a'.repeat(41),
    });
    expect(result.success).toBe(false);
  });
});

describe('colorRules array in SharedChartSettingsSchema', () => {
  // Test array constraints directly with a z.array(ColorConditionSchema).max(10) schema,
  // mirroring how SharedChartSettingsSchema declares colorRules.
  const rulesSchema = z.array(ColorConditionSchema).max(10).optional();

  it('accepts 0 rules', () => {
    expect(rulesSchema.safeParse([]).success).toBe(true);
  });

  it('accepts 1 rule', () => {
    expect(
      rulesSchema.safeParse([{ operator: 'gt', value: 0, color: 'chart-blue' }])
        .success,
    ).toBe(true);
  });

  it('accepts 5 rules', () => {
    const rules = Array.from({ length: 5 }, (_, i) => ({
      operator: 'gt' as const,
      value: i * 10,
      color: 'chart-blue' as const,
    }));
    expect(rulesSchema.safeParse(rules).success).toBe(true);
  });

  it('accepts 10 rules', () => {
    const rules = Array.from({ length: 10 }, (_, i) => ({
      operator: 'gte' as const,
      value: i * 10,
      color: 'chart-blue' as const,
    }));
    expect(rulesSchema.safeParse(rules).success).toBe(true);
  });

  it('rejects 11 rules', () => {
    const rules = Array.from({ length: 11 }, (_, i) => ({
      operator: 'gte' as const,
      value: i * 10,
      color: 'chart-blue' as const,
    }));
    expect(rulesSchema.safeParse(rules).success).toBe(false);
  });
});

describe('BackgroundChartSchema', () => {
  // ─── Positive cases ─────────────────────────────────────────────────────────

  it.each(['line', 'area'] as const)(
    'parses type %s without a color override',
    type => {
      expect(BackgroundChartSchema.safeParse({ type }).success).toBe(true);
    },
  );

  it('parses with a palette-token color override', () => {
    expect(
      BackgroundChartSchema.safeParse({ type: 'area', color: 'chart-success' })
        .success,
    ).toBe(true);
  });

  // ─── Negative cases ──────────────────────────────────────────────────────────

  it('rejects an unknown chart type', () => {
    expect(BackgroundChartSchema.safeParse({ type: 'bar' }).success).toBe(
      false,
    );
  });

  it('rejects a missing type', () => {
    expect(
      BackgroundChartSchema.safeParse({ color: 'chart-blue' }).success,
    ).toBe(false);
  });

  it('rejects an invalid palette token', () => {
    expect(
      BackgroundChartSchema.safeParse({ type: 'line', color: 'not-a-token' })
        .success,
    ).toBe(false);
  });
});

describe('DerivedColumnSchema color fields', () => {
  // A minimal valid select item (count aggregation) the table builder emits.
  const baseColumn = {
    aggFn: 'count' as const,
    aggCondition: '',
    aggConditionLanguage: 'sql' as const,
    valueExpression: '',
  };

  // ─── Positive cases ─────────────────────────────────────────────────────────

  it('parses a column with no color fields (backward compatible)', () => {
    expect(DerivedColumnSchema.safeParse(baseColumn).success).toBe(true);
  });

  it('round-trips a static palette-token color', () => {
    const result = DerivedColumnSchema.safeParse({
      ...baseColumn,
      color: 'chart-error',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.color).toBe('chart-error');
    }
  });

  it.each(['gt', 'gte', 'lt', 'lte'] as const)(
    'round-trips a %s colorRule',
    operator => {
      const result = DerivedColumnSchema.safeParse({
        ...baseColumn,
        colorRules: [{ operator, value: 500, color: 'chart-warning' }],
      });
      expect(result.success).toBe(true);
    },
  );

  it('round-trips a between colorRule', () => {
    const result = DerivedColumnSchema.safeParse({
      ...baseColumn,
      colorRules: [
        { operator: 'between', value: [10, 100], color: 'chart-blue' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it.each(['eq', 'neq'] as const)('round-trips a %s colorRule', operator => {
    const result = DerivedColumnSchema.safeParse({
      ...baseColumn,
      colorRules: [{ operator, value: 'OK', color: 'chart-success' }],
    });
    expect(result.success).toBe(true);
  });

  it('round-trips a static color and rules together', () => {
    const result = DerivedColumnSchema.safeParse({
      ...baseColumn,
      color: 'chart-blue',
      colorRules: [{ operator: 'gt', value: 500, color: 'chart-error' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.color).toBe('chart-blue');
      expect(result.data.colorRules).toHaveLength(1);
    }
  });

  // ─── Negative cases ──────────────────────────────────────────────────────────

  it('rejects an unknown static color token', () => {
    expect(
      DerivedColumnSchema.safeParse({ ...baseColumn, color: 'not-a-token' })
        .success,
    ).toBe(false);
  });

  it('rejects a colorRule with an unknown color token', () => {
    expect(
      DerivedColumnSchema.safeParse({
        ...baseColumn,
        colorRules: [{ operator: 'gt', value: 1, color: 'puce' }],
      }).success,
    ).toBe(false);
  });

  it('rejects more than 10 colorRules', () => {
    const colorRules = Array.from({ length: 11 }, (_, i) => ({
      operator: 'gte' as const,
      value: i * 10,
      color: 'chart-blue' as const,
    }));
    expect(
      DerivedColumnSchema.safeParse({ ...baseColumn, colorRules }).success,
    ).toBe(false);
  });
});

describe('alternateRowBackground on saved chart configs', () => {
  // The field lives on SharedChartSettingsSchema, so both builder and raw SQL
  // saved configs carry it (the zebra striping is purely presentational and
  // renders the same way regardless of how the rows were produced). A schema
  // that only declared it on the builder config would silently strip it from a
  // raw SQL tile on save.

  it('retains alternateRowBackground on a raw SQL table saved config', () => {
    const parsed = SavedChartConfigSchema.parse({
      configType: 'sql',
      sqlTemplate: 'SELECT count() AS Count FROM t',
      connection: 'test-connection',
      displayType: 'table',
      alternateRowBackground: true,
    });

    expect(parsed).toMatchObject({ alternateRowBackground: true });
  });

  it('retains alternateRowBackground on a builder table saved config', () => {
    const parsed = SavedChartConfigSchema.parse({
      source: 'test-source',
      timestampValueExpression: 'Timestamp',
      displayType: 'table',
      select: [{ aggFn: 'count', valueExpression: '', alias: 'Count' }],
      where: '',
      alternateRowBackground: true,
    });

    expect(parsed).toMatchObject({ alternateRowBackground: true });
  });
});

describe('DashboardFilterSchema variable fields', () => {
  const baseFilter = {
    id: 'f1',
    type: 'QUERY_EXPRESSION' as const,
    name: 'Service',
    expression: 'ServiceName',
    source: 'source-1',
  };

  it('parses a filter with none of the variable fields set', () => {
    const parsed = DashboardFilterSchema.parse(baseFilter);
    expect(parsed.isBroadcastEnabled).toBeUndefined();
    expect(parsed.isVariableEnabled).toBeUndefined();
    expect(parsed.variableName).toBeUndefined();
  });

  it('parses a fully configured variable filter', () => {
    const parsed = DashboardFilterSchema.parse({
      ...baseFilter,
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'Service_Name_1',
    });
    expect(parsed).toMatchObject({
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'Service_Name_1',
    });
  });

  // The requiredness of `variableName` is a form-level concern: readers fall back
  // to a name derived from the filter's display name, so a filter written by any
  // other path stays resolvable rather than being rejected.
  it('accepts isVariableEnabled without a variableName', () => {
    const result = DashboardFilterSchema.safeParse({
      ...baseFilter,
      isVariableEnabled: true,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    'has space',
    'dollar$',
    'dot.notation',
    "quote'",
    'br[ackets]',
    'with-dash',
    '1leading',
    '_leading',
    '',
  ])('rejects variableName %p', variableName => {
    const result = DashboardFilterSchema.safeParse({
      ...baseFilter,
      variableName,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a variableName longer than the maximum', () => {
    const result = DashboardFilterSchema.safeParse({
      ...baseFilter,
      variableName: 'a'.repeat(DASHBOARD_VARIABLE_NAME_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a variableName at exactly the maximum length', () => {
    const result = DashboardFilterSchema.safeParse({
      ...baseFilter,
      variableName: 'a'.repeat(DASHBOARD_VARIABLE_NAME_MAX_LENGTH),
    });
    expect(result.success).toBe(true);
  });
});

describe('MetricFormulaSchema', () => {
  it('parses an expression-only formula', () => {
    const result = MetricFormulaSchema.safeParse({
      expression: 'A / (A + B + C) * 100',
    });
    expect(result.success).toBe(true);
  });

  it('parses a formula with alias and numberFormat', () => {
    const result = MetricFormulaSchema.safeParse({
      expression: 'A / B',
      alias: 'Success rate',
      numberFormat: { output: 'percent', mantissa: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('requires an expression', () => {
    expect(MetricFormulaSchema.safeParse({ alias: 'x' }).success).toBe(false);
    expect(MetricFormulaSchema.safeParse({ expression: 1 }).success).toBe(
      false,
    );
  });

  // The schema length cap and the parser's MAX_FORMULA_EXPRESSION_LENGTH
  // must agree — types.ts is a leaf module (imports only zod), so the bound
  // is duplicated as a literal there and pinned here.
  it('caps expression length at MAX_FORMULA_EXPRESSION_LENGTH', () => {
    expect(
      MetricFormulaSchema.safeParse({
        expression: 'A'.repeat(MAX_FORMULA_EXPRESSION_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      MetricFormulaSchema.safeParse({
        expression: 'A'.repeat(MAX_FORMULA_EXPRESSION_LENGTH + 1),
      }).success,
    ).toBe(false);
  });
});

describe('formulas on saved chart configs', () => {
  // `formulas` / `showOperandSeries` live on _ChartConfigSchema (builder
  // configs only — formulas reference `select` entries by position, which
  // raw SQL / PromQL configs do not have).

  it('retains formulas and showOperandSeries on a builder saved config', () => {
    const parsed = SavedChartConfigSchema.parse({
      source: 'test-source',
      timestampValueExpression: 'Timestamp',
      select: [
        { aggFn: 'sum', valueExpression: 'Value', metricName: 'success' },
        { aggFn: 'sum', valueExpression: 'Value', metricName: 'error' },
      ],
      where: '',
      formulas: [{ expression: 'A / (A + B) * 100', alias: 'Success rate' }],
      showOperandSeries: false,
    });

    expect(parsed).toMatchObject({
      formulas: [{ expression: 'A / (A + B) * 100', alias: 'Success rate' }],
      showOperandSeries: false,
    });
  });

  it('parses a builder saved config without formulas (back-compat)', () => {
    const parsed = SavedChartConfigSchema.parse({
      source: 'test-source',
      timestampValueExpression: 'Timestamp',
      select: [{ aggFn: 'count', valueExpression: '' }],
      where: '',
    });

    expect(parsed).not.toHaveProperty('formulas');
  });
});
