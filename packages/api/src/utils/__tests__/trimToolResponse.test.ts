import { trimToolResponse } from '@/utils/trimToolResponse';

describe('trimToolResponse', () => {
  describe('return shape', () => {
    it('should return { data, isTrimmed } object', () => {
      const result = trimToolResponse(42);
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('isTrimmed');
    });

    it('should set isTrimmed to false when data fits', () => {
      expect(trimToolResponse(42).isTrimmed).toBe(false);
      expect(trimToolResponse('hello').isTrimmed).toBe(false);
      expect(trimToolResponse([1, 2, 3]).isTrimmed).toBe(false);
    });

    it('should set isTrimmed to true when data is trimmed', () => {
      const largeArray = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(200),
      }));
      expect(trimToolResponse(largeArray, 5000).isTrimmed).toBe(true);
    });
  });

  describe('small data (within maxSize)', () => {
    it('should return primitive values unchanged', () => {
      expect(trimToolResponse(42).data).toBe(42);
      expect(trimToolResponse('hello').data).toBe('hello');
      expect(trimToolResponse(null).data).toBeNull();
      expect(trimToolResponse(true).data).toBe(true);
    });

    it('should return small arrays unchanged', () => {
      const data = [1, 2, 3, 4, 5];
      expect(trimToolResponse(data).data).toEqual(data);
    });

    it('should return small objects unchanged', () => {
      const data = { a: 1, b: 'hello', c: [1, 2, 3] };
      expect(trimToolResponse(data).data).toEqual(data);
    });
  });

  describe('large arrays', () => {
    it('should trim large arrays to fit within maxSize', () => {
      const largeArray = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(200),
      }));

      const { data: result, isTrimmed } = trimToolResponse(largeArray, 5000);
      expect(isTrimmed).toBe(true);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThan(largeArray.length);
      expect(result.length).toBeGreaterThanOrEqual(10);
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(5000);
    });

    it('should keep at least 10 items', () => {
      const largeArray = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(500),
      }));

      const { data: result } = trimToolResponse(largeArray, 100);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(10);
    });

    it('should not trim arrays that fit within maxSize', () => {
      const smallArray = [1, 2, 3, 4, 5];
      const { data: result, isTrimmed } = trimToolResponse(smallArray, 50000);
      expect(isTrimmed).toBe(false);
      expect(result).toEqual(smallArray);
    });
  });

  describe('large objects', () => {
    it('should trim large objects to fit within maxSize', () => {
      const largeObj: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        largeObj[`key_${i}`] = 'x'.repeat(200);
      }

      const { data: result, isTrimmed } = trimToolResponse(largeObj, 5000);
      expect(isTrimmed).toBe(true);
      expect(JSON.stringify(result).length).toBeLessThan(
        JSON.stringify(largeObj).length,
      );
      expect(
        Object.keys(result).filter(k => k !== '__hdx_trimmed'),
      ).toHaveLength(100);
      expect(result.__hdx_trimmed).toBe(true);
    });

    it('should not trim objects that fit within maxSize', () => {
      const obj = { a: 1, b: 2 };
      const { data: result, isTrimmed } = trimToolResponse(obj, 50000);
      expect(isTrimmed).toBe(false);
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

      const { data: result } = trimToolResponse(metadataObj, 5000);
      expect(result).toHaveProperty('allFieldsWithKeys');
      expect(result).toHaveProperty('keyValues');
      expect(result).toHaveProperty('otherProp', 'preserved');
      expect(Array.isArray(result.allFieldsWithKeys)).toBe(true);
      expect(typeof result.keyValues).toBe('object');
    });
  });

  describe('default maxSize', () => {
    it('should use 50000 as default maxSize', () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        payload: 'x'.repeat(100),
      }));

      const resultDefault = trimToolResponse(data);
      const resultExplicit = trimToolResponse(data, 50000);
      expect(resultDefault.data.length).toBe(resultExplicit.data.length);
    });
  });
});
