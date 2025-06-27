import * as clickhouse from '..';

describe('getColumns', () => {
  it('returns empty result when database is empty', async () => {
    const result = await clickhouse.getColumns({
      database: '',
      table: 'some_table',
    });

    expect(result).toEqual({
      data: [],
      meta: [],
      rows: 0,
      statistics: {
        elapsed: 0,
        rows_read: 0,
        bytes_read: 0,
      },
    });
  });

  it('returns empty result when table is empty', async () => {
    const result = await clickhouse.getColumns({
      database: 'some_database',
      table: '',
    });

    expect(result).toEqual({
      data: [],
      meta: [],
      rows: 0,
      statistics: {
        elapsed: 0,
        rows_read: 0,
        bytes_read: 0,
      },
    });
  });

  it('returns empty result when both database and table are empty', async () => {
    const result = await clickhouse.getColumns({
      database: '',
      table: '',
    });

    expect(result).toEqual({
      data: [],
      meta: [],
      rows: 0,
      statistics: {
        elapsed: 0,
        rows_read: 0,
        bytes_read: 0,
      },
    });
  });

  it('calls client.query with correct parameters when inputs are valid', async () => {
    // Mock the client.query method
    const mockQuery = jest.spyOn(clickhouse.client, 'query').mockResolvedValueOnce({
      json: () => Promise.resolve({
        data: [{ name: 'test_column', type: 'String' }],
        meta: [],
        rows: 1,
        statistics: {
          elapsed: 0.1,
          rows_read: 1,
          bytes_read: 100,
        },
      }),
    } as any);

    const result = await clickhouse.getColumns({
      database: 'test_database',
      table: 'test_table',
    });

    expect(mockQuery).toHaveBeenCalledWith({
      query: 'DESCRIBE {database:Identifier}.{table:Identifier}',
      format: 'JSON',
      query_params: {
        database: 'test_database',
        table: 'test_table',
      },
    });

    expect(result).toEqual({
      data: [{ name: 'test_column', type: 'String' }],
      meta: [],
      rows: 1,
      statistics: {
        elapsed: 0.1,
        rows_read: 1,
        bytes_read: 100,
      },
    });

    // Restore the original implementation
    mockQuery.mockRestore();
  });
});