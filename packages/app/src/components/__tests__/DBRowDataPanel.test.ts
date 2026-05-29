import { getJSONColumnNames, getMapColumnNames } from '../DBRowDataPanel';

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

  // Regression test for the OSS #2357 conflict-resolution merge. The
  // composed result wraps `Event Attributes` in a length check from
  // origin/main AND passes `mapColumns={mapColumns}` through to the
  // DBRowJsonViewer from HEAD. Both branches are wired through
  // `getMapColumnNames`, which is the symbol the resolution
  // introduces from HEAD and that origin/main otherwise lacks. A
  // regression in either compose direction would either drop the
  // helper or change its semantics; this test pins both.
  describe('getMapColumnNames', () => {
    it('returns Map column names', () => {
      const meta = [
        { name: 'col1', type: 'String' },
        { name: 'LogAttributes', type: 'Map(String, String)' },
        { name: 'ResourceAttributes', type: 'Map(String, String)' },
        { name: 'col4', type: 'JSON' },
      ];
      expect(getMapColumnNames(meta)).toEqual([
        'LogAttributes',
        'ResourceAttributes',
      ]);
    });

    it('matches the bare Map type as well as Map(K, V)', () => {
      const meta = [
        { name: 'bareMap', type: 'Map' },
        { name: 'typedMap', type: 'Map(String, UInt8)' },
        { name: 'notMap', type: 'String' },
      ];
      expect(getMapColumnNames(meta)).toEqual(['bareMap', 'typedMap']);
    });

    it('returns an empty array when meta is undefined', () => {
      expect(getMapColumnNames(undefined)).toEqual([]);
    });

    it('does not classify JSON columns as Map columns', () => {
      const meta = [{ name: 'BodyJson', type: 'JSON' }];
      expect(getMapColumnNames(meta)).toEqual([]);
    });
  });
});
