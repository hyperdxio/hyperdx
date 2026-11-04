import { shortenString, trimToolResponse } from '@/utils/trimToolResponse';

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

  describe('shortening instead of replacing', () => {
    it('shortens an oversized string with a "…(+N chars)" suffix', () => {
      expect(shortenString('a'.repeat(10), 4)).toBe('aaaa…(+6 chars)');
      expect(shortenString('a'.repeat(8000), 1000)).toBe(
        `${'a'.repeat(1000)}…(+7,000 chars)`,
      );
      expect(shortenString('short', 10)).toBe('short');
    });

    it('shortens long string values in the fallback and says so in notes', () => {
      const data = { big: 'x'.repeat(5000), small: 'ok' };
      const { data: result, isTrimmed, notes } = trimToolResponse(data, 2000);
      expect(isTrimmed).toBe(true);
      expect(typeof result.big).toBe('string');
      expect(result.big).toMatch(/^x+…\(\+[\d,]+ chars\)$/);
      expect(result.small).toBe('ok');
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
      expect(notes[0]).toMatch(
        /^Response trimmed from 5,0\d\d to [\d,]+ chars \(limit 2,000\)\.$/,
      );
      expect(notes.some(n => /long value\(s\) shortened/.test(n))).toBe(true);
    });

    it('notes array cuts with their path', () => {
      const data = { rows: Array.from({ length: 100 }, () => 'y'.repeat(100)) };
      const { notes } = trimToolResponse(data, 3000);
      expect(notes).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^rows: cut from 100 to \d+ items$/),
        ]),
      );
    });

    it('returns no notes when nothing is trimmed', () => {
      expect(trimToolResponse({ a: 1 }).notes).toEqual([]);
    });
  });

  describe('ordered reductions', () => {
    const big = (n: number) => 'z'.repeat(n);
    const shape = () => ({
      patterns: Array.from({ length: 4 }, (_, i) => ({
        rank: i + 1,
        pattern: big(3000),
        trend: Array.from({ length: 50 }, (_, t) => ({ ts: t, count: t })),
        samples: Array.from({ length: 5 }, () => big(1000)),
      })),
    });

    it('applies each kind to every match', () => {
      const { data, notes } = trimToolResponse(shape(), 10, {
        reductions: [
          { path: 'patterns[].samples', keep: 2 },
          { path: 'patterns[].samples[]', maxChars: 10 },
          { path: 'patterns[].pattern', maxChars: 20 },
          { path: 'patterns[].trend', drop: true },
        ],
      });
      for (const p of data.patterns) {
        expect(p).not.toHaveProperty('trend');
        expect(p.samples.length).toBeLessThanOrEqual(2);
      }
      expect(notes).toEqual(
        expect.arrayContaining([
          'patterns[].samples: kept the first 2 (12 elements removed from 4 items)',
          'patterns[].samples[]: 8 value(s) shortened to 10 chars (7,920 chars removed)',
          'patterns[].pattern: 4 value(s) shortened to 20 chars (11,920 chars removed)',
          'patterns[].trend: removed (4 items)',
        ]),
      );
    });

    it('stops as soon as the whole response fits', () => {
      const input = shape();
      const after1 = JSON.stringify({
        patterns: input.patterns.map(p => ({
          ...p,
          samples: p.samples.slice(0, 1),
        })),
      }).length;
      const { data, notes } = trimToolResponse(input, after1, {
        reductions: [
          { path: 'patterns[].samples', keep: 1 },
          { path: 'patterns[].pattern', maxChars: 20 },
        ],
      });
      expect(data.patterns[0].pattern).toHaveLength(3000); // second step not needed
      expect(data.patterns[0].samples).toHaveLength(1);
      expect(notes).toHaveLength(2); // size note + the one reduction
    });

    it('returns the input unchanged when it fits', () => {
      const input = shape();
      const result = trimToolResponse(input, 1_000_000, {
        reductions: [{ path: 'patterns[].trend', drop: true }],
      });
      expect(result.isTrimmed).toBe(false);
      expect(result.data).toBe(input);
    });

    it('does not mutate the input', () => {
      const input = shape();
      const before = JSON.stringify(input);
      trimToolResponse(input, 10, {
        reductions: [{ path: 'patterns[].trend', drop: true }],
      });
      expect(JSON.stringify(input)).toBe(before);
    });

    it('falls back to the generic trim when reductions are not enough', () => {
      const { data, notes } = trimToolResponse(shape(), 2000, {
        reductions: [{ path: 'patterns[].trend', drop: true }],
      });
      expect(JSON.stringify(data).length).toBeLessThanOrEqual(2000);
      expect(notes[1]).toBe('patterns[].trend: removed (4 items)');
      expect(notes.length).toBeGreaterThan(2);
    });

    it('keeps all 30 event patterns instead of replacing the long ones (topN honoured)', () => {
      const stack = (n: number) =>
        `java.lang.NullPointerException: case ${n}\n` +
        Array.from(
          { length: 90 },
          (_, i) =>
            `\tat com.example.svc.Layer${i}.call(Layer${i}.java:${i + 10})`,
        ).join('\n');
      const pattern = (rank: number, text: string) => ({
        rank,
        pattern: text,
        whereSnippet: `Body:"${text.slice(0, 200)}"`,
        trend: Array.from({ length: 24 }, (_, t) => ({ ts: t, count: rank })),
        samples: Array.from({ length: 5 }, () => text),
      });
      const output = {
        summary: { patternsReturned: 30 },
        patterns: [
          ...[0, 1, 2].map(i => pattern(i + 1, stack(i))),
          ...Array.from({ length: 27 }, (_, i) =>
            pattern(i + 4, `Short INFO line ${i} took <*> ms`),
          ),
        ],
      };
      const { data } = trimToolResponse(output, 50000, {
        reductions: [
          { path: 'patterns[].samples', keep: 3 },
          { path: 'patterns[].samples', keep: 1 },
          { path: 'patterns[].samples[]', maxChars: 2000 },
          { path: 'patterns[].pattern', maxChars: 2000 },
          { path: 'patterns[].trend', drop: true },
        ],
      });
      expect(data.patterns).toHaveLength(30);
      expect(data.patterns.every(p => p.samples.length >= 1)).toBe(true);
      expect(data.patterns[0].pattern).toMatch(
        /^java\.lang\.NullPointerException/,
      );
      expect(JSON.stringify(data)).not.toContain('__hdx_trimmed');
      expect(JSON.stringify(data).length).toBeLessThanOrEqual(50000);
    });
  });
});
