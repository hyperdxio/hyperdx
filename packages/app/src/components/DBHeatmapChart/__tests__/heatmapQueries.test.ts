import {
  BuilderChartConfigWithDateRange,
  DisplayType,
  PromqlConfigWithDateRange,
} from '@hyperdx/common-utils/dist/types';

import {
  buildHeatmapSeriesConfig,
  resolveHeatmapGranularity,
  toHeatmapQuery,
} from '@/components/DBHeatmapChart/heatmapQueries';

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-07-06T00:00:00Z').getTime();
const dateRange: [Date, Date] = [new Date(T0), new Date(T0 + 2 * HOUR)];

describe('resolveHeatmapGranularity', () => {
  it('auto-sizes to about 245 buckets', () => {
    // 2h / 245 ≈ 29s
    expect(resolveHeatmapGranularity({ dateRange })).toBe('30 second');
    expect(resolveHeatmapGranularity({ granularity: 'auto', dateRange })).toBe(
      '30 second',
    );
  });

  it('keeps an explicit granularity', () => {
    expect(
      resolveHeatmapGranularity({ granularity: '15 minute', dateRange }),
    ).toBe('15 minute');
  });

  it('floors only auto granularity at minGranularitySeconds', () => {
    expect(
      resolveHeatmapGranularity({ dateRange, minGranularitySeconds: 300 }),
    ).toBe('5 minute');
    expect(
      resolveHeatmapGranularity({
        granularity: '1 minute',
        dateRange,
        minGranularitySeconds: 300,
      }),
    ).toBe('1 minute');
  });
});

describe('toHeatmapQuery', () => {
  const config: BuilderChartConfigWithDateRange = {
    displayType: DisplayType.Heatmap,
    select: [{ aggFn: 'count', aggCondition: '', valueExpression: 'Duration' }],
    from: { databaseName: 'default', tableName: 'otel_traces' },
    where: '',
    dateRange,
    granularity: '5 minute',
    timestampValueExpression: 'Timestamp',
    connection: 'test-connection',
  };

  it.each(['distribution', 'series'] as const)(
    'keeps the granularity in %s mode',
    mode => {
      const query = toHeatmapQuery({ ...config, heatmap: { mode } });
      expect(query.mode).toBe(mode);
      expect(query.config.granularity).toBe('5 minute');
    },
  );
});

describe('PromQL heatmaps', () => {
  const config: PromqlConfigWithDateRange = {
    configType: 'promql',
    displayType: DisplayType.Heatmap,
    promqlExpression: [{ expression: 'up' }, { expression: 'down' }],
    connection: 'test-connection',
    dateRange: [new Date(T0 + 90_000), new Date(T0 + HOUR + 90_000)],
    granularity: '5 minute',
    legendTemplate: '{{job}}',
  };

  it('are calculated distribution heatmaps by default, on a linear scale', () => {
    expect(toHeatmapQuery(config)).toEqual({
      mode: 'calculated',
      config,
      scaleType: 'linear',
    });
  });

  it('use the configured distribution scale', () => {
    const logConfig: PromqlConfigWithDateRange = {
      ...config,
      heatmap: { mode: 'distribution', scaleType: 'log' },
    };
    expect(toHeatmapQuery(logConfig)).toEqual({
      mode: 'calculated',
      config: logConfig,
      scaleType: 'log',
    });
  });

  it('are series heatmaps in series mode', () => {
    const seriesModeConfig: PromqlConfigWithDateRange = {
      ...config,
      heatmap: { mode: 'series' },
    };
    expect(toHeatmapQuery(seriesModeConfig)).toEqual({
      mode: 'series',
      config: seriesModeConfig,
    });
  });

  it('query at the heatmap granularity over a bucket-aligned range', () => {
    expect(buildHeatmapSeriesConfig(config, '5 minute')).toMatchObject({
      configType: 'promql',
      promqlExpression: config.promqlExpression,
      legendTemplate: '{{job}}',
      granularity: '5 minute',
      dateRange: [new Date(T0), new Date(T0 + HOUR + 5 * 60_000)],
    });
  });
});
