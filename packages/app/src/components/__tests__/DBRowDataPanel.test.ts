import { getJSONColumnNames, selectIncludesStar } from '../DBRowDataPanel';

describe('DBRowDataPanel', () => {
  describe('getJSONColumnNames', () => {
    it('should return JSON column names', () => {
      const meta = [
        { name: 'col1', type: 'String' },
        { name: 'col2', type: 'JSON' },
        { name: 'col3', type: 'JSON(1)' },
      ];
      const result = getJSONColumnNames(meta);
      expect(result).toEqual(['col2', 'col3']);
    });
  });

  describe('selectIncludesStar', () => {
    it('returns true for a bare star', () => {
      expect(selectIncludesStar('*')).toBe(true);
    });

    it('returns true when star is the first SELECT entry', () => {
      expect(
        selectIncludesStar(`*, json_extract_scalar(payload, '$.user._id')`),
      ).toBe(true);
    });

    it('returns true when star is in the middle of the SELECT list', () => {
      expect(selectIncludesStar('expr1, *, expr2')).toBe(true);
    });

    it('returns false for a SELECT list without a top-level star', () => {
      expect(selectIncludesStar('timestamp, service')).toBe(false);
    });

    it('returns false for star that only appears inside a string literal', () => {
      expect(selectIncludesStar(`payload, '*'`)).toBe(false);
    });

    it('returns false for star inside a function call argument', () => {
      // `count(*)` is an aggregate — it does not project all source
      // columns, so the inline-expand panel must still re-fetch.
      expect(selectIncludesStar('count(*)')).toBe(false);
    });

    it('returns false for an empty SELECT', () => {
      expect(selectIncludesStar('')).toBe(false);
    });
  });
});
