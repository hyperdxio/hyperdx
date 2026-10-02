import { isLiteralSqlExpression } from '@/utils/sqlLiteralExpression';

describe('isLiteralSqlExpression', () => {
  describe('literals', () => {
    it.each([
      ["'4bf92f3577b34da6a3ce929d0e0e4736'", 'quoted trace ID'],
      ["  '4bf92f3577b34da6a3ce929d0e0e4736'  ", 'surrounding whitespace'],
      ["''", 'empty string'],
      ["'it''s'", 'doubled-quote escape'],
      ["'a\\'b'", 'backslash escape'],
      ['1234567890123456', 'decimal'],
      ['0x2643cca9640b', 'hex'],
      ['0b1011', 'binary'],
      ['1.5', 'float'],
      ['1e5', 'exponent'],
    ])('flags %s (%s)', expression => {
      expect(isLiteralSqlExpression(expression)).toBe(true);
    });

    it('flags a value that ClickHouse reads as a constant plus an alias', () => {
      expect(isLiteralSqlExpression('2643 cca9640b1639cb111d28216dd09')).toBe(
        true,
      );
      expect(isLiteralSqlExpression("'abc' AS TraceId")).toBe(true);
      expect(isLiteralSqlExpression('2643 AS `cca9640b`')).toBe(true);
      expect(isLiteralSqlExpression('2643 as "cca9640b"')).toBe(true);
    });
  });

  describe('column references', () => {
    it.each([
      'TraceId',
      'lower(TraceId)',
      "LogAttributes['trace_id']",
      "ResourceAttributes['service.name']",
      '`2643cca9640b`',
      '"TraceId"',
      't.TraceId',
      '',
      '   ',
    ])('leaves %s alone', expression => {
      expect(isLiteralSqlExpression(expression)).toBe(false);
    });

    it('leaves a digit-leading hex ID alone — ClickHouse lexes it as one identifier', () => {
      expect(isLiteralSqlExpression('2643cca9640b1639cb111d28216dd09')).toBe(
        false,
      );
      expect(isLiteralSqlExpression('2643e5cca9640b')).toBe(false);
      expect(isLiteralSqlExpression('0x1234zz')).toBe(false);
    });

    it('leaves expressions that combine a literal with anything else alone', () => {
      expect(isLiteralSqlExpression("'x' || TraceId")).toBe(false);
      expect(isLiteralSqlExpression('3600 * 24')).toBe(false);
      expect(isLiteralSqlExpression('1 = 1')).toBe(false);
      expect(isLiteralSqlExpression("concat('a', TraceId)")).toBe(false);
      expect(isLiteralSqlExpression("'2024-01-01'::DateTime")).toBe(false);
    });
  });
});
