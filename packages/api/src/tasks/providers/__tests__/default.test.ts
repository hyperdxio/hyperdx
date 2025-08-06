import mongoose from 'mongoose';

import * as config from '@/config';
import { AlertProvider, loadProvider } from '@/tasks/providers/index';

const MOCK_SAVED_SEARCH: any = {
  id: 'fake-saved-search-id',
};

describe('DefaultAlertProvider', () => {
  let provider: AlertProvider;

  beforeEach(async () => {
    provider = await loadProvider('default');
  });

  describe('buildLogSearchLink', () => {
    it('should build correct URL with basic parameters', () => {
      const result = provider.buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toBe(
        'http://app:8080/search/fake-saved-search-id?from=1679091183103&to=1679091239103&isLive=false',
      );
    });

    it('should handle different saved search IDs', () => {
      const customSavedSearch: any = {
        id: 'custom-search-123',
        _id: new mongoose.Types.ObjectId(),
        team: new mongoose.Types.ObjectId(),
        source: new mongoose.Types.ObjectId(),
        select: 'Body',
        where: 'Body: "error"',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        tags: ['test'],
      };
      const result = provider.buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: customSavedSearch,
      });

      expect(result).toContain('/search/custom-search-123?');
      expect(result).toContain('from=1679091183103');
      expect(result).toContain('to=1679091239103');
      expect(result).toContain('isLive=false');
    });

    it('should handle different date ranges', () => {
      const result = provider.buildLogSearchLink({
        startTime: new Date('2024-01-01T00:00:00.000Z'),
        endTime: new Date('2024-01-01T23:59:59.999Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('/search/fake-saved-search-id?');
      expect(result).toContain('from=1704067200000');
      expect(result).toContain('to=1704153599999');
      expect(result).toContain('isLive=false');
    });

    it('should handle very close dates', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:03.104Z'); // 1ms difference

      const result = provider.buildLogSearchLink({
        startTime,
        endTime,
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('from=1679091183103');
      expect(result).toContain('to=1679091183104');
      expect(result).toContain('isLive=false');
    });

    it('should handle same start and end time', () => {
      const sameTime = new Date('2023-03-17T22:13:03.103Z');

      const result = provider.buildLogSearchLink({
        startTime: sameTime,
        endTime: sameTime,
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('from=1679091183103');
      expect(result).toContain('to=1679091183103');
      expect(result).toContain('isLive=false');
    });

    it('should handle saved search ID with special characters', () => {
      const specialSavedSearch: any = {
        id: 'search-with-special-chars-123_456',
        _id: new mongoose.Types.ObjectId(),
        team: new mongoose.Types.ObjectId(),
        source: new mongoose.Types.ObjectId(),
        select: 'Body',
        where: 'Body: "error"',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        tags: ['test'],
      };
      const result = provider.buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: specialSavedSearch,
      });

      expect(result).toContain('/search/search-with-special-chars-123_456?');
    });

    it('should always include isLive=false parameter', () => {
      const result = provider.buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      expect(result).toContain('isLive=false');
    });

    it('should generate valid URL structure', () => {
      const result = provider.buildLogSearchLink({
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        savedSearch: MOCK_SAVED_SEARCH,
      });

      // Should be a valid URL
      expect(() => new URL(result)).not.toThrow();

      const url = new URL(result);
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('app');
      expect(url.port).toBe('8080');
      expect(url.pathname).toBe('/search/fake-saved-search-id');

      const params = url.searchParams;
      expect(params.get('from')).toBe('1679091183103');
      expect(params.get('to')).toBe('1679091239103');
      expect(params.get('isLive')).toBe('false');
    });
  });

  describe('buildChartLink', () => {
    it('should build correct URL with basic parameters', () => {
      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      // Should contain dashboard ID in path
      expect(result).toContain('/dashboards/dashboard-123?');

      // Should have from, to, and granularity parameters
      expect(result).toContain('from=');
      expect(result).toContain('to=');
      expect(result).toContain('granularity=');
    });

    it('should extend time range by 7x granularity', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:59.103Z');
      const granularity = '5m';

      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity,
      });

      const url = new URL(result);
      const fromParam = parseInt(url.searchParams.get('from') || '0');
      const toParam = parseInt(url.searchParams.get('to') || '0');

      // 5 minutes = 5 * 60 * 1000 = 300000ms
      // 7x granularity = 7 * 300000 = 2100000ms
      const expectedFrom = startTime.getTime() - 2100000;
      const expectedTo = endTime.getTime() + 2100000;

      expect(fromParam).toBe(expectedFrom);
      expect(toParam).toBe(expectedTo);
    });

    it('should handle different granularities', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:59.103Z');

      // Test 1 minute granularity
      const result1m = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity: '1m',
      });

      const url1m = new URL(result1m);
      const from1m = parseInt(url1m.searchParams.get('from') || '0');
      const to1m = parseInt(url1m.searchParams.get('to') || '0');

      // 1 minute = 1 * 60 * 1000 = 60000ms
      // 7x granularity = 7 * 60000 = 420000ms
      expect(from1m).toBe(startTime.getTime() - 420000);
      expect(to1m).toBe(endTime.getTime() + 420000);

      // Test 1 hour granularity
      const result1h = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity: '1h',
      });

      const url1h = new URL(result1h);
      const from1h = parseInt(url1h.searchParams.get('from') || '0');
      const to1h = parseInt(url1h.searchParams.get('to') || '0');

      // 1 hour = 1 * 60 * 60 * 1000 = 3600000ms
      // 7x granularity = 7 * 3600000 = 25200000ms
      expect(from1h).toBe(startTime.getTime() - 25200000);
      expect(to1h).toBe(endTime.getTime() + 25200000);
    });

    it('should handle different dashboard IDs', () => {
      const result = provider.buildChartLink({
        dashboardId: 'custom-dashboard-456',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      expect(result).toContain('/dashboards/custom-dashboard-456?');
    });

    it('should handle dashboard ID with special characters', () => {
      const result = provider.buildChartLink({
        dashboardId: 'dashboard-with-special-chars_123-456',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      expect(result).toContain(
        '/dashboards/dashboard-with-special-chars_123-456?',
      );
    });

    it('should generate valid URL structure', () => {
      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: new Date('2023-03-17T22:13:03.103Z'),
        endTime: new Date('2023-03-17T22:13:59.103Z'),
        granularity: '5m',
      });

      // Should be a valid URL
      expect(() => new URL(result)).not.toThrow();

      const url = new URL(result);
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('app');
      expect(url.port).toBe('8080');
      expect(url.pathname).toBe('/dashboards/dashboard-123');

      const params = url.searchParams;
      expect(params.has('from')).toBe(true);
      expect(params.has('to')).toBe(true);
      expect(params.has('granularity')).toBe(true);
    });

    it('should handle very close dates', () => {
      const startTime = new Date('2023-03-17T22:13:03.103Z');
      const endTime = new Date('2023-03-17T22:13:03.104Z'); // 1ms difference

      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime,
        endTime,
        granularity: '5m',
      });

      const url = new URL(result);
      const fromParam = parseInt(url.searchParams.get('from') || '0');
      const toParam = parseInt(url.searchParams.get('to') || '0');

      // Should still extend by 7x granularity even for very close dates
      const expectedFrom = startTime.getTime() - 7 * 5 * 60 * 1000;
      const expectedTo = endTime.getTime() + 7 * 5 * 60 * 1000;

      expect(fromParam).toBe(expectedFrom);
      expect(toParam).toBe(expectedTo);
    });

    it('should handle same start and end time', () => {
      const sameTime = new Date('2023-03-17T22:13:03.103Z');

      const result = provider.buildChartLink({
        dashboardId: 'dashboard-123',
        startTime: sameTime,
        endTime: sameTime,
        granularity: '5m',
      });

      const url = new URL(result);
      const fromParam = parseInt(url.searchParams.get('from') || '0');
      const toParam = parseInt(url.searchParams.get('to') || '0');

      // Should still extend by 7x granularity
      const expectedFrom = sameTime.getTime() - 7 * 5 * 60 * 1000;
      const expectedTo = sameTime.getTime() + 7 * 5 * 60 * 1000;

      expect(fromParam).toBe(expectedFrom);
      expect(toParam).toBe(expectedTo);
    });
  });
});
