import * as clickhouse from '..';
import {describe, beforeEach, jest, it, expect} from '@jest/globals';

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

  it('getMetricsChart', async () => {
    jest
      .spyOn(clickhouse.client, 'query')
      .mockResolvedValueOnce({ json: () => Promise.resolve({}) } as any);

    await clickhouse.getMetricsChart({
      aggFn: clickhouse.AggFn.Count,
      dataType: 'Sum',
      endTime: Date.now(),
      granularity: clickhouse.Granularity.OneHour,
      name: 'test',
      q: '',
      startTime: Date.now(),
      teamId: 'test',
    });

    expect(clickhouse.client.query).toHaveBeenCalledTimes(1);
    expect(clickhouse.client.query).toHaveBeenCalledWith({
      "format": "JSON", "query": `
    WITH metrics AS (SELECT
    toStartOfInterval(timestamp, INTERVAL '1 hour') as timestamp,
    min(value) as value,
    _string_attributes,
    name
  FROM
    \`default\`.\`metric_stream\`
  WHERE
    name = 'test'
    AND data_type = 'Sum'
    AND ((_timestamp_sort_key >= 1700608499630000128 AND _timestamp_sort_key < 1700608499630000128))
  GROUP BY
    name,
    _string_attributes,
    timestamp
  ORDER BY
    _string_attributes,
    timestamp ASC)
    SELECT toUnixTimestamp(toStartOfInterval(timestamp, INTERVAL '1 hour')) AS ts_bucket,name AS group,COUNT(value) as data
    FROM metrics
    GROUP BY group, ts_bucket
    ORDER BY ts_bucket ASC
    WITH FILL
      FROM toUnixTimestamp(toStartOfInterval(toDateTime(1700608499.63), INTERVAL '1 hour'))
      TO toUnixTimestamp(toStartOfInterval(toDateTime(1700608499.63), INTERVAL '1 hour'))
      STEP 3600
    `});
  });
});