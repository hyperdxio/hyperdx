import * as clickhouse from '..';
import { closeDB, getServer } from '@/fixtures';

describe('clickhouse', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.closeHttpServer();
    await closeDB();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clientInsertWithRetries (success)', async () => {
    jest
      .spyOn(clickhouse.client, 'insert')
      .mockRejectedValueOnce(new Error('first error'))
      .mockRejectedValueOnce(new Error('second error'))
      .mockResolvedValueOnce(null as any);

    await clickhouse.clientInsertWithRetries({
      table: 'testTable',
      values: [{ test: 'test' }],
      retries: 3,
      timeout: 100,
    });

    expect(clickhouse.client.insert).toHaveBeenCalledTimes(3);
  });

  it('clientInsertWithRetries (fail)', async () => {
    jest
      .spyOn(clickhouse.client, 'insert')
      .mockRejectedValueOnce(new Error('first error'))
      .mockRejectedValueOnce(new Error('second error'));

    try {
      await clickhouse.clientInsertWithRetries({
        table: 'testTable',
        values: [{ test: 'test' }],
        retries: 2,
        timeout: 100,
      });
    } catch (error: any) {
      expect(error.message).toBe('second error');
    }

    expect(clickhouse.client.insert).toHaveBeenCalledTimes(2);
    expect.assertions(2);
  });

  it('getMetricsChart avoids sending NaN to frontend', async () => {
    jest
      .spyOn(clickhouse.client, 'query')
      .mockResolvedValueOnce({ json: () => Promise.resolve({}) } as any);

    await clickhouse.getMetricsChart({
      aggFn: clickhouse.AggFn.AvgRate,
      dataType: clickhouse.MetricsDataType.Sum,
      endTime: Date.now(),
      granularity: clickhouse.Granularity.OneHour,
      name: 'test',
      q: '',
      startTime: Date.now() - 1000 * 60 * 60 * 24,
      teamId: 'test',
    });

    expect(clickhouse.client.query).toHaveBeenCalledTimes(2);
    expect(clickhouse.client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'JSON',
        query: expect.stringContaining('isNaN(rate) = 0'),
      }),
    );
  });
});
