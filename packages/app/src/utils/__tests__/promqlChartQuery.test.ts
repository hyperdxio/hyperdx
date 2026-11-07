import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { prometheusApi } from '@/api';
import { queryPromqlChartConfig } from '@/utils/promqlChartQuery';

jest.mock('@/api', () => ({
  prometheusApi: { query: jest.fn(), queryRange: jest.fn() },
}));

describe('queryPromqlChartConfig', () => {
  const dateRange: [Date, Date] = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T01:00:00Z'),
  ];

  beforeEach(() => {
    jest
      .mocked(prometheusApi.query)
      .mockReset()
      .mockResolvedValue({
        status: 'success',
        data: { resultType: 'vector', result: [] },
      });
    jest
      .mocked(prometheusApi.queryRange)
      .mockReset()
      .mockResolvedValue({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      });
  });

  // The server resolves the table from the source, so the table a config still
  // carries must not be sent.
  it.each([
    ['instant', prometheusApi.query],
    ['range', prometheusApi.queryRange],
  ] as const)(
    'names only the source on a %s query',
    async (queryType, endpoint) => {
      await queryPromqlChartConfig(
        {
          configType: 'promql',
          displayType: DisplayType.Number,
          connection: 'conn',
          source: 'source-promql',
          from: { databaseName: 'db', tableName: 'tbl' },
          promqlExpression: [{ expression: 'up', queryType }],
        },
        dateRange,
        new AbortController().signal,
        {},
      );

      const params = jest.mocked(endpoint).mock.calls[0][0];
      expect(params).toHaveProperty('sourceId', 'source-promql');
      expect(params).not.toHaveProperty('connectionId');
      expect(params).not.toHaveProperty('database');
      expect(params).not.toHaveProperty('table');
    },
  );

  it("caps an instant table query's series at the table's row cap", async () => {
    await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Table,
        connection: 'conn',
        source: 'source-promql',
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      dateRange,
      new AbortController().signal,
      {},
    );

    expect(prometheusApi.query).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10_000 }),
    );
  });

  it('passes the attribution through to the request', async () => {
    const attribution = { surface: 'dashboard' as const, tile: 'tile-1' };
    await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Table,
        connection: 'conn',
        source: 'source-promql',
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      dateRange,
      new AbortController().signal,
      attribution,
    );

    expect(prometheusApi.query).toHaveBeenCalledWith(
      expect.objectContaining({ attribution }),
    );
  });

  // A number tile warns when an expression yields several series, so it needs
  // to see all of them.
  it('leaves an instant number query uncapped', async () => {
    await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Number,
        connection: 'conn',
        source: 'source-promql',
        promqlExpression: [{ expression: 'up', queryType: 'instant' }],
      },
      dateRange,
      new AbortController().signal,
      {},
    );

    expect(prometheusApi.query).toHaveBeenCalledWith(
      expect.objectContaining({ limit: undefined }),
    );
  });

  describe('series labels of a time chart', () => {
    const t0 = dateRange[0].getTime() / 1000;
    const mockRange = (...metrics: Record<string, string>[][]) => {
      const mock = jest.mocked(prometheusApi.queryRange).mockReset();
      for (const series of metrics) {
        mock.mockResolvedValueOnce({
          status: 'success',
          data: {
            resultType: 'matrix',
            result: series.map(metric => ({
              metric,
              values: [[t0, '1']],
            })),
          },
        });
      }
    };
    const query = (
      promqlExpression: { expression: string }[],
      legendTemplate?: string,
    ) =>
      queryPromqlChartConfig(
        {
          configType: 'promql',
          displayType: DisplayType.Line,
          source: 'source-promql',
          connection: 'conn',
          granularity: '1 minute',
          legendTemplate,
          promqlExpression,
        },
        dateRange,
        new AbortController().signal,
        {},
      );

    it('keys each series by its name', async () => {
      mockRange([
        { __name__: 'up', service: 'api' },
        { __name__: 'up', service: 'web' },
      ]);
      const result = await query([{ expression: 'up' }]);
      const names = result.data.map(row => row.series_name);
      expect(result.promqlSeriesLabels).toEqual({
        [names[0]]: { __name__: 'up', service: 'api' },
        [names[1]]: { __name__: 'up', service: 'web' },
      });
    });

    it('keys series by their legend-template name', async () => {
      mockRange([{ service: 'api', pod: 'a' }]);
      const result = await query([{ expression: 'up' }], '{{service}}');
      expect(result.promqlSeriesLabels).toEqual({
        api: { service: 'api', pod: 'a' },
      });
    });

    it('covers every expression', async () => {
      mockRange([{ service: 'api' }], [{ job: 'db' }]);
      const result = await query([
        { expression: 'up' },
        { expression: 'down' },
      ]);
      expect(Object.values(result.promqlSeriesLabels ?? {})).toEqual([
        { service: 'api' },
        { job: 'db' },
      ]);
    });
  });

  it('runs a heatmap as a range query of its first expression', async () => {
    jest
      .mocked(prometheusApi.queryRange)
      .mockReset()
      .mockResolvedValue({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { job: 'api', instance: 'a' },
              values: [[dateRange[0].getTime() / 1000, '1']],
            },
          ],
        },
      });

    const result = await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Heatmap,
        connection: 'conn',
        source: 'source-promql',
        granularity: '5 minute',
        legendTemplate: '{{job}}',
        promqlExpression: [
          {
            expression: 'rate(up{job="$job"}[$__interval])',
            queryType: 'instant',
          },
          { expression: 'down' },
        ],
        variables: [{ name: 'job', values: ['api'] }],
      },
      dateRange,
      new AbortController().signal,
      {},
    );

    expect(prometheusApi.query).not.toHaveBeenCalled();
    expect(prometheusApi.queryRange).toHaveBeenCalledTimes(1);
    expect(prometheusApi.queryRange).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'rate(up{job="api"}[300s])',
        step: '300s',
      }),
    );
    expect(result.data).toEqual([
      {
        __hdx_time_bucket: dateRange[0].toISOString(),
        value: 1,
        series_name: 'api',
      },
    ]);
  });

  it('keys a histogram heatmap rows by bucket, not series name', async () => {
    jest
      .mocked(prometheusApi.queryRange)
      .mockReset()
      .mockResolvedValue({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { le: '+Inf' },
              values: [[dateRange[0].getTime() / 1000, '4']],
            },
          ],
        },
      });

    const result = await queryPromqlChartConfig(
      {
        configType: 'promql',
        displayType: DisplayType.Heatmap,
        connection: 'conn',
        source: 'source-promql',
        legendTemplate: '{{job}}',
        promqlExpression: [{ expression: 'sum by (le) (x_bucket)' }],
        heatmap: { mode: 'histogram' },
      },
      dateRange,
      new AbortController().signal,
      {},
    );

    expect(prometheusApi.queryRange).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'sum by (le) (x_bucket)' }),
    );
    expect(result.data).toEqual([
      { __hdx_time_bucket: dateRange[0].toISOString(), le: '+Inf', value: 4 },
    ]);
  });
});
