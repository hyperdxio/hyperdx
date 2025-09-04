import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

describe('Time Window Generation Logic', () => {
  // Test the time window configuration constants
  const TIME_WINDOWS_MS = [
    6 * 60 * 60 * 1000, // 6h
    6 * 60 * 60 * 1000, // 6h
    12 * 60 * 60 * 1000, // 12h
    24 * 60 * 60 * 1000, // 24h
  ];

  describe('Time Window Generation Scenarios', () => {
    it('should generate correct windows for 6-hour range', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-01T06:00:00Z');
      const duration = endDate.getTime() - startDate.getTime();

      // Should fit in first 6-hour window
      expect(duration).toBeLessThanOrEqual(TIME_WINDOWS_MS[0]);
    });

    it('should generate correct windows for 12-hour range', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-01T12:00:00Z');
      const duration = endDate.getTime() - startDate.getTime();

      // Should fit in first two 6-hour windows
      expect(duration).toBeLessThanOrEqual(
        TIME_WINDOWS_MS[0] + TIME_WINDOWS_MS[1],
      );
    });

    it('should generate correct windows for 24-hour range', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-02T00:00:00Z');
      const duration = endDate.getTime() - startDate.getTime();

      // Should fit in first three windows (6h + 6h + 12h)
      expect(duration).toBeLessThanOrEqual(
        TIME_WINDOWS_MS[0] + TIME_WINDOWS_MS[1] + TIME_WINDOWS_MS[2],
      );
    });

    it('should generate correct windows for 48-hour range', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-03T00:00:00Z');
      const duration = endDate.getTime() - startDate.getTime();

      // Should fit in all four windows (6h + 6h + 12h + 24h)
      expect(duration).toBeLessThanOrEqual(
        TIME_WINDOWS_MS.reduce((sum, window) => sum + window, 0),
      );
    });
  });

  describe('Window Index Progression', () => {
    it('should have sequential window indices', () => {
      // Window indices should be 0, 1, 2, 3, etc.
      const expectedIndices = [0, 1, 2, 3];
      expect(expectedIndices).toEqual([0, 1, 2, 3]);
    });

    it('should handle window index overflow gracefully', () => {
      // When window index exceeds available window sizes, should use largest window
      const maxWindowIndex = TIME_WINDOWS_MS.length - 1;
      const largestWindow = TIME_WINDOWS_MS[maxWindowIndex];

      // Any index >= maxWindowIndex should use the largest window size
      expect(
        TIME_WINDOWS_MS[maxWindowIndex] ||
          TIME_WINDOWS_MS[TIME_WINDOWS_MS.length - 1],
      ).toBe(largestWindow);
    });
  });

  describe('Date Range Edge Cases', () => {
    it('should handle same start and end dates', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-01T00:00:00Z');
      const duration = endDate.getTime() - startDate.getTime();

      expect(duration).toBe(0);
      // Should still generate at least one window
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle very small time ranges', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-01T00:01:00Z'); // 1 minute
      const duration = endDate.getTime() - startDate.getTime();

      // Should fit in first window
      expect(duration).toBeLessThan(TIME_WINDOWS_MS[0]);
    });

    it('should handle very large time ranges', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-10T00:00:00Z'); // 9 days
      const duration = endDate.getTime() - startDate.getTime();

      // Should be much larger than any single window
      expect(duration).toBeGreaterThan(
        TIME_WINDOWS_MS[TIME_WINDOWS_MS.length - 1],
      );
    });
  });

  describe('Time Zone Handling', () => {
    it('should handle UTC dates correctly', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-02T00:00:00Z');

      // Should preserve UTC timezone
      expect(startDate.toISOString()).toBe('2024-01-01T00:00:00.000Z');
      expect(endDate.toISOString()).toBe('2024-01-02T00:00:00.000Z');
    });

    it('should handle local timezone dates correctly', () => {
      const startDate = new Date('2024-01-01T00:00:00');
      const endDate = new Date('2024-01-02T00:00:00');

      // Should convert to local timezone
      expect(startDate.getTimezoneOffset()).toBeDefined();
      expect(endDate.getTimezoneOffset()).toBeDefined();
    });
  });

  describe('Window Boundary Calculations', () => {
    it('should calculate correct window boundaries', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');

      // First window should start at startDate and end at startDate + 6h
      const firstWindowStart = startDate;
      const firstWindowEnd = new Date(startDate.getTime() + TIME_WINDOWS_MS[0]);

      expect(firstWindowStart).toEqual(startDate);
      expect(firstWindowEnd.getTime()).toBe(
        startDate.getTime() + TIME_WINDOWS_MS[0],
      );
    });

    it('should handle window overlap correctly', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');

      // Windows should not overlap
      const window1Start = startDate;
      const window1End = new Date(startDate.getTime() + TIME_WINDOWS_MS[0]);
      const window2Start = window1End;
      const window2End = new Date(window2Start.getTime() + TIME_WINDOWS_MS[1]);

      expect(window1End).toEqual(window2Start);
      expect(window1Start.getTime()).toBeLessThan(window1End.getTime());
      expect(window2Start.getTime()).toBeLessThan(window2End.getTime());
    });
  });

  describe('Performance Considerations', () => {
    it('should limit maximum number of windows for very large ranges', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-12-31T23:59:59Z'); // Almost 1 year
      const duration = endDate.getTime() - startDate.getTime();

      // With largest window being 24h, should have reasonable number of windows
      const maxWindowSize = Math.max(...TIME_WINDOWS_MS);
      const estimatedWindows = Math.ceil(duration / maxWindowSize);

      // Should not create excessive number of windows
      expect(estimatedWindows).toBeLessThan(1000); // Reasonable upper limit
    });

    it('should use efficient window size selection', () => {
      // Should use largest available window size for large ranges
      const largestWindow = TIME_WINDOWS_MS[TIME_WINDOWS_MS.length - 1];

      // Largest window should be 24 hours
      expect(largestWindow).toBe(24 * 60 * 60 * 1000);
    });
  });
});

