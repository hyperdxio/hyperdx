import { consoleLogger } from '@/clickhouse/browser';

describe('consoleLogger', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prints string args as raw text so multi-line SQL stays readable', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const sql = 'SELECT 1\nFROM system.one';

    consoleLogger.debug({
      module: 'clickhouse',
      message: 'Sending query',
      args: { sql, rows: 5 },
    });

    expect(debugSpy).toHaveBeenCalledWith('[clickhouse] Sending query', sql, 5);
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
