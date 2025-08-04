import {
  escapeJsonString,
  roundDownTo,
  roundDownToXMinutes,
  unflattenObject,
} from '@/tasks/util';

describe('util', () => {
  describe('unflattenObject', () => {
    it('should handle empty object', () => {
      expect(unflattenObject({}).__proto__).toBeUndefined();
      expect(unflattenObject({})).toEqual({});
    });

    it('should handle simple key-value pairs', () => {
      expect(unflattenObject({ foo: 'bar' })).toEqual({ foo: 'bar' });
    });

    it('should handle nested keys with dot notation', () => {
      expect(unflattenObject({ 'foo.bar': 'baz' })).toEqual({
        foo: { bar: 'baz' },
      });
      expect(unflattenObject({ 'foo.bar.baz': 'qux' })).toEqual({
        foo: { bar: { baz: 'qux' } },
      });
    });

    it('should handle mixed nested and flat keys', () => {
      expect(
        unflattenObject({
          'foo.bar.baz': 'qux',
          'foo.bar.quux': 'quuz',
          'foo1.bar1.baz1': 'qux1',
        }),
      ).toEqual({
        foo: { bar: { baz: 'qux', quux: 'quuz' } },
        foo1: { bar1: { baz1: 'qux1' } },
      });
    });

    it('should handle key overwriting', () => {
      expect(
        unflattenObject({ 'foo.bar.baz': 'qux', 'foo.bar': 'quuz' }),
      ).toEqual({
        foo: { bar: 'quuz' },
      });
    });

    it('should respect maxDepth parameter', () => {
      expect(
        unflattenObject(
          {
            'foo.bar.baz.qux.quuz.quux': 'qux',
          },
          '.',
          3,
        ),
      ).toEqual({
        foo: { bar: { baz: {} } },
      });
    });

    it('should handle custom separator', () => {
      expect(unflattenObject({ 'foo:bar': 'baz' }, ':')).toEqual({
        foo: { bar: 'baz' },
      });
    });

    it('should handle empty string values', () => {
      expect(unflattenObject({ 'foo.bar': '' })).toEqual({
        foo: { bar: '' },
      });
    });

    it('should handle null and undefined values', () => {
      expect(unflattenObject({ 'foo.bar': null as any })).toEqual({
        foo: { bar: null },
      });
      expect(unflattenObject({ 'foo.bar': undefined as any })).toEqual({
        foo: { bar: undefined },
      });
    });

    it('should handle maxDepth of 0', () => {
      expect(unflattenObject({ 'foo.bar.baz': 'qux' }, '.', 0)).toEqual({});
    });

    it('should handle maxDepth of 1', () => {
      expect(unflattenObject({ 'foo.bar.baz': 'qux' }, '.', 1)).toEqual({
        foo: {},
      });
    });

    it('should handle multiple keys at maxDepth boundary', () => {
      expect(
        unflattenObject(
          {
            'foo.bar.baz': 'qux',
            'foo.bar.quux': 'quuz',
            'foo.bar.qux.quuz': 'quux',
          },
          '.',
          3,
        ),
      ).toEqual({
        foo: { bar: { baz: 'qux', quux: 'quuz', qux: {} } },
      });
    });

    it('should handle keys with empty segments', () => {
      expect(() => unflattenObject({ 'foo..bar': 'baz' })).toThrowError();
    });

    it('should handle keys starting with separator', () => {
      expect(() => unflattenObject({ '.foo.bar': 'baz' })).toThrowError();
    });

    it('should handle keys ending with separator', () => {
      expect(() => unflattenObject({ 'foo.bar.': 'baz' })).toThrowError();
    });

    it('should handle complex custom separator', () => {
      expect(unflattenObject({ 'foo|bar|baz': 'qux' }, '|')).toEqual({
        foo: { bar: { baz: 'qux' } },
      });
    });

    it('should handle large objects efficiently', () => {
      const largeObj: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        largeObj[`level1.level2.level3.key${i}`] = `value${i}`;
      }

      const result = unflattenObject(largeObj);
      expect(result.level1).toBeDefined();
      expect(result.level1.level2).toBeDefined();
      expect(result.level1.level2.level3).toBeDefined();
      expect(result.level1.level2.level3.key0).toBe('value0');
      expect(result.level1.level2.level3.key99).toBe('value99');
    });
  });

  describe('roundDownTo', () => {
    it('should round down to nearest interval', () => {
      const roundDownTo1Minute = roundDownTo(1000 * 60); // 1 minute in milliseconds
      const date = new Date('2023-03-17T22:13:30.500Z');
      const result = roundDownTo1Minute(date);
      expect(result.toISOString()).toBe('2023-03-17T22:13:00.000Z');
    });

    it('should round down to nearest 5 minute interval', () => {
      const roundDownTo5Minutes = roundDownTo(1000 * 60 * 5); // 5 minutes in milliseconds
      const date = new Date('2023-03-17T22:17:30.500Z');
      const result = roundDownTo5Minutes(date);
      expect(result.toISOString()).toBe('2023-03-17T22:15:00.000Z');
    });

    it('should round down to nearest hour', () => {
      const roundDownTo1Hour = roundDownTo(1000 * 60 * 60); // 1 hour in milliseconds
      const date = new Date('2023-03-17T22:45:30.500Z');
      const result = roundDownTo1Hour(date);
      expect(result.toISOString()).toBe('2023-03-17T22:00:00.000Z');
    });

    it('should handle edge cases at interval boundaries', () => {
      const roundDownTo1Minute = roundDownTo(1000 * 60);

      // At the start of an interval
      const startOfInterval = new Date('2023-03-17T22:13:00.000Z');
      expect(roundDownTo1Minute(startOfInterval).toISOString()).toBe(
        '2023-03-17T22:13:00.000Z',
      );

      // Just before the next interval
      const justBeforeNext = new Date('2023-03-17T22:13:59.999Z');
      expect(roundDownTo1Minute(justBeforeNext).toISOString()).toBe(
        '2023-03-17T22:13:00.000Z',
      );
    });

    it('should handle different time zones correctly', () => {
      const roundDownTo1Hour = roundDownTo(1000 * 60 * 60);
      const date = new Date('2023-03-17T22:30:00.000Z');
      const result = roundDownTo1Hour(date);
      expect(result.toISOString()).toBe('2023-03-17T22:00:00.000Z');
    });

    it('should throw error when roundTo is zero', () => {
      const roundDownToZero = roundDownTo(0);
      const date = new Date('2023-03-17T22:13:30.500Z');
      expect(() => roundDownToZero(date)).toThrow(
        'roundTo must be greater than zero',
      );
    });

    it('should throw error when roundTo is negative', () => {
      const roundDownToNegative = roundDownTo(-1000);
      const date = new Date('2023-03-17T22:13:30.500Z');
      expect(() => roundDownToNegative(date)).toThrow(
        'roundTo must be greater than zero',
      );
    });
  });

  describe('roundDownToXMinutes', () => {
    it('should round down to nearest 1 minute', () => {
      const roundDownTo1Minute = roundDownToXMinutes(1);
      const date = new Date('2023-03-17T22:13:30.500Z');
      const result = roundDownTo1Minute(date);
      expect(result.toISOString()).toBe('2023-03-17T22:13:00.000Z');
    });

    it('should round down to nearest 5 minutes', () => {
      const roundDownTo5Minutes = roundDownToXMinutes(5);
      const date = new Date('2023-03-17T22:17:30.500Z');
      const result = roundDownTo5Minutes(date);
      expect(result.toISOString()).toBe('2023-03-17T22:15:00.000Z');
    });

    it('should round down to nearest 15 minutes', () => {
      const roundDownTo15Minutes = roundDownToXMinutes(15);
      const date = new Date('2023-03-17T22:22:30.500Z');
      const result = roundDownTo15Minutes(date);
      expect(result.toISOString()).toBe('2023-03-17T22:15:00.000Z');
    });

    it('should round down to nearest 30 minutes', () => {
      const roundDownTo30Minutes = roundDownToXMinutes(30);
      const date = new Date('2023-03-17T22:45:30.500Z');
      const result = roundDownTo30Minutes(date);
      expect(result.toISOString()).toBe('2023-03-17T22:30:00.000Z');
    });

    it('should round down to nearest 60 minutes (1 hour)', () => {
      const roundDownTo60Minutes = roundDownToXMinutes(60);
      const date = new Date('2023-03-17T22:45:30.500Z');
      const result = roundDownTo60Minutes(date);
      expect(result.toISOString()).toBe('2023-03-17T22:00:00.000Z');
    });

    it('should handle edge cases at minute boundaries', () => {
      const roundDownTo5Minutes = roundDownToXMinutes(5);

      // At the start of a 5-minute interval
      const startOfInterval = new Date('2023-03-17T22:15:00.000Z');
      expect(roundDownTo5Minutes(startOfInterval).toISOString()).toBe(
        '2023-03-17T22:15:00.000Z',
      );

      // Just before the next 5-minute interval
      const justBeforeNext = new Date('2023-03-17T22:19:59.999Z');
      expect(roundDownTo5Minutes(justBeforeNext).toISOString()).toBe(
        '2023-03-17T22:15:00.000Z',
      );
    });

    it('should handle different time zones correctly', () => {
      const roundDownTo5Minutes = roundDownToXMinutes(5);
      const date = new Date('2023-03-17T22:17:30.000Z');
      const result = roundDownTo5Minutes(date);
      expect(result.toISOString()).toBe('2023-03-17T22:15:00.000Z');
    });

    it('should throw error when minutes is zero', () => {
      const roundDownTo0Minutes = roundDownToXMinutes(0);
      const date = new Date('2023-03-17T22:13:30.500Z');
      expect(() => roundDownTo0Minutes(date)).toThrow(
        'roundTo must be greater than zero',
      );
    });

    it('should throw error when minutes is negative', () => {
      const roundDownToNegativeMinutes = roundDownToXMinutes(-5);
      const date = new Date('2023-03-17T22:13:30.500Z');
      expect(() => roundDownToNegativeMinutes(date)).toThrow(
        'roundTo must be greater than zero',
      );
    });
  });

  describe('escapeJsonString', () => {
    it('should escape special characters correctly', () => {
      expect(escapeJsonString('foo')).toBe('foo');
      expect(escapeJsonString("foo'")).toBe("foo'");
      expect(escapeJsonString('foo"')).toBe('foo\\"');
      expect(escapeJsonString('foo\\')).toBe('foo\\\\');
      expect(escapeJsonString('foo\n')).toBe('foo\\n');
      expect(escapeJsonString('foo\r')).toBe('foo\\r');
      expect(escapeJsonString('foo\t')).toBe('foo\\t');
      expect(escapeJsonString('foo\b')).toBe('foo\\b');
      expect(escapeJsonString('foo\f')).toBe('foo\\f');
    });

    it('should handle empty string', () => {
      expect(escapeJsonString('')).toBe('');
    });

    it('should handle strings with multiple special characters', () => {
      expect(escapeJsonString('foo\nbar\tbaz"qux')).toBe(
        'foo\\nbar\\tbaz\\"qux',
      );
    });

    it('should handle special characters at the beginning', () => {
      expect(escapeJsonString('\nfoo')).toBe('\\nfoo');
      expect(escapeJsonString('\tbar')).toBe('\\tbar');
      expect(escapeJsonString('"baz')).toBe('\\"baz');
      expect(escapeJsonString('\\qux')).toBe('\\\\qux');
    });

    it('should handle special characters in the middle', () => {
      expect(escapeJsonString('foo\nbar')).toBe('foo\\nbar');
      expect(escapeJsonString('hello\tworld')).toBe('hello\\tworld');
      expect(escapeJsonString('test"value')).toBe('test\\"value');
      expect(escapeJsonString('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('should handle special characters at the end', () => {
      expect(escapeJsonString('foo\n')).toBe('foo\\n');
      expect(escapeJsonString('bar\t')).toBe('bar\\t');
      expect(escapeJsonString('baz"')).toBe('baz\\"');
      expect(escapeJsonString('qux\\')).toBe('qux\\\\');
    });

    it('should handle mixed special characters in various positions', () => {
      expect(escapeJsonString('\nhello\tworld"test\\file')).toBe(
        '\\nhello\\tworld\\"test\\\\file',
      );
      expect(escapeJsonString('start\nmiddle\tend"')).toBe(
        'start\\nmiddle\\tend\\"',
      );
    });

    it('should handle unicode characters', () => {
      expect(escapeJsonString('foo\u0000bar')).toBe('foo\\u0000bar');
    });
  });
});
