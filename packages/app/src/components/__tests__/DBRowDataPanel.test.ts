import { getJSONColumnNames } from '../DBRowDataPanel';

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
});
