import { splitAndTrimCSV, splitAndTrimWithBracket } from '../utils';

describe('utils', () => {
  describe('splitAndTrimCSV', () => {
    it('should split a comma-separated string and trim whitespace', () => {
      expect(splitAndTrimCSV('a, b, c')).toEqual(['a', 'b', 'c']);
    });

    it('should handle strings with no spaces', () => {
      expect(splitAndTrimCSV('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('should filter out empty values', () => {
      expect(splitAndTrimCSV('a,b,,c,')).toEqual(['a', 'b', 'c']);
    });

    it('should handle strings with extra whitespace', () => {
      expect(splitAndTrimCSV('  a  ,  b  ,  c  ')).toEqual(['a', 'b', 'c']);
    });

    it('should return an empty array for an empty string', () => {
      expect(splitAndTrimCSV('')).toEqual([]);
    });

    it('should handle a string with only commas and whitespace', () => {
      expect(splitAndTrimCSV(',,  ,,')).toEqual([]);
    });
  });

  describe('splitAndTrimWithBracket', () => {
    it('should split a simple comma-separated string', () => {
      const input = 'column1, column2, column3';
      const expected = ['column1', 'column2', 'column3'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle function calls with commas in parameters', () => {
      const input =
        "Timestamp, ServiceName, JSONExtractString(Body, 'c'), JSONExtractString(Body, 'msg')";
      const expected = [
        'Timestamp',
        'ServiceName',
        "JSONExtractString(Body, 'c')",
        "JSONExtractString(Body, 'msg')",
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle nested function calls', () => {
      const input = 'col1, func1(a, b), col2, func2(c, func3(d, e)), col3';
      const expected = [
        'col1',
        'func1(a, b)',
        'col2',
        'func2(c, func3(d, e))',
        'col3',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle square brackets in column expressions', () => {
      const input = "col1, array[1, 2, 3], jsonb_path_query(data, '$[*]')";
      const expected = [
        'col1',
        'array[1, 2, 3]',
        "jsonb_path_query(data, '$[*]')",
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle mixed parentheses and square brackets', () => {
      const input = "col1, func(array[1, 2], obj['key']), col2['nested'][0]";
      const expected = [
        'col1',
        "func(array[1, 2], obj['key'])",
        "col2['nested'][0]",
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should trim whitespace from resulting columns', () => {
      const input = '  col1  ,   func(a, b)  ,  col2  ';
      const expected = ['col1', 'func(a, b)', 'col2'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle empty input', () => {
      expect(splitAndTrimWithBracket('')).toEqual([]);
    });

    it('should handle input with only spaces', () => {
      expect(splitAndTrimWithBracket('   ')).toEqual([]);
    });

    it('should skip empty elements', () => {
      const input = 'col1,,col2, ,col3';
      const expected = ['col1', 'col2', 'col3'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle quoted strings with commas', () => {
      const input = "col1, concat('Hello, World!'), col2";
      const expected = ['col1', "concat('Hello, World!')", 'col2'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle double quoted strings with commas', () => {
      const input = 'col1, "quoted, string", col3';
      const expected = ['col1', '"quoted, string"', 'col3'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle single quoted strings with commas', () => {
      const input = `col1, 'quoted, string', col3`;
      const expected = ['col1', `'quoted, string'`, 'col3'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle mixed quotes with commas', () => {
      const input = `col1, "double, quoted", col2, 'single, quoted', col3`;
      const expected = [
        'col1',
        `"double, quoted"`,
        'col2',
        `'single, quoted'`,
        'col3',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle quotes inside function calls', () => {
      const input = 'col1, func("text with , comma", \'another, text\'), col2';
      const expected = [
        'col1',
        'func("text with , comma", \'another, text\')',
        'col2',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle brackets inside quoted strings', () => {
      const input =
        'col1, "string with (brackets, inside)", col2, \'string with [brackets, inside]\', col3';
      const expected = [
        'col1',
        '"string with (brackets, inside)"',
        'col2',
        "'string with [brackets, inside]'",
        'col3',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle real-world SQL column list example', () => {
      const input =
        "Timestamp, ServiceName, JSONExtractString(Body, 'c'), JSONExtractString(Body, 'msg'), Timestamp, \"foo, bar\"";
      const expected = [
        'Timestamp',
        'ServiceName',
        "JSONExtractString(Body, 'c')",
        "JSONExtractString(Body, 'msg')",
        'Timestamp',
        '"foo, bar"',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });
  });
});
