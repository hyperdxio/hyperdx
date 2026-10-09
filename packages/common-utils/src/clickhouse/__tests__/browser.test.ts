import { createClient } from '@clickhouse/client-web';

import { ClickhouseClient, consoleLogger } from '@/clickhouse/browser';

jest.mock('@clickhouse/client-web', () => ({ createClient: jest.fn() }));

describe('consoleLogger', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pretty-prints SQL into a single multi-line message', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const sql = 'SELECT a, b FROM default.otel_logs WHERE a = 1';

    consoleLogger.debug({
      module: 'clickhouse',
      message: 'Sending query',
      args: { sql },
    });

    // Exact layout is sqlFormatter's business; here we only pin the contract
    // devtools needs: one call, one string, and SQL broken across lines.
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0]).toHaveLength(1);

    const logged = String(debugSpy.mock.calls[0][0]);
    expect(logged.startsWith('Sending query:\n')).toBe(true);
    expect(logged.split('\n').length).toBeGreaterThan(2);
  });

  it('falls back to the raw SQL when it cannot be formatted', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const sql = 'SELECT ((( FROM';

    consoleLogger.debug({
      module: 'clickhouse',
      message: 'Sending query',
      args: { sql },
    });

    expect(debugSpy).toHaveBeenCalledWith(`Sending query:\n${sql}`);
  });

  it('keeps the prefixed form for logs that carry no SQL', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

    consoleLogger.debug({
      module: 'clickhouse',
      message: 'Response received',
      args: { rows: 5 },
    });

    expect(debugSpy).toHaveBeenCalledWith('[clickhouse] Response received', 5);
  });

  it('appends the error to error logs', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');

    consoleLogger.error({
      module: 'clickhouse',
      message: 'Query failed',
      err,
    });

    expect(errorSpy).toHaveBeenCalledWith('[clickhouse] Query failed', err);
  });
});

describe('browser connection routing', () => {
  const query = jest.fn().mockResolvedValue({});
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: { origin: 'http://localhost:3000' },
      configurable: true,
    });
    jest
      .mocked(createClient)
      .mockReturnValue({ query } as unknown as ReturnType<typeof createClient>);
    query.mockClear();
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
    jest.restoreAllMocks();
  });
  it('omits proxy routing headers for direct ClickHouse connections with generated IDs', async () => {
    const client = new ClickhouseClient({
      host: 'http://localhost:8123',
      username: 'default',
      password: '',
    });
    await client.query({
      query: 'SELECT 1',
      connectionId: 'local-generated-id',
      shouldSkipApplySettings: true,
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ http_headers: {} }),
    );
  });
  it('retains connection routing for the authenticated API proxy', async () => {
    const client = new ClickhouseClient({ host: '/api/clickhouse-proxy' });
    await client.query({
      query: 'SELECT 1',
      connectionId: 'team-connection',
      shouldSkipApplySettings: true,
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        http_headers: { 'x-hyperdx-connection-id': 'team-connection' },
      }),
    );
  });
});
