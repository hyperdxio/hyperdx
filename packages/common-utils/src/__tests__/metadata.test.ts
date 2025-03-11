import { ClickhouseClient } from '../clickhouse';
import { Metadata } from '../metadata';
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

describe('Metadata', () => {
  let metadata: Metadata;

  beforeEach(() => {
    metadata = new Metadata(mockClickhouseClient, mockCache);
    jest.clearAllMocks();
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
            max_rows_to_read: 1e6,
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
            max_rows_to_read: 1e6,
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