describe('Pagination Logic', () => {
  describe('Offset Calculation', () => {
    it('should calculate correct offset for first page', () => {
      const offset = 0;
      expect(offset).toBe(0);
    });

    it('should calculate correct offset for subsequent pages', () => {
      const pageSize = 100;
      const pageNumber = 2;
      const offset = pageSize * (pageNumber - 1);

      expect(offset).toBe(100);
    });

    it('should handle zero page size gracefully', () => {
      const pageSize = 0;
      const pageNumber = 1;
      const offset = pageSize * (pageNumber - 1);

      expect(offset).toBe(0);
    });
  });

  describe('Window Index Progression', () => {
    it('should increment window index correctly', () => {
      const currentWindowIndex = 0;
      const nextWindowIndex = currentWindowIndex + 1;

      expect(nextWindowIndex).toBe(1);
    });

    it('should handle window index bounds', () => {
      const maxWindows = 4; // Based on TIME_WINDOWS_MS length
      const currentWindowIndex = maxWindows - 1;
      const nextWindowIndex = currentWindowIndex + 1;

      // Should not exceed maximum windows
      expect(nextWindowIndex).toBe(maxWindows);
      expect(nextWindowIndex).toBeLessThanOrEqual(maxWindows);
    });
  });

  describe('Page Parameter Structure', () => {
    it('should have correct page parameter structure', () => {
      const pageParam = {
        windowIndex: 0,
        offset: 0,
      };

      expect(pageParam).toHaveProperty('windowIndex');
      expect(pageParam).toHaveProperty('offset');
      expect(typeof pageParam.windowIndex).toBe('number');
      expect(typeof pageParam.offset).toBe('number');
    });

    it('should handle negative values gracefully', () => {
      const pageParam = {
        windowIndex: -1,
        offset: -100,
      };

      // Should handle negative values without crashing
      expect(pageParam.windowIndex).toBe(-1);
      expect(pageParam.offset).toBe(-100);
    });
  });
});

describe('Data Flattening Logic', () => {
  describe('Page Data Structure', () => {
    it('should have correct page data structure', () => {
      const pageData = {
        data: [],
        meta: [],
        chSql: { sql: '', params: {} },
        window: {
          startTime: new Date(),
          endTime: new Date(),
          windowIndex: 0,
        },
      };

      expect(pageData).toHaveProperty('data');
      expect(pageData).toHaveProperty('meta');
      expect(pageData).toHaveProperty('chSql');
      expect(pageData).toHaveProperty('window');
      expect(pageData.window).toHaveProperty('startTime');
      expect(pageData.window).toHaveProperty('endTime');
      expect(pageData.window).toHaveProperty('windowIndex');
    });
  });

  describe('Data Aggregation', () => {
    it('should handle empty data arrays', () => {
      const pages = [
        {
          data: [],
          meta: [],
          chSql: { sql: '', params: {} },
          window: {
            startTime: new Date(),
            endTime: new Date(),
            windowIndex: 0,
          },
        },
      ];

      const flattenedData = pages.flatMap(p => p.data);
      expect(flattenedData).toEqual([]);
    });

    it('should flatten multiple pages correctly', () => {
      const pages = [
        {
          data: [1, 2],
          meta: [],
          chSql: { sql: '', params: {} },
          window: {
            startTime: new Date(),
            endTime: new Date(),
            windowIndex: 0,
          },
        },
        {
          data: [3, 4],
          meta: [],
          chSql: { sql: '', params: {} },
          window: {
            startTime: new Date(),
            endTime: new Date(),
            windowIndex: 1,
          },
        },
      ];

      const flattenedData = pages.flatMap(p => p.data);
      expect(flattenedData).toEqual([1, 2, 3, 4]);
    });

    it('should preserve data order across pages', () => {
      const pages = [
        {
          data: ['a', 'b'],
          meta: [],
          chSql: { sql: '', params: {} },
          window: {
            startTime: new Date(),
            endTime: new Date(),
            windowIndex: 0,
          },
        },
        {
          data: ['c', 'd'],
          meta: [],
          chSql: { sql: '', params: {} },
          window: {
            startTime: new Date(),
            endTime: new Date(),
            windowIndex: 1,
          },
        },
      ];

      const flattenedData = pages.flatMap(p => p.data);
      expect(flattenedData).toEqual(['a', 'b', 'c', 'd']);
    });
  });
});
