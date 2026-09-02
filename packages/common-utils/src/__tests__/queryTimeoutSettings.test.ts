import { ClickHouseQueryError, isQueryTimeoutError } from '@/clickhouse';
import { ClickhouseClient } from '@/clickhouse/node';

describe('isQueryTimeoutError', () => {
  // The message ClickHouse actually returns for max_execution_time.
  it('detects a ClickHouse execution-time timeout', () => {
    expect(
      isQueryTimeoutError(
        new Error(
          'Timeout exceeded: elapsed 180.001 seconds, maximum: 180. (TIMEOUT_EXCEEDED)',
        ),
      ),
    ).toBe(true);
  });

  it('detects it on a ClickHouseQueryError', () => {
    expect(
      isQueryTimeoutError(
        new ClickHouseQueryError(
          'Code: 159. DB::Exception: Timeout exceeded',
          'SELECT 1',
        ),
      ),
    ).toBe(true);
  });

  // A malformed query must not be reported as a timeout, or the UI tells the
  // user to narrow their range when the real problem is their SQL.
  it.each([
    'Unknown expression identifier `foo`',
    'Missing columns: bar',
    'Memory limit (total) exceeded',
  ])('does not match the unrelated error %p', message => {
    expect(isQueryTimeoutError(new Error(message))).toBe(false);
  });

  it.each([undefined, null, ''])('handles the non-error input %p', value => {
    expect(isQueryTimeoutError(value)).toBe(false);
  });
});

describe('processClickhouseSettings - max_execution_time', () => {
  type QueryInput = {
    query: string;
    clickhouse_settings?: Record<string, unknown>;
  };

  const SETTINGS_QUERY = 'SELECT name, value FROM system.settings';

  beforeEach(() => {
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const settingsFor = async (queryTimeout?: number) => {
    const client = new ClickhouseClient({
      host: 'http://localhost:8123',
      username: 'default',
      password: '',
      queryTimeout,
    });

    const mockQuery = jest.fn(async (_input: QueryInput) => ({
      json: async () => ({ data: [] }),
    }));
    // Swap the underlying driver so the settings the client computed are
    // observable without reaching a real server.
    Object.assign(client, { client: { query: mockQuery } });

    await client.query({ query: 'SELECT 1', format: 'JSON' });

    return mockQuery.mock.calls
      .map(([input]) => input)
      .find(input => input.query !== SETTINGS_QUERY)?.clickhouse_settings;
  };

  it('sends a configured timeout', async () => {
    await expect(settingsFor(180)).resolves.toMatchObject({
      max_execution_time: 180,
    });
  });

  // 0 is the team-configurable "no limit". It has to go out explicitly: an
  // absent setting is indistinguishable from a client that never set one, and
  // the proxy bounds that case with its default — which would make the loosest
  // configuration behave as the tightest.
  it('sends an explicit 0 rather than omitting it', async () => {
    await expect(settingsFor(0)).resolves.toMatchObject({
      max_execution_time: 0,
    });
  });

  it('omits the setting when no timeout is configured', async () => {
    await expect(settingsFor(undefined)).resolves.not.toHaveProperty(
      'max_execution_time',
    );
  });
});
