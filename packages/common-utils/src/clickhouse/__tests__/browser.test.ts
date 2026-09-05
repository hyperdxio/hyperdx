import { consoleLogger } from '@/clickhouse/browser';

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
