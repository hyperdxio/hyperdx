import { createClient } from '@clickhouse/client';

import { ClickhouseClient } from '@/clickhouse/node';

jest.mock('@clickhouse/client', () => ({
  createClient: jest.fn(),
}));

describe('ClickhouseClient writes', () => {
  const native = { command: jest.fn(), insert: jest.fn(), close: jest.fn() };
  let client: ClickhouseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue(native);
    client = new ClickhouseClient({ host: 'http://localhost:8123' });
  });

  test('command delegates query and params to the native client', async () => {
    await client.command({
      query: 'CREATE TABLE t (x UInt8) ENGINE = Memory',
      query_params: { a: 1 },
    });
    expect(native.command).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('CREATE TABLE t'),
        query_params: { a: 1 },
      }),
    );
  });

  test('insert uses JSONEachRow', async () => {
    await client.insert({ table: 'default.t', values: [{ x: 1 }] });
    expect(native.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'default.t',
        values: [{ x: 1 }],
        format: 'JSONEachRow',
      }),
    );
  });
});
