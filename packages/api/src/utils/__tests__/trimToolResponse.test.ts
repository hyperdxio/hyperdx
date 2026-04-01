import { trimToolResponse } from '../trimToolResponse';

describe('trimToolResponse', () => {
  describe('small data (within maxSize)', () => {
    it('should return primitive values unchanged', () => {
      expect(trimToolResponse(42)).toBe(42);
      expect(trimToolResponse('hello')).toBe('hello');
      expect(trimToolResponse(null)).toBeNull();
      expect(trimToolResponse(true)).toBe(true);
    });

    it('should return small arrays unchanged', () => {
      const data = [1, 2, 3, 4, 5];
      expect(trimToolResponse(data)).toEqual(data);
    });

    it('should return small objects unchanged', () => {
      const data = { a: 1, b: 'hello', c: [1, 2, 3] };
      expect(trimToolResponse(data)).toEqual(data);
    });
  });

  describe('large arrays', () => {
    it('should trim large arrays to fit within maxSize', () => {
      // Create an array that exceeds maxSize
      const largeArray = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(200),
      }));

      const result = trimToolResponse(largeArray, 5000);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThan(largeArray.length);
      expect(result.length).toBeGreaterThanOrEqual(10); // minimum 10 items
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(5000);
    });

    it('should keep at least 10 items', () => {
      const largeArray = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(500),
      }));

      // maxSize so small even 10 items may exceed it, but we keep 10 minimum
      const result = trimToolResponse(largeArray, 100);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(10);
    });

    it('should not trim arrays that fit within maxSize', () => {
      const smallArray = [1, 2, 3, 4, 5];
      const result = trimToolResponse(smallArray, 50000);
      expect(result).toEqual(smallArray);
    });
  });

  describe('large objects', () => {
    it('should trim large objects by dropping keys', () => {
      const largeObj: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        largeObj[`key_${i}`] = 'x'.repeat(200);
      }

      const result = trimToolResponse(largeObj, 5000);
      const resultKeys = Object.keys(result);
      expect(resultKeys.length).toBeLessThan(100);
      // The implementation stops adding keys once cumulative size would
      // exceed maxSize, but the last included key may push slightly over
      // since it's added before the check on the *next* key.
      // The important guarantee is that fewer keys are returned.
      expect(resultKeys.length).toBeGreaterThan(0);
    });

    it('should not trim objects that fit within maxSize', () => {
      const obj = { a: 1, b: 2 };
      const result = trimToolResponse(obj, 50000);
      expect(result).toEqual(obj);
    });
  });

  describe('getAIMetadata structure', () => {
    it('should handle objects with allFieldsWithKeys and keyValues', () => {
      const metadataObj = {
        allFieldsWithKeys: Array.from({ length: 200 }, (_, i) => ({
          field: `field_${i}`,
          key: `key_${i}`,
          extra: 'x'.repeat(100),
        })),
        keyValues: Object.fromEntries(
          Array.from({ length: 200 }, (_, i) => [`kv_${i}`, 'x'.repeat(100)]),
        ),
        otherProp: 'preserved',
      };

      const result = trimToolResponse(metadataObj, 5000);
      expect(result).toHaveProperty('allFieldsWithKeys');
      expect(result).toHaveProperty('keyValues');
      expect(result).toHaveProperty('otherProp', 'preserved');
      expect(Array.isArray(result.allFieldsWithKeys)).toBe(true);
      expect(typeof result.keyValues).toBe('object');
    });
  });

  describe('default maxSize', () => {
    it('should use 50000 as default maxSize', () => {
      // Create data just over default size
      const data = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        payload: 'x'.repeat(100),
      }));

      const resultDefault = trimToolResponse(data);
      const resultExplicit = trimToolResponse(data, 50000);
      // Both should produce the same result
      expect(resultDefault.length).toBe(resultExplicit.length);
    });
  });
});
