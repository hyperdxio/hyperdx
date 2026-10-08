import { fetchMetricNames } from '@/mcp/tools/sources/listMetricsQueries';

describe('fetchMetricNames', () => {
  it('throws on the ClickHouse cap instead of returning a truncated name set', async () => {
    const query = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: [{ MetricName: 'a' }] }),
    });

    const names = await fetchMetricNames({
      clickhouseClient: { query },
      databaseName: 'default',
      tableName: 'otel_metrics_gauge',
      connectionId: 'conn',
      startDate: new Date(0),
      endDate: new Date(1000),
      namePattern: undefined,
      afterName: undefined,
      limit: 2,
      maxExecutionSeconds: 28,
      signal: new AbortController().signal,
    });

    expect(names).toEqual(['a']);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        clickhouse_settings: {
          max_execution_time: 28,
          timeout_overflow_mode: 'throw',
        },
      }),
    );
  });
});
