import mongoose from 'mongoose';

import { createAlert } from '@/controllers/alerts';
import { createTeam } from '@/controllers/team';
import { getServer, makeTile } from '@/fixtures';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import {
  AlertProvider,
  AlertTaskType,
  loadProvider,
} from '@/tasks/providers/index';

const MOCK_SAVED_SEARCH: any = {
  id: 'fake-saved-search-id',
};

describe('DefaultAlertProvider', () => {
  let provider: AlertProvider;
  const server = getServer();

  beforeAll(async () => {
    provider = await loadProvider('default');
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('getAlertTasks', () => {
    it('should return empty array when no alerts exist', async () => {
      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should process a single saved search alert', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create connection
      const connection = await Connection.create({
        team: team._id,
        name: 'Test Connection',
        host: 'http://localhost:8123',
        username: 'test',
        password: 'test',
      });

      // Create source
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection._id,
      });

      // Create saved search
      const savedSearch = await SavedSearch.create({
        team: team._id,
        name: 'Test Search',
        select: 'message',
        where: 'level: error',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source._id,
        tags: [],
      });

      // Create alert
      const alert = await createAlert(
        team._id,
        {
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: savedSearch._id.toString(),
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(1);
      expect(result[0].conn._id.toString()).toBe(connection._id.toString());
      expect(result[0].alerts).toHaveLength(1);
      expect(result[0].alerts[0].taskType).toBe(AlertTaskType.SAVED_SEARCH);
      expect(result[0].alerts[0].alert._id.toString()).toBe(
        alert._id.toString(),
      );

      // Type narrowing for SAVED_SEARCH alert
      if (result[0].alerts[0].taskType === AlertTaskType.SAVED_SEARCH) {
        expect(result[0].alerts[0].savedSearch.name).toBe('Test Search');
      }
    });

    it('should process a single tile alert', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create connection
      const connection = await Connection.create({
        team: team._id,
        name: 'Test Connection',
        host: 'http://localhost:8123',
        username: 'test',
        password: 'test',
      });

      // Create source
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection._id,
      });

      // Create tile with source
      const tile = makeTile({ id: 'test-tile-123' });
      tile.config.source = source._id.toString();

      // Create dashboard
      const dashboard = await Dashboard.create({
        team: team._id,
        name: 'Test Dashboard',
        tiles: [tile],
      });

      // Create alert
      const alert = await createAlert(
        team._id,
        {
          source: AlertSource.TILE,
          dashboardId: dashboard._id.toString(),
          tileId: tile.id,
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(1);
      expect(result[0].conn._id.toString()).toBe(connection._id.toString());
      expect(result[0].alerts).toHaveLength(1);
      expect(result[0].alerts[0].taskType).toBe(AlertTaskType.TILE);
      expect(result[0].alerts[0].alert._id.toString()).toBe(
        alert._id.toString(),
      );

      // Type narrowing for TILE alert
      if (result[0].alerts[0].taskType === AlertTaskType.TILE) {
        expect(result[0].alerts[0].tile.id).toBe(tile.id);
        expect(result[0].alerts[0].dashboard.name).toBe('Test Dashboard');
      }
    });

    it('should skip alerts with missing saved search', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create alert directly in database with non-existent saved search
      // This simulates an alert that exists but references a deleted saved search
      await Alert.create({
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: new mongoose.Types.ObjectId(), // Non-existent ID
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should skip alerts with no source field', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create alert directly without source
      await Alert.create({
        team: team._id,
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
        // Missing source field
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should group multiple alerts with the same connection', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create single connection
      const connection = await Connection.create({
        team: team._id,
        name: 'Shared Connection',
        host: 'http://localhost:8123',
        username: 'test',
        password: 'test',
      });

      // Create source
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection._id,
      });

      // Create saved search and alert
      const savedSearch = await SavedSearch.create({
        team: team._id,
        name: 'Test Search',
        select: 'message',
        where: 'level: error',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source._id,
        tags: [],
      });

      const savedSearchAlert = await createAlert(
        team._id,
        {
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: savedSearch._id.toString(),
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      // Create tile and alert
      const tile = makeTile({ id: 'test-tile-123' });
      tile.config.source = source._id.toString();

      const dashboard = await Dashboard.create({
        team: team._id,
        name: 'Test Dashboard',
        tiles: [tile],
      });

      const tileAlert = await createAlert(
        team._id,
        {
          source: AlertSource.TILE,
          dashboardId: dashboard._id.toString(),
          tileId: tile.id,
          threshold: 15,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '15m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(1); // Should group into one task
      expect(result[0].conn._id.toString()).toBe(connection._id.toString());
      expect(result[0].alerts).toHaveLength(2); // Both alerts should be in the same task

      const alertIds = result[0].alerts.map(a => a.alert._id.toString()).sort();
      expect(alertIds).toEqual(
        [savedSearchAlert._id.toString(), tileAlert._id.toString()].sort(),
      );
    });

    it('should create separate tasks for different connections', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create two different connections
      const connection1 = await Connection.create({
        team: team._id,
        name: 'Connection 1',
        host: 'http://localhost:8123',
        username: 'test1',
        password: 'test1',
      });

      const connection2 = await Connection.create({
        team: team._id,
        name: 'Connection 2',
        host: 'http://localhost:8124',
        username: 'test2',
        password: 'test2',
      });

      // Create sources for each connection
      const source1 = await Source.create({
        team: team._id,
        name: 'Source 1',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection1._id,
      });

      const source2 = await Source.create({
        team: team._id,
        name: 'Source 2',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: connection2._id,
      });

      // Create saved searches and alerts
      const savedSearch1 = await SavedSearch.create({
        team: team._id,
        name: 'Search 1',
        select: 'message',
        where: 'level: error',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source1._id,
        tags: [],
      });

      const savedSearch2 = await SavedSearch.create({
        team: team._id,
        name: 'Search 2',
        select: 'message',
        where: 'level: warn',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source2._id,
        tags: [],
      });

      await createAlert(
        team._id,
        {
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: savedSearch1._id.toString(),
          threshold: 10,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '5m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      await createAlert(
        team._id,
        {
          source: AlertSource.SAVED_SEARCH,
          savedSearchId: savedSearch2._id.toString(),
          threshold: 15,
          thresholdType: AlertThresholdType.ABOVE,
          interval: '15m',
          channel: {
            type: 'webhook',
            webhookId: new mongoose.Types.ObjectId().toString(),
          },
        },
        new mongoose.Types.ObjectId(),
      );

      const result = await provider.getAlertTasks();

      expect(result).toHaveLength(2); // Should create separate tasks

      const connectionIds = result.map(task => task.conn._id.toString()).sort();
      expect(connectionIds).toEqual(
        [connection1._id.toString(), connection2._id.toString()].sort(),
      );

      // Each task should have one alert
      expect(result[0].alerts).toHaveLength(1);
      expect(result[1].alerts).toHaveLength(1);
    });

    it('should skip alerts with missing dashboard', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create alert directly in database with non-existent dashboard
      // This simulates an alert that exists but references a deleted dashboard
      await Alert.create({
        team: team._id,
        source: AlertSource.TILE,
        dashboard: new mongoose.Types.ObjectId(), // Non-existent ID
        tileId: 'some-tile-id',
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should skip alerts with missing tile in dashboard', async () => {
      const team = await createTeam({ name: 'Test Team' });

      const dashboard = await Dashboard.create({
        team: team._id,
        name: 'Test Dashboard',
        tiles: [makeTile({ id: 'existing-tile' })],
      });

      // Create alert directly in database with non-existent tile ID
      await Alert.create({
        team: team._id,
        source: AlertSource.TILE,
        dashboard: dashboard._id,
        tileId: 'non-existent-tile', // Non-existent tile ID
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should skip alerts with missing source', async () => {
      const team = await createTeam({ name: 'Test Team' });

      const tile = makeTile({ id: 'test-tile' });
      tile.config.source = new mongoose.Types.ObjectId().toString(); // Non-existent source

      const dashboard = await Dashboard.create({
        team: team._id,
        name: 'Test Dashboard',
        tiles: [tile],
      });

      // Create alert directly in database
      await Alert.create({
        team: team._id,
        source: AlertSource.TILE,
        dashboard: dashboard._id,
        tileId: tile.id,
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should skip alerts with missing connection', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create source with non-existent connection
      const source = await Source.create({
        team: team._id,
        name: 'Test Source',
        kind: 'log',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        timestampValueExpression: 'timestamp',
        connection: new mongoose.Types.ObjectId(), // Non-existent connection
      });

      const savedSearch = await SavedSearch.create({
        team: team._id,
        name: 'Test Search',
        select: 'message',
        where: 'level: error',
        whereLanguage: 'lucene',
        orderBy: 'timestamp',
        source: source._id,
        tags: [],
      });

      // Create alert directly in database
      await Alert.create({
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: savedSearch._id,
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });

    it('should skip alerts with unsupported source type', async () => {
      const team = await createTeam({ name: 'Test Team' });

      // Create alert with invalid source
      await Alert.create({
        team: team._id,
        source: 'UNSUPPORTED_SOURCE' as any,
        threshold: 10,
        thresholdType: AlertThresholdType.ABOVE,
        interval: '5m',
        channel: {
          type: 'webhook',
          webhookId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await provider.getAlertTasks();
      expect(result).toEqual([]);
    });
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
