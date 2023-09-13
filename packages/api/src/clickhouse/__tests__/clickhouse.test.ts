import * as clickhouse from '..';

describe('clickhouse', () => {
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
});
