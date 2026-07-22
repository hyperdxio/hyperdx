import { z } from 'zod';

import {
  BackgroundChartSchema,
  ColorConditionSchema,
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
