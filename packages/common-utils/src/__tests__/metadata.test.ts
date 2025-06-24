import { ClickhouseClient } from '../clickhouse';
import { Metadata, MetadataCache } from '../metadata';
import * as renderChartConfigModule from '../renderChartConfig';
import { ChartConfigWithDateRange } from '../types';

// Mock ClickhouseClient
const mockClickhouseClient = {
  query: jest.fn(),
} as unknown as ClickhouseClient;

const mockCache = {
  get: jest.fn(),
  getOrFetch: jest.fn(),
  set: jest.fn(),
} as any;

jest.mock('../renderChartConfig', () => ({
  renderChartConfig: jest
    .fn()
    .mockResolvedValue({ sql: 'SELECT 1', params: {} }),
}));

describe('MetadataCache', () => {
  let metadataCache: MetadataCache;

  beforeEach(() => {
    metadataCache = new MetadataCache();
    jest.clearAllMocks();
  });

  describe('getOrFetch', () => {
    it('should return cached value if it exists', async () => {
      const key = 'test-key';
      const value = { data: 'test-data' };

      // Set a value in the cache
      metadataCache.set(key, value);

      // Mock query function that should not be called
      const queryFn = jest.fn().mockResolvedValue('new-value');

      const result = await metadataCache.getOrFetch(key, queryFn);

      expect(result).toBe(value);
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('should call query function and store result if no cached value exists', async () => {
      const key = 'test-key';
      const expectedValue = { data: 'fetched-data' };
      const queryFn = jest.fn().mockResolvedValue(expectedValue);

      const result = await metadataCache.getOrFetch(key, queryFn);

      expect(result).toBe(expectedValue);
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(metadataCache.get(key)).toBe(expectedValue);
    });

    it('should reuse pending promises for the same key', async () => {
      const key = 'test-key';
      let resolvePromise: (value: any) => void;

      // Create a promise that we can control when it resolves
      const pendingPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      const queryFn = jest.fn().mockReturnValue(pendingPromise);

      // Start two requests for the same key
      const promise1 = metadataCache.getOrFetch(key, queryFn);
      const promise2 = metadataCache.getOrFetch(key, queryFn);

      // The query function should only be called once
      expect(queryFn).toHaveBeenCalledTimes(1);

      // Now resolve the promise
      resolvePromise!({ data: 'result' });

      // Both promises should resolve to the same value
      const result1 = await promise1;
      const result2 = await promise2;

      expect(result1).toEqual({ data: 'result' });
      expect(result2).toEqual({ data: 'result' });
      expect(result1).toBe(result2); // Should be the same object reference
    });

    it('should clean up pending promise after resolution', async () => {
      const key = 'test-key';
      const value = { data: 'test-data' };
      const queryFn = jest.fn().mockResolvedValue(value);

      // Access the private pendingQueries map using any type assertion
      const pendingQueriesMap = (metadataCache as any).pendingQueries;

      await metadataCache.getOrFetch(key, queryFn);

      // After resolution, the pending query should be removed from the map
      expect(pendingQueriesMap.has(key)).toBe(false);
    });

    it('should clean up pending promise after rejection', async () => {
      const key = 'test-key';
      const error = new Error('Query failed');
      const queryFn = jest.fn().mockRejectedValue(error);

      // Access the private pendingQueries map using any type assertion
      const pendingQueriesMap = (metadataCache as any).pendingQueries;

      try {
        await metadataCache.getOrFetch(key, queryFn);
      } catch (e) {
        // Expected to throw
      }

      // After rejection, the pending query should be removed from the map
      expect(pendingQueriesMap.has(key)).toBe(false);
      // And no value should be stored in the cache
      expect(metadataCache.get(key)).toBeUndefined();
    });
  });
});

describe('Metadata', () => {
  let metadata: Metadata;

  beforeEach(() => {
    metadata = new Metadata(mockClickhouseClient, mockCache);
    jest.clearAllMocks();
  });

  describe('getTableMetadata', () => {
    beforeEach(() => {
      mockCache.getOrFetch.mockImplementation((key, queryFn) => queryFn());
    });

    it('should normalize partition_key format by removing parentheses', async () => {
      const mockTableMetadata = {
        database: 'test_db',
        name: 'test_table',
        partition_key: '(toYYYYMM(timestamp), user_id)',
        sorting_key: 'column2',
        primary_key: 'column3',
      };

      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [mockTableMetadata],
        }),
      });

      const result = await metadata.getTableMetadata({
        databaseName: 'test_db',
        tableName: 'test_table',
        connectionId: 'test_connection',
      });

      expect(result.partition_key).toEqual('toYYYYMM(timestamp), user_id');
    });

    it('should not modify partition_key if it does not have parentheses', async () => {
      const mockTableMetadata = {
        database: 'test_db',
        name: 'test_table',
        partition_key: 'column1',
        sorting_key: 'column2',
        primary_key: 'column3',
      };

      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [mockTableMetadata],
        }),
      });

      const result = await metadata.getTableMetadata({
        databaseName: 'test_db',
        tableName: 'test_table',
        connectionId: 'test_connection',
      });

      expect(result.partition_key).toEqual('column1');
    });

    it('should use the cache when retrieving table metadata', async () => {
      // Setup the mock implementation
      mockCache.getOrFetch.mockReset();

      const mockTableMetadata = {
        database: 'test_db',
        name: 'test_table',
        partition_key: 'column1',
        sorting_key: 'column2',
        primary_key: 'column3',
      };

      // Setup the cache to return the mock data
      mockCache.getOrFetch.mockImplementation((key, queryFn) => {
        if (key === 'test_db.test_table.metadata') {
          return Promise.resolve(mockTableMetadata);
        }
        return queryFn();
      });

      const result = await metadata.getTableMetadata({
        databaseName: 'test_db',
        tableName: 'test_table',
        connectionId: 'test_connection',
      });

      // Verify the cache was called with the right key
      expect(mockCache.getOrFetch).toHaveBeenCalledWith(
        'test_db.test_table.metadata',
        expect.any(Function),
      );

      // Verify the mockClickhouseClient.query wasn't called since we're using cached data
      expect(mockClickhouseClient.query).not.toHaveBeenCalled();

      // Verify we still get the correct result
      expect(result).toEqual(mockTableMetadata);
    });
  });

  describe('getKeyValues', () => {
    const mockChartConfig: ChartConfigWithDateRange = {
      from: {
        databaseName: 'test_db',
        tableName: 'test_table',
      },
      select: '',
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: '',
      connection: 'test_connection',
      dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
    };

    beforeEach(() => {
      // Mock the renderChartConfig result
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: [
              {
                param0: ['value1', 'value2'],
                param1: ['type1', 'type2'],
              },
            ],
          }),
      });
    });

    it('should apply row limit when disableRowLimit is false', async () => {
      await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ['column1', 'column2'],
        limit: 10,
        disableRowLimit: false,
      });

      expect(mockClickhouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          clickhouse_settings: {
            max_rows_to_read: String(3e6),
            read_overflow_mode: 'break',
          },
        }),
      );
    });

    it('should not apply row limit when disableRowLimit is true', async () => {
      await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ['column1', 'column2'],
        limit: 10,
        disableRowLimit: true,
      });

      expect(mockClickhouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          clickhouse_settings: undefined,
        }),
      );
    });

    it('should apply row limit by default when disableRowLimit is not specified', async () => {
      await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ['column1', 'column2'],
        limit: 10,
      });

      expect(mockClickhouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          clickhouse_settings: {
            max_rows_to_read: String(3e6),
            read_overflow_mode: 'break',
          },
        }),
      );
    });

    it('should correctly transform the response data', async () => {
      const result = await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ['column1', 'column2'],
        limit: 10,
      });

      expect(result).toEqual([
        { key: 'column1', value: ['value1', 'value2'] },
        { key: 'column2', value: ['type1', 'type2'] },
      ]);
    });

    it('should filter out falsy values from the response', async () => {
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: [
              {
                param0: ['value1', null, '', 'value2', undefined],
              },
            ],
          }),
      });

      const result = await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ['column1'],
        limit: 10,
      });

      expect(result).toEqual([{ key: 'column1', value: ['value1', 'value2'] }]);
    });
  });
});
