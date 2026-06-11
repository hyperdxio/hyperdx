import { chSql, ColumnMeta, parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/core/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
  QuerySettings,
} from '@/types';

import {
  ChartConfigWithOptDateRangeEx,
  renderChartConfig,
  timeFilterExpr,
} from '../core/renderChartConfig';

describe('renderChartConfig', () => {
  let mockMetadata: jest.Mocked<Metadata>;

  // Suppress expected console.warn noise from missing columns / optimization fallbacks
  beforeAll(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    const columns = [
      { name: 'timestamp', type: 'DateTime' },
      { name: 'value', type: 'Float64' },
      { name: 'TraceId', type: 'String' },
      { name: 'ServiceName', type: 'String' },
      { name: 'severity', type: 'String' },
    ];
    mockMetadata = {
      getColumns: jest.fn().mockResolvedValue([
        { name: 'timestamp', type: 'DateTime' },
        { name: 'value', type: 'Float64' },
      ]),
      getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(null),
      getColumn: jest
        .fn()
        .mockImplementation(async ({ column }) =>
          columns.find(col => col.name === column),
        ),
      getTableMetadata: jest
        .fn()
        .mockResolvedValue({ primary_key: 'timestamp' }),
      getSkipIndices: jest.fn().mockResolvedValue([]),
      getSetting: jest.fn().mockResolvedValue(undefined),
      isClickHouseCloud: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<Metadata>;
  });

  const gaugeConfiguration: ChartConfigWithOptDateRange = {
    displayType: DisplayType.Line,
    connection: 'test-connection',
    // metricTables is added from the Source object via spread operator
    metricTables: {
      gauge: 'otel_metrics_gauge',
      histogram: 'otel_metrics_histogram',
      sum: 'otel_metrics_sum',
      summary: 'otel_metrics_summary',
      'exponential histogram': 'otel_metrics_exponential_histogram',
    },
    from: {
      databaseName: 'default',
      tableName: '',
    },
    select: [
      {
        aggFn: 'quantile',
        aggCondition: '',
        aggConditionLanguage: 'lucene',
        valueExpression: 'Value',
        level: 0.95,
        metricName: 'nodejs.event_loop.utilization',
        metricType: MetricsDataType.Gauge,
      },
    ],
    where: '',
    whereLanguage: 'lucene',
    timestampValueExpression: 'TimeUnix',
    dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
    granularity: '1 minute',
    limit: { limit: 10 },
  };

  const querySettings: QuerySettings = [
    { setting: 'optimize_read_in_order', value: '0' },
    { setting: 'cast_keep_nullable', value: '1' },
    { setting: 'additional_result_filter', value: 'x != 2' },
    { setting: 'count_distinct_implementation', value: 'uniqCombined64' },
    { setting: 'async_insert_busy_timeout_min_ms', value: '20000' },
  ];

  it('should generate sql for a single gauge metric', async () => {
    const generatedSql = await renderChartConfig(
      gaugeConfiguration,
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toMatchSnapshot();
  });

  it('should generate sql for a single gauge metric with a delta() function applied', async () => {
    const generatedSql = await renderChartConfig(
      {
        ...gaugeConfiguration,
        select: [
          {
            aggFn: 'max',
            valueExpression: 'Value',
            metricName: 'nodejs.event_loop.utilization',
            metricType: MetricsDataType.Gauge,
            isDelta: true,
          },
        ],
      },
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toMatchSnapshot();
  });

  it('should generate sql for a single sum metric', async () => {
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      // metricTables is added from the Source object via spread operator
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: {
        databaseName: 'default',
        tableName: '',
      },
      select: [
        {
          aggFn: 'avg',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: 'Value',
          metricName: 'db.client.connections.usage',
          metricType: MetricsDataType.Sum,
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minute',
      limit: { limit: 10 },
    };

    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toMatchSnapshot();
  });

  it('should throw error for string select on sum metric', async () => {
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: {
        databaseName: 'default',
        tableName: '',
      },
      select: 'Value',
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minute',
      limit: { limit: 10 },
    };

    await expect(
      renderChartConfig(config, mockMetadata, querySettings),
    ).rejects.toThrow('multi select or string select on metrics not supported');
  });

  it('should generate sql for a sum metric with aggFn=increase (Use Increase)', async () => {
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: {
        databaseName: 'default',
        tableName: '',
      },
      select: [
        {
          aggFn: 'increase',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: 'Value',
          metricName: 'db.client.connections.usage',
          metricType: MetricsDataType.Sum,
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minute',
      limit: { limit: 10 },
    };

    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    // Increase (Use Increase) sums Rate across sub-series sharing the same
    // groupBy value (or all rows when no groupBy) to yield the per-bucket
    // counter increase. The sum aggregation wraps its operand in a numeric
    // cast (toFloat64OrDefault) so match that loosely.
    expect(actual).toMatch(/sum\s*\([^)]*Rate[^)]*\)/);
    // Rate is computed at the raw-row level in Source using lagInFrame,
    // rather than diffing pre-bucketed values in Bucketed. This works even
    // when a series only spans one bucket in the visible window.
    expect(actual).toContain('lagInFrame');
    // Counter resets / decreases are clamped to 0. Note: this differs from the
    // Prometheus convention (which treats a reset as current_value assuming restart
    // from 0), but avoids injecting post-reset spikes.
    expect(actual).toContain('greatest(Value - lagInFrame');
    // Crucially, the Rate formula must NOT gate on IsMonotonic.
    expect(actual).not.toMatch(/IF\(IsMonotonic\s*=\s*0,\s*Value/);
    expect(actual).toMatchSnapshot();
  });

  it('should limit aggFn=increase + groupBy to the top 20 groups via a TopGroups CTE', async () => {
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: {
        databaseName: 'default',
        tableName: '',
      },
      select: [
        {
          aggFn: 'increase',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: 'Value',
          metricName: 'db.client.connections.usage',
          metricType: MetricsDataType.Sum,
        },
      ],
      groupBy: [
        {
          aggCondition: '',
          valueExpression: 'ServiceName',
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minute',
      limit: { limit: 100000 },
    };

    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);

    // A "TopGroups" CTE should be emitted that picks the top N groups by
    // max(sum(Rate) over buckets). The inner sum(Rate) matches the outer
    // query's per-bucket aggregation, so a group with a spike in one bucket
    // still qualifies for the top N.
    expect(actual).toContain('TopGroups');
    expect(actual).toMatch(/sum\(Rate\)\s+AS\s+`bucket_value`/);
    expect(actual).toMatch(/ORDER\s+BY\s+max\(`bucket_value`\)\s+DESC/);
    expect(actual).toContain('LIMIT 20');
    // Rows where the groupBy value is NULL or empty must be excluded so they
    // don't dominate the chart as a single '-' series.
    expect(actual).toMatch(
      /ServiceName\s+IS\s+NOT\s+NULL\s+AND\s+toString\(ServiceName\)\s*!=\s*''/,
    );
    // The outer query should restrict to the top groups via an IN subquery.
    expect(actual).toMatch(
      /tuple\(ServiceName\)\s+IN\s*\(\s*SELECT\s+`group`\s+FROM\s+TopGroups\)/,
    );
    // Outer query reads from Bucketed and sums Rate across sub-series.
    expect(actual).toMatch(/FROM\s+Bucketed/);
    expect(actual).toMatch(/sum\s*\([^)]*Rate[^)]*\)/);
    expect(actual).toMatchSnapshot();
  });

  it('should render rank where as SQL even when whereLanguage is lucene (regression)', async () => {
    // Regression: if the user's config has whereLanguage='lucene' and we set a
    // raw SQL where clause (rank filter) internally, renderWhere must parse it
    // as SQL. Otherwise the Lucene parser fails with "Can not search bare text
    // without an implicit column set".
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: { databaseName: 'default', tableName: '' },
      select: [
        {
          aggFn: 'increase',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: 'Value',
          metricName: 'db.client.connections.usage',
          metricType: MetricsDataType.Sum,
        },
      ],
      groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
      where: '',
      whereLanguage: 'lucene',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minute',
      limit: { limit: 100000 },
    };

    // Should not throw.
    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).toContain('TopGroups');
  });

  it('should handle aggFn=increase with multi-column groupBy', async () => {
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: {
        databaseName: 'default',
        tableName: '',
      },
      select: [
        {
          aggFn: 'increase',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: 'Value',
          metricName: 'db.client.connections.usage',
          metricType: MetricsDataType.Sum,
        },
      ],
      groupBy: [
        { aggCondition: '', valueExpression: 'ServiceName' },
        { aggCondition: '', valueExpression: "Attributes['env']" },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minute',
      limit: { limit: 100000 },
    };

    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    // Both groupBy expressions should be packed into a tuple() in the TopGroups
    // CTE and outer WHERE.
    expect(actual).toMatch(
      /tuple\(\s*ServiceName\s*,\s*Attributes\[['"]env['"]\]\s*\)/,
    );
    expect(actual).toContain('TopGroups');
    expect(actual).toContain('LIMIT 20');
    // Each groupBy column is individually filtered against NULL/empty to
    // prevent a single empty series from dominating the chart.
    expect(actual).toMatch(
      /ServiceName\s+IS\s+NOT\s+NULL\s+AND\s+toString\(ServiceName\)\s*!=\s*''/,
    );
    expect(actual).toMatch(
      /Attributes\[['"]env['"]\]\s+IS\s+NOT\s+NULL\s+AND\s+toString\(Attributes\[['"]env['"]\]\)\s*!=\s*''/,
    );
  });

  it('should not emit a rank CTE when aggFn=increase has no groupBy', async () => {
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: {
        databaseName: 'default',
        tableName: '',
      },
      select: [
        {
          aggFn: 'increase',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: 'Value',
          metricName: 'db.client.connections.usage',
          metricType: MetricsDataType.Sum,
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minute',
      limit: { limit: 10 },
    };

    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).not.toContain('TopGroups');
  });

  describe('seriesLimit (group-by series cap)', () => {
    const baseLogsConfig: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'logs' },
      select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
      groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'timestamp',
      dateRange: [new Date('2025-02-12'), new Date('2025-02-13')],
      granularity: '5 minute',
    };

    it('restricts to the top N group-by series via a CTE when seriesLimit is set', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          { ...baseLogsConfig, seriesLimit: 60 },
          mockMetadata,
          querySettings,
        ),
      );
      // A ranking CTE keeps the top N groups by max value in any bucket.
      expect(sql).toContain('__hdx_series_limit');
      expect(sql).toMatch(/ORDER\s+BY\s+max\(`__hdx_series_rank`\)\s+DESC/);
      expect(sql).toContain('LIMIT 60');
      // The outer query is restricted to those groups via an IN subquery.
      expect(sql).toMatch(
        /tuple\(ServiceName\)\s+IN\s*\(\s*SELECT\s+`group`\s+FROM\s+`__hdx_series_limit`\)/,
      );
      // Groups with a NULL component are excluded; empty-string groups are kept
      // (no `!= ''` check).
      expect(sql).toMatch(/ServiceName\s+IS\s+NOT\s+NULL/);
      expect(sql).not.toMatch(/toString\(ServiceName\)\s*!=\s*''/);
    });

    it('does not emit a series-limit CTE when seriesLimit is unset (e.g. alert evaluation)', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(baseLogsConfig, mockMetadata, querySettings),
      );
      expect(sql).not.toContain('__hdx_series_limit');
    });

    it('does not emit a series-limit CTE without a group-by', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          { ...baseLogsConfig, groupBy: undefined, seriesLimit: 60 },
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).not.toContain('__hdx_series_limit');
    });

    it('does not emit a series-limit CTE without granularity', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          { ...baseLogsConfig, granularity: undefined, seriesLimit: 60 },
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).not.toContain('__hdx_series_limit');
    });

    it('packs a multi-column group-by into a tuple for the series-limit CTE', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...baseLogsConfig,
            groupBy: [
              { aggCondition: '', valueExpression: 'ServiceName' },
              { aggCondition: '', valueExpression: 'TraceId' },
            ],
            seriesLimit: 60,
          },
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain('__hdx_series_limit');
      expect(sql).toMatch(/tuple\(\s*ServiceName\s*,\s*TraceId\s*\)/);
    });

    it('strips group-by aliases inside the series-limit CTE tuple and null filter', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...baseLogsConfig,
            groupBy: [
              {
                aggCondition: '',
                valueExpression: 'ServiceName',
                alias: 'svc',
              },
            ],
            seriesLimit: 60,
          },
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain('__hdx_series_limit');
      // tuple() and `IS NOT NULL` must use the bare expression, not `ServiceName
      // AS "svc"` (which would be invalid SQL there).
      expect(sql).toMatch(
        /tuple\(ServiceName\)\s+IN\s*\(\s*SELECT\s+`group`\s+FROM\s+`__hdx_series_limit`\)/,
      );
      expect(sql).not.toContain('tuple(ServiceName AS');
      expect(sql).not.toMatch(/ServiceName\s+AS\s+"svc"\s+IS\s+NOT\s+NULL/);
    });

    it('splits a comma-separated string group-by into per-column null checks', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...baseLogsConfig,
            groupBy: "LogAttributes['agentToServer.capabilities'],ServiceName",
            seriesLimit: 60,
          },
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain('__hdx_series_limit');
      // Each column gets its own NULL check, split on the top-level comma — not
      // the comma inside Map['...'].
      expect(sql).toMatch(
        /LogAttributes\[['"]agentToServer\.capabilities['"]\]\s+IS\s+NOT\s+NULL/,
      );
      expect(sql).toMatch(/ServiceName\s+IS\s+NOT\s+NULL/);
      // Regression: must NOT emit a two-argument toString of both columns (the
      // original bug that prompted the split).
      expect(sql).not.toMatch(/toString\([^)]*,/);
      // Both columns are packed into the tuple for the IN predicate.
      expect(sql).toMatch(
        /tuple\(\s*LogAttributes\[['"]agentToServer\.capabilities['"]\]\s*,\s*ServiceName\s*\)\s+IN\s*\(\s*SELECT\s+`group`\s+FROM\s+`__hdx_series_limit`\)/,
      );
    });

    it('does not emit a series-limit CTE for a metric source', async () => {
      // Metric configs are rewritten to query a Bucketed CTE (no real source
      // table to re-scan), so the cap is gated off even with seriesLimit set.
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...gaugeConfiguration,
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            seriesLimit: 60,
          },
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).not.toContain('__hdx_series_limit');
    });
  });

  it('should throw when aggFn=increase is used on a non-Sum metric', async () => {
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: {
        databaseName: 'default',
        tableName: '',
      },
      select: [
        {
          aggFn: 'increase',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: 'Value',
          metricName: 'nodejs.event_loop.utilization',
          metricType: MetricsDataType.Gauge,
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
      granularity: '5 minute',
      limit: { limit: 10 },
    };

    await expect(
      renderChartConfig(config, mockMetadata, querySettings),
    ).rejects.toThrow(
      "aggFn 'increase' is only supported for Sum (counter) metrics",
    );
  });

  describe('histogram metric queries', () => {
    describe('quantile', () => {
      it('should generate a query without grouping or time bucketing', async () => {
        const config: ChartConfigWithOptDateRange = {
          displayType: DisplayType.Line,
          connection: 'test-connection',
          metricTables: {
            gauge: 'otel_metrics_gauge',
            histogram: 'otel_metrics_histogram',
            sum: 'otel_metrics_sum',
            summary: 'otel_metrics_summary',
            'exponential histogram': 'otel_metrics_exponential_histogram',
          },
          from: {
            databaseName: 'default',
            tableName: '',
          },
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Value',
              metricName: 'http.server.duration',
              metricType: MetricsDataType.Histogram,
            },
          ],
          where: '',
          whereLanguage: 'sql',
          timestampValueExpression: 'TimeUnix',
          dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
          limit: { limit: 10 },
        };

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
        const actual = parameterizedQueryToSql(generatedSql);
        expect(actual).toMatchSnapshot();
      });

      it('should generate a query without grouping but time bucketing', async () => {
        const config: ChartConfigWithOptDateRange = {
          displayType: DisplayType.Line,
          connection: 'test-connection',
          metricTables: {
            gauge: 'otel_metrics_gauge',
            histogram: 'otel_metrics_histogram',
            sum: 'otel_metrics_sum',
            summary: 'otel_metrics_summary',
            'exponential histogram': 'otel_metrics_exponential_histogram',
          },
          from: {
            databaseName: 'default',
            tableName: '',
          },
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Value',
              metricName: 'http.server.duration',
              metricType: MetricsDataType.Histogram,
            },
          ],
          where: '',
          whereLanguage: 'sql',
          timestampValueExpression: 'TimeUnix',
          dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
          granularity: '2 minute',
          limit: { limit: 10 },
        };

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
        const actual = parameterizedQueryToSql(generatedSql);
        expect(actual).toMatchSnapshot();
      });

      it('should generate a query with grouping and time bucketing', async () => {
        const config: ChartConfigWithOptDateRange = {
          displayType: DisplayType.Line,
          connection: 'test-connection',
          metricTables: {
            gauge: 'otel_metrics_gauge',
            histogram: 'otel_metrics_histogram',
            sum: 'otel_metrics_sum',
            summary: 'otel_metrics_summary',
            'exponential histogram': 'otel_metrics_exponential_histogram',
          },
          from: {
            databaseName: 'default',
            tableName: '',
          },
          select: [
            {
              aggFn: 'quantile',
              level: 0.5,
              valueExpression: 'Value',
              metricName: 'http.server.duration',
              metricType: MetricsDataType.Histogram,
            },
          ],
          where: '',
          whereLanguage: 'sql',
          timestampValueExpression: 'TimeUnix',
          dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
          granularity: '2 minute',
          groupBy: `ResourceAttributes['host']`,
          limit: { limit: 10 },
        };

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
        const actual = parameterizedQueryToSql(generatedSql);
        expect(actual).toMatchSnapshot();
      });
    });

    describe('count', () => {
      it('should generate a count query without grouping or time bucketing', async () => {
        const config: ChartConfigWithOptDateRange = {
          displayType: DisplayType.Line,
          connection: 'test-connection',
          metricTables: {
            gauge: 'otel_metrics_gauge',
            histogram: 'otel_metrics_histogram',
            sum: 'otel_metrics_sum',
            summary: 'otel_metrics_summary',
            'exponential histogram': 'otel_metrics_exponential_histogram',
          },
          from: {
            databaseName: 'default',
            tableName: '',
          },
          select: [
            {
              aggFn: 'count',
              valueExpression: 'Value',
              metricName: 'http.server.duration',
              metricType: MetricsDataType.Histogram,
            },
          ],
          where: '',
          whereLanguage: 'sql',
          timestampValueExpression: 'TimeUnix',
          dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
          limit: { limit: 10 },
        };

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
        const actual = parameterizedQueryToSql(generatedSql);
        expect(actual).toMatchSnapshot();
      });

      it('should generate a count query without grouping but time bucketing', async () => {
        const config: ChartConfigWithOptDateRange = {
          displayType: DisplayType.Line,
          connection: 'test-connection',
          metricTables: {
            gauge: 'otel_metrics_gauge',
            histogram: 'otel_metrics_histogram',
            sum: 'otel_metrics_sum',
            summary: 'otel_metrics_summary',
            'exponential histogram': 'otel_metrics_exponential_histogram',
          },
          from: {
            databaseName: 'default',
            tableName: '',
          },
          select: [
            {
              aggFn: 'count',
              valueExpression: 'Value',
              metricName: 'http.server.duration',
              metricType: MetricsDataType.Histogram,
            },
          ],
          where: '',
          whereLanguage: 'sql',
          timestampValueExpression: 'TimeUnix',
          dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
          granularity: '2 minute',
          limit: { limit: 10 },
        };

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
        const actual = parameterizedQueryToSql(generatedSql);
        expect(actual).toMatchSnapshot();
      });

      it('should generate a count query with grouping and time bucketing', async () => {
        const config: ChartConfigWithOptDateRange = {
          displayType: DisplayType.Line,
          connection: 'test-connection',
          metricTables: {
            gauge: 'otel_metrics_gauge',
            histogram: 'otel_metrics_histogram',
            sum: 'otel_metrics_sum',
            summary: 'otel_metrics_summary',
            'exponential histogram': 'otel_metrics_exponential_histogram',
          },
          from: {
            databaseName: 'default',
            tableName: '',
          },
          select: [
            {
              aggFn: 'count',
              valueExpression: 'Value',
              metricName: 'http.server.duration',
              metricType: MetricsDataType.Histogram,
            },
          ],
          where: '',
          whereLanguage: 'sql',
          timestampValueExpression: 'TimeUnix',
          dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
          granularity: '2 minute',
          groupBy: `ResourceAttributes['host']`,
          limit: { limit: 10 },
        };

        const generatedSql = await renderChartConfig(
          config,
          mockMetadata,
          querySettings,
        );
        const actual = parameterizedQueryToSql(generatedSql);
        expect(actual).toMatchSnapshot();
      });
    });
  });

  describe('containing CTE clauses', () => {
    it('should render a ChSql CTE configuration correctly', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        from: {
          databaseName: '',
          tableName: 'TestCte',
        },
        with: [
          { name: 'TestCte', sql: chSql`SELECT TimeUnix, Line FROM otel_logs` },
        ],
        select: [{ valueExpression: 'Line' }],
        where: '',
        whereLanguage: 'sql',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toMatchSnapshot();
    });

    it('should render a chart config CTE configuration correctly', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'Parts',
            chartConfig: {
              connection: 'test-connection',
              timestampValueExpression: '',
              select: '_part, _part_offset',
              from: { databaseName: 'default', tableName: 'some_table' },
              where: '',
              whereLanguage: 'sql',
              filters: [
                {
                  type: 'sql',
                  condition: `FieldA = 'test'`,
                },
              ],
              orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
              limit: { limit: 1000 },
            },
          },
        ],
        select: '*',
        filters: [
          {
            type: 'sql',
            condition: `FieldA = 'test'`,
          },
          {
            type: 'sql',
            condition: `indexHint((_part, _part_offset) IN (SELECT tuple(_part, _part_offset) FROM Parts))`,
          },
        ],
        from: {
          databaseName: '',
          tableName: 'Parts',
        },
        where: '',
        whereLanguage: 'sql',
        orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
        limit: { limit: 1000 },
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toMatchSnapshot();
    });

    it('should throw if the CTE is missing both sql and chartConfig', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'InvalidCTE',
            // Intentionally omitting both sql and chartConfig properties
          },
        ],
        select: [{ valueExpression: 'Line' }],
        from: {
          databaseName: 'default',
          tableName: 'some_table',
        },
        where: '',
        whereLanguage: 'sql',
      };

      await expect(
        renderChartConfig(config, mockMetadata, querySettings),
      ).rejects.toThrow(
        "must specify either 'sql' or 'chartConfig' in with clause",
      );
    });

    it('should throw if the CTE sql param is invalid', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'InvalidCTE',
            sql: 'SELECT * FROM some_table' as any, // Intentionally not a ChSql object
          },
        ],
        select: [{ valueExpression: 'Line' }],
        from: {
          databaseName: 'default',
          tableName: 'some_table',
        },
        where: '',
        whereLanguage: 'sql',
      };

      await expect(
        renderChartConfig(config, mockMetadata, querySettings),
      ).rejects.toThrow('non-conforming sql object in CTE');
    });

    it('should throw if the CTE chartConfig param is invalid', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'InvalidCTE',
            chartConfig: {
              // Missing required properties like select, from, etc.
              connection: 'test-connection',
            } as any, // Intentionally invalid chartConfig
          },
        ],
        select: [{ valueExpression: 'Line' }],
        from: {
          databaseName: 'default',
          tableName: 'some_table',
        },
        where: '',
        whereLanguage: 'sql',
      };

      await expect(
        renderChartConfig(config, mockMetadata, querySettings),
      ).rejects.toThrow('non-conforming chartConfig object in CTE');
    });
  });

  describe('materialized column optimization with expression alias CTEs', () => {
    it('should rewrite WHERE to use materialized column when with clauses are expression aliases (isSubquery: false)', async () => {
      mockMetadata.getMaterializedColumnsLookupTable = jest
        .fn()
        .mockResolvedValue(
          new Map([["LogAttributes['attr_key']", 'attr_key']]),
        );

      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'otel_logs',
        },
        with: [
          {
            name: 'body',
            sql: chSql`toString(Body)`,
            isSubquery: false,
          },
        ],
        select: [{ aggFn: 'count', valueExpression: '' }],
        where: "LogAttributes['attr_key'] = 'attr_val'",
        whereLanguage: 'sql',
        granularity: '1 minute',
        timestampValueExpression: 'Timestamp',
        dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);

      expect(mockMetadata.getMaterializedColumnsLookupTable).toHaveBeenCalled();
      expect(sql).toContain("attr_key = 'attr_val'");
      expect(sql).not.toContain("LogAttributes['attr_key']");
    });

    it('should skip materialized columns when with clauses are subquery CTEs', async () => {
      mockMetadata.getMaterializedColumnsLookupTable = jest
        .fn()
        .mockResolvedValue(
          new Map([["LogAttributes['attr_key']", 'attr_key']]),
        );

      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        from: {
          databaseName: '',
          tableName: 'TestCte',
        },
        with: [
          {
            name: 'TestCte',
            sql: chSql`SELECT * FROM otel_logs`,
          },
        ],
        select: [{ aggFn: 'count', valueExpression: '' }],
        where: '',
        whereLanguage: 'sql',
      };

      await renderChartConfig(config, mockMetadata, querySettings);
      expect(
        mockMetadata.getMaterializedColumnsLookupTable,
      ).not.toHaveBeenCalled();
    });
  });

  describe('SQL filter KV items direct_read optimization', () => {
    const stubKvItemsMetadata = () => {
      mockMetadata.getColumns = jest.fn().mockResolvedValue([
        {
          name: 'LogAttributes',
          type: 'Map(String, String)',
          default_type: '',
          default_expression: '',
        },
        {
          name: 'LogAttributeItems',
          type: 'Array(String)',
          default_type: 'MATERIALIZED',
          default_expression:
            "arrayMap((arr) -> concat(arr.1, '=', arr.2), LogAttributes::Array(Tuple(String, String)))",
        },
      ]);
      mockMetadata.getSkipIndices = jest.fn().mockResolvedValue([
        {
          name: 'idx_log_attr_items',
          type: 'text',
          typeFull: 'text(tokenizer=array)',
          expression: 'LogAttributeItems',
          granularity: 10000000,
        },
      ]);
      mockMetadata.getServerVersion = jest
        .fn()
        .mockResolvedValue([26, 5, 0, 0]);
      mockMetadata.getMaterializedColumnsLookupTable = jest
        .fn()
        .mockResolvedValue(new Map());
    };

    const buildConfig = (condition: string): ChartConfigWithOptDateRange => ({
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      select: [{ aggFn: 'count', valueExpression: '' }],
      where: '',
      whereLanguage: 'sql',
      filters: [{ type: 'sql', condition }],
      timestampValueExpression: 'Timestamp',
      dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
      granularity: '1 minute',
    });

    it('rewrites `Map[key] = value` to has() when a KV items column exists', async () => {
      stubKvItemsMetadata();
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          buildConfig("LogAttributes['service.name'] = 'api'"),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain(
        "has(`LogAttributeItems`, concat('service.name', '=', 'api'))",
      );
      expect(sql).not.toContain("LogAttributes['service.name'] = 'api'");
    });

    it('rewrites `Map[key] IN (one)` to has()', async () => {
      stubKvItemsMetadata();
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          buildConfig("LogAttributes['service.name'] IN ('api')"),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain(
        "has(`LogAttributeItems`, concat('service.name', '=', 'api'))",
      );
    });

    it('rewrites `Map[key] IN (many)` to hasAny(... array(...))', async () => {
      stubKvItemsMetadata();
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          buildConfig("LogAttributes['k'] IN ('a', 'b', 'c')"),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain(
        "hasAny(`LogAttributeItems`, array(concat('k', '=', 'a'), concat('k', '=', 'b'), concat('k', '=', 'c')))",
      );
    });

    it('leaves the condition unchanged when no KV items column exists', async () => {
      mockMetadata.getColumns = jest.fn().mockResolvedValue([
        {
          name: 'LogAttributes',
          type: 'Map(String, String)',
          default_type: '',
          default_expression: '',
        },
      ]);
      mockMetadata.getSkipIndices = jest.fn().mockResolvedValue([]);
      mockMetadata.getServerVersion = jest
        .fn()
        .mockResolvedValue([26, 5, 0, 0]);
      mockMetadata.getMaterializedColumnsLookupTable = jest
        .fn()
        .mockResolvedValue(new Map());

      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          buildConfig("LogAttributes['k'] = 'v'"),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain("LogAttributes['k'] = 'v'");
      expect(sql).not.toContain('has(');
    });

    it('does not rewrite when value is empty (Map[k]= preserves missing-key semantics)', async () => {
      stubKvItemsMetadata();
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          buildConfig("LogAttributes['k'] = ''"),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain("LogAttributes['k'] = ''");
      expect(sql).not.toContain('has(');
    });

    it('rewrites only the matching Map subscript in a compound AND condition', async () => {
      stubKvItemsMetadata();
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          buildConfig(
            "LogAttributes['service.name'] = 'api' AND SeverityText = 'error'",
          ),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain(
        "has(`LogAttributeItems`, concat('service.name', '=', 'api'))",
      );
      expect(sql).toContain("SeverityText = 'error'");
    });
  });

  describe('k8s semantic convention migrations', () => {
    it('should generate SQL with metricNameSql for k8s.pod.cpu.utilization gauge metric', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Value',
            metricName: 'k8s.pod.cpu.utilization',
            metricNameSql:
              "MetricName IN ('k8s.pod.cpu.utilization', 'k8s.pod.cpu.usage')",
            metricType: MetricsDataType.Gauge,
          },
        ],
        where: '',
        whereLanguage: 'lucene',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '1 minute',
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      // Verify the SQL contains the IN-based metric name condition
      expect(actual).toContain('k8s.pod.cpu.utilization');
      expect(actual).toContain('k8s.pod.cpu.usage');
      expect(actual).toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL with metricNameSql for k8s.node.cpu.utilization sum metric', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'max',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Value',
            metricName: 'k8s.node.cpu.utilization',
            metricNameSql:
              "MetricName IN ('k8s.node.cpu.utilization', 'k8s.node.cpu.usage')",
            metricType: MetricsDataType.Sum,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '5 minute',
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain('k8s.node.cpu.utilization');
      expect(actual).toContain('k8s.node.cpu.usage');
      expect(actual).toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL with metricNameSql for container.cpu.utilization histogram metric', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.95,
            valueExpression: 'Value',
            metricName: 'container.cpu.utilization',
            metricNameSql:
              "MetricName IN ('container.cpu.utilization', 'container.cpu.usage')",
            metricType: MetricsDataType.Histogram,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '2 minute',
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain('container.cpu.utilization');
      expect(actual).toContain('container.cpu.usage');
      expect(actual).toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL with metricNameSql for histogram metric with groupBy', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'quantile',
            level: 0.99,
            valueExpression: 'Value',
            metricName: 'k8s.pod.cpu.utilization',
            metricNameSql:
              "MetricName IN ('k8s.pod.cpu.utilization', 'k8s.pod.cpu.usage')",
            metricType: MetricsDataType.Histogram,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '1 minute',
        groupBy: `ResourceAttributes['k8s.pod.name']`,
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain('k8s.pod.cpu.utilization');
      expect(actual).toContain('k8s.pod.cpu.usage');
      expect(actual).toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });

    it('should handle metrics without metricNameSql (backward compatibility)', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: 'otel_metrics_summary',
          'exponential histogram': 'otel_metrics_exponential_histogram',
        },
        from: {
          databaseName: 'default',
          tableName: '',
        },
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Value',
            metricName: 'some.regular.metric',
            // No metricNameSql provided
            metricType: MetricsDataType.Gauge,
          },
        ],
        where: '',
        whereLanguage: 'lucene',
        timestampValueExpression: 'TimeUnix',
        dateRange: [new Date('2025-02-12'), new Date('2025-12-14')],
        granularity: '1 minute',
        limit: { limit: 10 },
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      // Should use the simple string comparison for regular metrics (not IN-based)
      expect(actual).toContain("MetricName = 'some.regular.metric'");
      expect(actual).not.toMatch(/MetricName IN /);
      expect(actual).toMatchSnapshot();
    });
  });

  describe('HAVING clause', () => {
    it('should render HAVING clause with SQL language', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        having: 'count(*) > 100',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('HAVING');
      expect(actual).toContain('count(*) > 100');
      expect(actual).toMatchSnapshot();
    });

    it('should render HAVING clause with multiple conditions', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'metrics',
        },
        select: [
          {
            aggFn: 'avg',
            valueExpression: 'response_time',
            aggCondition: '',
          },
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'endpoint',
        having: 'avg(response_time) > 500 AND count(*) > 10',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('HAVING');
      expect(actual).toContain('avg(response_time) > 500 AND count(*) > 10');
      expect(actual).toMatchSnapshot();
    });

    it('should not render HAVING clause when not provided', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).not.toContain('HAVING');
      expect(actual).toMatchSnapshot();
    });

    it('should render HAVING clause with granularity and groupBy', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'events',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'event_type',
        having: 'count(*) > 50',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
        granularity: '5 minute',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('HAVING');
      expect(actual).toContain('count(*) > 50');
      expect(actual).toContain('GROUP BY');
      expect(actual).toMatchSnapshot();
    });

    it('should not render HAVING clause when having is empty string', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        having: '',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).not.toContain('HAVING');
      expect(actual).toMatchSnapshot();
    });
  });

  describe('timeFilterExpr', () => {
    type TimeFilterExprTestCase = {
      timestampValueExpression: string;
      dateRangeStartInclusive?: boolean;
      dateRangeEndInclusive?: boolean;
      dateRange: [Date, Date];
      includedDataInterval?: string;
      expected: string;
      description: string;
      tableName?: string;
      databaseName?: string;
      primaryKey?: string;
    };

    const testCases: TimeFilterExprTestCase[] = [
      {
        description: 'with basic timestampValueExpression',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(timestamp >= fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}) AND timestamp <= fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}))`,
      },
      {
        description: 'with dateRangeEndInclusive=false',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        dateRangeEndInclusive: false,
        expected: `(timestamp >= fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}) AND timestamp < fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}))`,
      },
      {
        description: 'with dateRangeStartInclusive=false',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        dateRangeStartInclusive: false,
        expected: `(timestamp > fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}) AND timestamp <= fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}))`,
      },
      {
        description: 'with includedDataInterval',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        includedDataInterval: '1 WEEK',
        expected: `(timestamp >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}), INTERVAL 1 WEEK) - INTERVAL 1 WEEK AND timestamp <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}), INTERVAL 1 WEEK) + INTERVAL 1 WEEK)`,
      },
      {
        description: 'with date type timestampValueExpression',
        timestampValueExpression: 'date',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(date >= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()})) AND date <= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()})))`,
      },
      {
        description: 'with multiple timestampValueExpression parts',
        timestampValueExpression: 'timestamp, date',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(timestamp >= fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}) AND timestamp <= fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}))AND(date >= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()})) AND date <= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()})))`,
      },
      {
        description: 'with toStartOfDay() in timestampExpr',
        timestampValueExpression: 'toStartOfDay(timestamp)',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfDay(timestamp) >= toStartOfDay(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()})) AND toStartOfDay(timestamp) <= toStartOfDay(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()})))`,
      },
      {
        description: 'with toStartOfDay  () in timestampExpr',
        timestampValueExpression: 'toStartOfDay  (timestamp)',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfDay  (timestamp) >= toStartOfDay(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()})) AND toStartOfDay  (timestamp) <= toStartOfDay(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()})))`,
      },
      {
        description: 'with toStartOfInterval() in timestampExpr',
        timestampValueExpression:
          'toStartOfInterval(timestamp, INTERVAL 12  MINUTE)',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfInterval(timestamp, INTERVAL 12  MINUTE) >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}), INTERVAL 12  MINUTE) AND toStartOfInterval(timestamp, INTERVAL 12  MINUTE) <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}), INTERVAL 12  MINUTE))`,
      },
      {
        description:
          'with toStartOfInterval() with lowercase interval in timestampExpr',
        timestampValueExpression:
          'toStartOfInterval(timestamp, interval 1 minute)',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfInterval(timestamp, interval 1 minute) >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}), interval 1 minute) AND toStartOfInterval(timestamp, interval 1 minute) <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}), interval 1 minute))`,
      },
      {
        description: 'with toStartOfInterval() with timezone and offset',
        timestampValueExpression: `toStartOfInterval(timestamp, INTERVAL 1 MINUTE, toDateTime('2023-01-01 14:35:30'), 'America/New_York')`,
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfInterval(timestamp, INTERVAL 1 MINUTE, toDateTime('2023-01-01 14:35:30'), 'America/New_York') >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}), INTERVAL 1 MINUTE, toDateTime('2023-01-01 14:35:30'), 'America/New_York') AND toStartOfInterval(timestamp, INTERVAL 1 MINUTE, toDateTime('2023-01-01 14:35:30'), 'America/New_York') <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}), INTERVAL 1 MINUTE, toDateTime('2023-01-01 14:35:30'), 'America/New_York'))`,
      },
      {
        description: 'with nonstandard spacing',
        timestampValueExpression: ` toStartOfInterval ( timestamp ,  INTERVAL  1 MINUTE , toDateTime ( '2023-01-01 14:35:30' ),  'America/New_York' ) `,
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(toStartOfInterval ( timestamp ,  INTERVAL  1 MINUTE , toDateTime ( '2023-01-01 14:35:30' ),  'America/New_York' ) >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 00:12:34Z').getTime()}), INTERVAL  1 MINUTE, toDateTime ( '2023-01-01 14:35:30' ), 'America/New_York') AND toStartOfInterval ( timestamp ,  INTERVAL  1 MINUTE , toDateTime ( '2023-01-01 14:35:30' ),  'America/New_York' ) <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-14 00:12:34Z').getTime()}), INTERVAL  1 MINUTE, toDateTime ( '2023-01-01 14:35:30' ), 'America/New_York'))`,
      },
      {
        description: 'with optimizable timestampValueExpression',
        timestampValueExpression: `timestamp`,
        primaryKey:
          "toStartOfMinute(timestamp), ServiceName, ResourceAttributes['timestamp'], timestamp",
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(timestamp >= fromUnixTimestamp64Milli(1739319154000) AND timestamp <= fromUnixTimestamp64Milli(1739491954000))AND(toStartOfMinute(timestamp) >= toStartOfMinute(fromUnixTimestamp64Milli(1739319154000)) AND toStartOfMinute(timestamp) <= toStartOfMinute(fromUnixTimestamp64Milli(1739491954000)))`,
      },
      {
        description: 'with synthetic timestamp value expression for CTE',
        timestampValueExpression: `__hdx_time_bucket`,
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        databaseName: '',
        tableName: 'Bucketed',
        primaryKey:
          "toStartOfMinute(timestamp), ServiceName, ResourceAttributes['timestamp'], timestamp",
        expected: `(__hdx_time_bucket >= fromUnixTimestamp64Milli(1739319154000) AND __hdx_time_bucket <= fromUnixTimestamp64Milli(1739491954000))`,
      },

      {
        description: 'with toStartOfMinute in timestampValueExpression',
        timestampValueExpression: `toStartOfMinute(timestamp)`,
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        primaryKey:
          "toStartOfMinute(timestamp), ServiceName, ResourceAttributes['timestamp'], timestamp",
        expected: `(toStartOfMinute(timestamp) >= toStartOfMinute(fromUnixTimestamp64Milli(1739319154000)) AND toStartOfMinute(timestamp) <= toStartOfMinute(fromUnixTimestamp64Milli(1739491954000)))`,
      },
      {
        description:
          'with wrapped toStartOfInterval in primary key (should not optimize)',
        timestampValueExpression: `timestamp`,
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        primaryKey:
          '-toInt64(toStartOfInterval(timestamp, toIntervalMinute(15))), service_id, timestamp',
        expected: `(timestamp >= fromUnixTimestamp64Milli(1739319154000) AND timestamp <= fromUnixTimestamp64Milli(1739491954000))`,
      },
      {
        description:
          'with toStartOfHour and dateRangeEndInclusive=false (must stay inclusive on coarse filter)',
        timestampValueExpression: 'toStartOfHour(timestamp)',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeEndInclusive: false,
        expected: `(toStartOfHour(timestamp) >= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()})) AND toStartOfHour(timestamp) <= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()})))`,
      },
      {
        description:
          'with compound expression and dateRangeEndInclusive=false (raw col exclusive, toStartOf inclusive)',
        timestampValueExpression: 'timestamp, toStartOfHour(timestamp)',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeEndInclusive: false,
        expected: `(timestamp >= fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()}) AND timestamp < fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()}))AND(toStartOfHour(timestamp) >= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()})) AND toStartOfHour(timestamp) <= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()})))`,
      },
      {
        description:
          'with toStartOfHour and dateRangeStartInclusive=false (must stay inclusive on coarse filter)',
        timestampValueExpression: 'toStartOfHour(timestamp)',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeStartInclusive: false,
        expected: `(toStartOfHour(timestamp) >= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()})) AND toStartOfHour(timestamp) <= toStartOfHour(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()})))`,
      },
      {
        description: 'stays inclusive with date-type column',
        timestampValueExpression: 'date',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeStartInclusive: false,
        dateRangeEndInclusive: false,
        expected: `(date >= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()})) AND date <= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()})))`,
      },
      {
        description:
          'stays inclusive for date-type column in multi-column timestampValueExpression',
        timestampValueExpression: 'date, timestamp',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeStartInclusive: false,
        dateRangeEndInclusive: false,
        expected: `(date >= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()})) AND date <= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()})))AND(timestamp > fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()}) AND timestamp < fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()}))`,
      },
      {
        description: 'stays inclusive for toDate column',
        timestampValueExpression: 'toDate(timestamp)',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeStartInclusive: false,
        dateRangeEndInclusive: false,
        expected: `(toDate(timestamp) >= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()})) AND toDate(timestamp) <= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()})))`,
      },
      {
        description:
          'stays inclusive for toDate column in multi-column timestampValueExpression',
        timestampValueExpression: 'toDate(timestamp), timestamp',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeStartInclusive: false,
        dateRangeEndInclusive: false,
        expected: `(toDate(timestamp) >= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()})) AND toDate(timestamp) <= toDate(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()})))AND(timestamp > fromUnixTimestamp64Milli(${new Date('2025-02-12 03:53:38Z').getTime()}) AND timestamp < fromUnixTimestamp64Milli(${new Date('2025-02-12 04:08:38Z').getTime()}))`,
      },
    ];

    beforeEach(() => {
      mockMetadata.getColumn.mockImplementation(async ({ column }) =>
        column === 'date'
          ? ({ type: 'Date' } as ColumnMeta)
          : ({ type: 'DateTime' } as ColumnMeta),
      );
    });

    it.each(testCases)(
      'should generate a time filter expression $description',
      async ({
        timestampValueExpression,
        dateRangeEndInclusive = true,
        dateRangeStartInclusive = true,
        dateRange,
        expected,
        includedDataInterval,
        tableName = 'target_table',
        databaseName = 'default',
        primaryKey,
      }) => {
        if (primaryKey) {
          mockMetadata.getTableMetadata.mockResolvedValue({
            primary_key: primaryKey,
          } as any);
        }

        const actual = await timeFilterExpr({
          timestampValueExpression,
          dateRangeEndInclusive,
          dateRangeStartInclusive,
          dateRange,
          connectionId: 'test-connection',
          databaseName,
          tableName,
          metadata: mockMetadata,
          includedDataInterval,
        });

        const actualSql = parameterizedQueryToSql(actual);
        expect(actualSql).toBe(expected);
      },
    );

    it('stays inclusive for date-type column with non-subquery with clauses', async () => {
      const dateRange: [Date, Date] = [
        new Date('2025-02-12 03:53:38Z'),
        new Date('2025-02-12 04:08:38Z'),
      ];

      const actual = await timeFilterExpr({
        timestampValueExpression: 'date',
        dateRangeEndInclusive: false,
        dateRangeStartInclusive: false,
        dateRange,
        connectionId: 'test-connection',
        databaseName: 'default',
        tableName: 'target_table',
        metadata: mockMetadata,
        with: [
          {
            name: 'service',
            sql: { sql: 'ServiceName', params: {} },
            isSubquery: false,
          },
        ],
      });

      const actualSql = parameterizedQueryToSql(actual);
      expect(actualSql).toBe(
        `(date >= toDate(fromUnixTimestamp64Milli(${dateRange[0].getTime()})) AND date <= toDate(fromUnixTimestamp64Milli(${dateRange[1].getTime()})))`,
      );
    });

    it('wraps Date-type column in toDate() when a subquery CTE is present and FROM is a base table', async () => {
      // Repro for HDX-4247: when a subquery CTE is added to the outer chart
      // config (e.g. sampling CTE in the Event Patterns panel) but the outer
      // query still selects from a real base table, the time-filter must still
      // detect that the partition column is Date-typed and wrap the bounds in
      // toDate(). Otherwise ClickHouse promotes Date -> DateTime at midnight
      // and the entire day's rows are excluded.
      const dateRange: [Date, Date] = [
        new Date('2025-02-12 03:53:38Z'),
        new Date('2025-02-12 04:08:38Z'),
      ];

      const actual = await timeFilterExpr({
        timestampValueExpression: 'date',
        dateRangeEndInclusive: true,
        dateRangeStartInclusive: true,
        dateRange,
        connectionId: 'test-connection',
        databaseName: 'default',
        tableName: 'target_table',
        metadata: mockMetadata,
        with: [
          {
            name: 'tableStats',
            sql: {
              sql: 'SELECT count() as total FROM target_table',
              params: {},
            },
            // isSubquery defaults to true -> exercises the subquery-CTE path
          },
        ],
      });

      const actualSql = parameterizedQueryToSql(actual);
      expect(actualSql).toBe(
        `(date >= toDate(fromUnixTimestamp64Milli(${dateRange[0].getTime()})) AND date <= toDate(fromUnixTimestamp64Milli(${dateRange[1].getTime()})))`,
      );
    });
  });

  it('should not generate invalid SQL when primary key wraps toStartOfInterval', async () => {
    mockMetadata.getTableMetadata.mockResolvedValue({
      primary_key:
        'proxy_tier, status, is_customer_content, -toInt64(toStartOfInterval(timestamp, toIntervalMinute(15))), service_id',
    } as any);

    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Table,
      connection: 'test-connection',
      from: {
        databaseName: 'default',
        tableName: 'http_request_logs',
      },
      select: 'timestamp, cluster_id, service_id',
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'timestamp',
      dateRange: [
        new Date('2025-02-12 00:12:34Z'),
        new Date('2025-02-14 00:12:34Z'),
      ],
      limit: { limit: 200, offset: 0 },
    };

    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).not.toContain('toStartOfInterval(fromUnixTimestamp64Milli');
    expect(actual).toMatchSnapshot();
  });

  describe('Aggregate Merge Functions', () => {
    it('should generate SQL for an aggregate merge function', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'avgMerge',
            valueExpression: 'Duration',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('avgMerge(Duration)');
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL for an aggregate merge function with a condition', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'avgMerge',
            valueExpression: 'Duration',
            aggCondition: 'severity:"ERROR"',
            aggConditionLanguage: 'lucene',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "avgMergeIf(Duration, ((severity = 'ERROR')) AND toFloat64OrDefault(toString(Duration)) IS NOT NULL)",
      );
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL for an quantile merge function with a condition', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'quantileMerge',
            aggCondition: 'severity:"ERROR"',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Duration',
            level: 0.95,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "quantileMergeIf(0.95)(Duration, ((severity = 'ERROR')) AND toFloat64OrDefault(toString(Duration)) IS NOT NULL)",
      );
      expect(actual).toMatchSnapshot();
    });

    it('should generate SQL for an histogram merge function', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'histogramMerge',
            valueExpression: 'Duration',
            level: 20,
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('histogramMerge(20)(Duration)');
      expect(actual).toMatchSnapshot();
    });
  });

  describe('SELECT alias references in a Lucene WHERE', () => {
    // ClickHouse resolves SELECT aliases in WHERE. A Lucene WHERE that
    // references a SELECT alias (here `Body AS Content`) must resolve the alias
    // to a bare identifier rather than rendering the no-match predicate.
    it('resolves a Lucene WHERE reference to a SELECT alias', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [{ valueExpression: 'Body', alias: 'Content' }],
        where: 'Content:"swagger"',
        whereLanguage: 'lucene',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain("Content = 'swagger'");
    });

    it('renders an unknown, non-alias field in a Lucene WHERE as the no-match predicate', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [{ valueExpression: 'Body', alias: 'Content' }],
        where: 'NotAColumn:"swagger"',
        whereLanguage: 'lucene',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('(1 = 0)');
      expect(actual).not.toContain('NotAColumn');
    });

    // String-form select lists (e.g. a source's defaultTableSelectExpression)
    // declare aliases as raw SQL. These are parsed to recover the aliases so
    // alias references in a Lucene WHERE still resolve.
    it('resolves a Lucene WHERE reference to an alias in a string-form select', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: 'Body AS Content',
        where: 'Content:"swagger"',
        whereLanguage: 'lucene',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain("Content = 'swagger'");
    });

    it('resolves an alias from a realistic default-view string select', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: 'Timestamp, ServiceName as service, Body',
        where: 'service:"prod"',
        whereLanguage: 'lucene',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain("service = 'prod'");
    });

    it('renders an unknown field as the no-match predicate when a string select declares no matching alias', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: 'Timestamp, Body',
        where: 'NotAColumn:"x"',
        whereLanguage: 'lucene',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('(1 = 0)');
      expect(actual).not.toContain('NotAColumn');
    });

    // SAVED_SEARCH alerts select count() while injecting the saved search's
    // select aliases as expression-form WITH clauses (isSubquery: false). A
    // Lucene WHERE referencing such an alias must resolve to the bare
    // identifier, not the no-match predicate.
    it('resolves a Lucene WHERE reference to an expression-form WITH alias', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        with: [
          {
            name: 'Content',
            sql: chSql`toString(Body)`,
            isSubquery: false,
          },
        ],
        select: [{ aggFn: 'count', valueExpression: '' }],
        where: 'Content:"swagger"',
        whereLanguage: 'lucene',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain("Content = 'swagger'");
      expect(actual).not.toContain('(1 = 0)');
    });

    // Subquery CTEs (isSubquery: true) name a table-like source, not a column,
    // so an alias reference to one in a Lucene WHERE is still unknown and must
    // render the no-match predicate.
    it('does not treat a subquery WITH alias as a column reference', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        with: [
          {
            name: 'sub',
            sql: chSql`SELECT 1`,
            isSubquery: true,
          },
        ],
        select: [{ aggFn: 'count', valueExpression: '' }],
        where: 'sub:"x"',
        whereLanguage: 'lucene',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('(1 = 0)');
    });
  });

  describe('SELECT alias references in other Lucene call sites', () => {
    // The main WHERE clause is covered above; these exercise the remaining
    // Lucene-capable call sites in renderChartConfig (filters array,
    // per-aggregate conditions, and HAVING), all of which must resolve SELECT
    // aliases identically to the main WHERE.

    it('resolves a Lucene filter reference to a SELECT alias', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [{ valueExpression: 'Body', alias: 'Content' }],
        where: '',
        filters: [{ type: 'lucene', condition: 'Content:"swagger"' }],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain("Content = 'swagger'");
    });

    it('renders an unknown, non-alias field in a Lucene filter as the no-match predicate', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [{ valueExpression: 'Body', alias: 'Content' }],
        where: '',
        filters: [{ type: 'lucene', condition: 'NotAColumn:"swagger"' }],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('(1 = 0)');
      expect(actual).not.toContain('NotAColumn');
    });

    // A per-aggregate Lucene condition is pushed into the WHERE clause (when
    // every select has one) and also rendered as the aggregate's `...If(...)`
    // predicate. Both paths must resolve the alias. The alias here is an
    // expression-form WITH clause to avoid a select referencing its own alias.
    it('resolves a Lucene per-aggregate condition to a SELECT alias', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        with: [
          {
            name: 'Content',
            sql: chSql`toString(Body)`,
            isSubquery: false,
          },
        ],
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: 'Content:"swagger"',
            aggConditionLanguage: 'lucene',
          },
        ],
        where: '',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain("Content = 'swagger'");
      expect(actual).not.toContain('(1 = 0)');
    });

    it('renders an unknown per-aggregate Lucene field as the no-match predicate', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: 'NotAColumn:"swagger"',
            aggConditionLanguage: 'lucene',
          },
        ],
        where: '',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('(1 = 0)');
      expect(actual).not.toContain('NotAColumn');
    });

    // A Lucene value expression (aggFn omitted, valueExpressionLanguage: lucene)
    // is rendered as a SELECT column expression and must resolve aliases too.
    it('resolves a Lucene value expression reference to a SELECT alias', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        with: [
          {
            name: 'Content',
            sql: chSql`toString(Body)`,
            isSubquery: false,
          },
        ],
        select: [
          {
            valueExpression: 'Content:"swagger"',
            valueExpressionLanguage: 'lucene',
            alias: 'matched',
          },
        ],
        where: '',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain("Content = 'swagger'");
      expect(actual).not.toContain('(1 = 0)');
    });

    // ClickHouse resolves SELECT aliases in HAVING, so a Lucene HAVING that
    // references an alias must resolve it rather than render the no-match
    // predicate.
    it('resolves a Lucene HAVING reference to a SELECT alias', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [{ valueExpression: 'Body', alias: 'Content' }],
        where: '',
        having: 'Content:"swagger"',
        havingLanguage: 'lucene',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain("Content = 'swagger'");
    });

    it('renders an unknown, non-alias field in a Lucene HAVING as the no-match predicate', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [{ valueExpression: 'Body', alias: 'Content' }],
        where: '',
        having: 'NotAColumn:"swagger"',
        havingLanguage: 'lucene',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('(1 = 0)');
      expect(actual).not.toContain('NotAColumn');
    });
  });

  describe('SETTINGS clause', () => {
    const config: ChartConfigWithOptDateRangeEx = {
      displayType: DisplayType.Table,
      connection: 'test-connection',
      from: {
        databaseName: 'default',
        tableName: 'logs',
      },
      select: [
        {
          aggFn: 'histogramMerge',
          valueExpression: 'Duration',
          level: 20,
        },
      ],
      where: '',
      whereLanguage: 'sql',
      groupBy: 'severity',
      timestampValueExpression: 'timestamp',
      dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
    };

    test('should apply the "query settings" settings to the query', async () => {
      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );

      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "SETTINGS optimize_read_in_order = 0, cast_keep_nullable = 1, additional_result_filter = 'x != 2', count_distinct_implementation = 'uniqCombined64', async_insert_busy_timeout_min_ms = 20000",
      );
      expect(actual).toMatchSnapshot();
    });

    test('should apply the "chart config" settings to the query', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...config,
          settings: chSql`short_circuit_function_evaluation = 'force_enable'`,
        },
        mockMetadata,
        querySettings,
      );

      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "SETTINGS short_circuit_function_evaluation = 'force_enable'",
      );
      expect(actual).toMatchSnapshot();
    });

    test('should concat the "chart config" and "query setting" settings and apply them to the query', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...config,
          settings: chSql`short_circuit_function_evaluation = 'force_enable'`,
        },
        mockMetadata,
        querySettings,
      );

      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "SETTINGS short_circuit_function_evaluation = 'force_enable', optimize_read_in_order = 0, cast_keep_nullable = 1, additional_result_filter = 'x != 2', count_distinct_implementation = 'uniqCombined64', async_insert_busy_timeout_min_ms = 20000",
      );
      expect(actual).toMatchSnapshot();
    });
  });

  it('returns sqlTemplate verbatim for raw sql config', async () => {
    const rawSqlConfig: ChartConfigWithOptDateRangeEx = {
      configType: 'sql',
      sqlTemplate: 'SELECT count() FROM logs WHERE level = {level:String}',
      connection: 'conn-1',
    };
    const result = await renderChartConfig(
      rawSqlConfig,
      mockMetadata,
      undefined,
    );
    expect(result.sql).toBe(
      'SELECT count() FROM logs WHERE level = {level:String}',
    );
    expect(result.params).toEqual({
      startDateMilliseconds: undefined,
      endDateMilliseconds: undefined,
    });
  });

  it('injects startDateMilliseconds and endDateMilliseconds params for raw sql config with dateRange', async () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-02T00:00:00.000Z');
    const rawSqlConfig: ChartConfigWithOptDateRangeEx = {
      configType: 'sql',
      sqlTemplate:
        'SELECT count() FROM logs WHERE ts BETWEEN {startDateMilliseconds:Int64} AND {endDateMilliseconds:Int64}',
      connection: 'conn-1',
      dateRange: [start, end],
    };
    const result = await renderChartConfig(
      rawSqlConfig,
      mockMetadata,
      undefined,
    );
    expect(result.sql).toBe(
      'SELECT count() FROM logs WHERE ts BETWEEN {startDateMilliseconds:Int64} AND {endDateMilliseconds:Int64}',
    );
    expect(result.params).toEqual({
      startDateMilliseconds: start.getTime(),
      endDateMilliseconds: end.getTime(),
    });
  });

  describe('raw sql macro replacement', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-02T00:00:00.000Z');

    it('replaces $__dateFilter macro in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__dateFilter(d)',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
      );
      expect(result.params.startDateMilliseconds).toBe(start.getTime());
      expect(result.params.endDateMilliseconds).toBe(end.getTime());
    });

    it('replaces $__timeFilter macro in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__timeFilter(ts)',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
      );
    });

    it('replaces $__timeFilter_ms macro in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__timeFilter_ms(ts)',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE ts >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND ts <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
      );
    });

    it('replaces $__fromTime and $__toTime macros in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate:
            'SELECT * FROM logs WHERE ts >= $__fromTime AND ts <= $__toTime',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
      );
    });

    it('replaces $__fromTime_ms and $__toTime_ms macros in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate:
            'SELECT * FROM logs WHERE ts >= $__fromTime_ms AND ts <= $__toTime_ms',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE ts >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND ts <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
      );
    });

    it('replaces $__dateTimeFilter macro in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__dateTimeFilter(d, ts)',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))) AND (ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64})))',
      );
    });

    it('replaces $__timeInterval macro in raw sql Line config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate:
            'SELECT $__timeInterval(ts) AS t, count() FROM logs WHERE $__timeFilter(ts) GROUP BY t',
          connection: 'conn-1',
          displayType: DisplayType.Line,
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toContain(
        'toStartOfInterval(toDateTime(ts), INTERVAL {intervalSeconds:Int64} second)',
      );
      expect(result.sql).toContain(
        'ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64}))',
      );
      expect(result.params.intervalSeconds).toBeGreaterThan(0);
    });

    it('replaces $__interval_s macro in raw sql config', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate:
            'SELECT toStartOfInterval(ts, INTERVAL $__interval_s second) FROM logs',
          connection: 'conn-1',
          displayType: DisplayType.Line,
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT toStartOfInterval(ts, INTERVAL {intervalSeconds:Int64} second) FROM logs',
      );
      expect(result.params.intervalSeconds).toBeGreaterThan(0);
    });

    it('passes through raw sql with no macros unchanged', async () => {
      const sql =
        'SELECT count() FROM logs WHERE ts >= {startDateMilliseconds:Int64}';
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: sql,
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(sql);
    });

    it('replaces $__filters macro with rendered filter conditions', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate:
            'SELECT * FROM logs WHERE $__timeFilter(ts) AND $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: 'logs' },
          filters: [
            { type: 'sql', condition: "ServiceName = 'api'" },
            { type: 'sql_ast', operator: '>', left: 'duration', right: '100' },
          ],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toContain(
        "AND ((ServiceName = 'api') AND (duration > 100))",
      );
    });

    it('replaces $__filters with 1 = 1 when no filters provided', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });

    it('replaces $__filters with 1 = 1 when source and from are defined but filters is empty', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: 'logs' },
          filters: [],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });

    it('renders lucene filters to SQL in $__filters when source is specified', async () => {
      mockMetadata.getMaterializedColumnsLookupTable = jest
        .fn()
        .mockResolvedValue(new Map());
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: 'logs' },
          implicitColumnExpression: 'Body',
          filters: [{ type: 'lucene', condition: 'ServiceName:api' }],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        "SELECT * FROM logs WHERE (((ServiceName ILIKE '%api%')))",
      );
    });

    it('renders mixed lucene and sql filters in $__filters', async () => {
      mockMetadata.getMaterializedColumnsLookupTable = jest
        .fn()
        .mockResolvedValue(new Map());
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: 'logs' },
          implicitColumnExpression: 'Body',
          filters: [
            { type: 'lucene', condition: 'ServiceName:api' },
            { type: 'sql', condition: 'duration > 100' },
          ],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        "SELECT * FROM logs WHERE (((ServiceName ILIKE '%api%')) AND (duration > 100))",
      );
    });

    it('renders sql filters raw when source has no tableName (metric source)', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: '' },
          filters: [
            { type: 'sql', condition: 'duration > 100' },
            { type: 'sql_ast', operator: '=', left: 'status', right: "'ok'" },
          ],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        "SELECT * FROM logs WHERE ((duration > 100) AND (status = 'ok'))",
      );
    });

    it('skips empty sql filters when source has no tableName (metric source)', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: '' },
          filters: [{ type: 'sql', condition: '' }],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });

    it('skips filters without source metadata (no from)', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          filters: [
            { type: 'lucene', condition: 'ServiceName:api' },
            { type: 'sql', condition: 'duration > 100' },
          ],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });
  });

  it('bare-text Lucene where uses bodyExpression when implicitColumnExpression is unset', async () => {
    // A ChartConfig with only bodyExpression (no implicitColumnExpression) must
    // route bare-text Lucene search through the body column end-to-end.
    mockMetadata.getMaterializedColumnsLookupTable = jest
      .fn()
      .mockResolvedValue(new Map());
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Table,
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      select: [{ aggFn: 'count', valueExpression: '', aggCondition: '' }],
      where: 'Prometheus',
      whereLanguage: 'lucene',
      timestampValueExpression: 'Timestamp',
      bodyExpression: 'Body',
      dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
    };
    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      undefined,
    );
    const sql = parameterizedQueryToSql(generatedSql);
    // The bare-text term should filter against the body column, not throw.
    expect(sql).toMatch(/lower\(Body\)/);
  });

  it('bare-text Lucene in aggCondition and filters uses bodyExpression when implicitColumnExpression is unset', async () => {
    // bodyExpression is threaded through renderChartConfig into
    // aggCondition serialization and the filters list, not only `where`.
    // Pins the threading contract for those two paths beyond the
    // top-level where (covered by the test above).
    mockMetadata.getMaterializedColumnsLookupTable = jest
      .fn()
      .mockResolvedValue(new Map());
    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Table,
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      select: [
        {
          aggFn: 'count',
          valueExpression: '',
          aggCondition: 'errored',
          aggConditionLanguage: 'lucene',
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'Timestamp',
      bodyExpression: 'Body',
      filters: [{ type: 'lucene', condition: 'denied' }],
      dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
    };
    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      undefined,
    );
    const sql = parameterizedQueryToSql(generatedSql);
    // Both the aggCondition term ('errored') and the filters term
    // ('denied') should filter against the body column. The mockMetadata
    // here has no bloom filter / text indices, so bare tokens render
    // via hasToken(lower(<col>), lower(<term>)) instead of LIKE.
    expect(sql).toContain("hasToken(lower(Body), lower('errored'))");
    expect(sql).toContain("hasToken(lower(Body), lower('denied'))");
  });

  describe('sample-weighted aggregations', () => {
    const baseSampledConfig: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Table,
      connection: 'test-connection',
      from: {
        databaseName: 'default',
        tableName: 'otel_traces',
      },
      select: [],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'Timestamp',
      sampleWeightExpression: 'SampleRate',
      dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
    };

    it('should rewrite count() to sum(greatest(...))', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: '',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        'greatest(toUInt64OrZero(toString(SampleRate)), 1)',
      );
      expect(actual).toContain('sum(');
      expect(actual).not.toContain('count()');
      expect(actual).toMatchSnapshot();
    });

    it('should rewrite countIf to sumIf(greatest(...), cond)', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: "StatusCode = 'Error'",
            aggConditionLanguage: 'sql',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        'sumIf(greatest(toUInt64OrZero(toString(SampleRate)), 1)',
      );
      expect(actual).not.toContain('countIf');
      expect(actual).toMatchSnapshot();
    });

    it('should rewrite avg to weighted average', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'avg',
            valueExpression: 'Duration',
            aggCondition: '',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        '* greatest(toUInt64OrZero(toString(SampleRate)), 1)',
      );
      expect(actual).toContain(
        '/ nullIf(sumIf(greatest(toUInt64OrZero(toString(SampleRate)), 1), toFloat64OrDefault(toString(Duration)) IS NOT NULL), 0)',
      );
      expect(actual).not.toContain('avg(');
      expect(actual).toMatchSnapshot();
    });

    it('should rewrite sum to weighted sum', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'sum',
            valueExpression: 'Duration',
            aggCondition: '',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        '* greatest(toUInt64OrZero(toString(SampleRate)), 1)',
      );
      expect(actual).toMatchSnapshot();
    });

    it('should rewrite quantile to quantileTDigestWeighted', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'quantile',
            valueExpression: 'Duration',
            aggCondition: '',
            level: 0.99,
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('quantileTDigestWeighted(0.99)');
      expect(actual).toContain(
        'toUInt32(greatest(toUInt64OrZero(toString(SampleRate)), 1))',
      );
      expect(actual).not.toContain('quantile(0.99)');
      expect(actual).toMatchSnapshot();
    });

    it('should leave min/max unchanged with sampleWeightExpression', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'min',
            valueExpression: 'Duration',
            aggCondition: '',
          },
          {
            aggFn: 'max',
            valueExpression: 'Duration',
            aggCondition: '',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('min(');
      expect(actual).toContain('max(');
      expect(actual).not.toContain('SampleRate');
      expect(actual).toMatchSnapshot();
    });

    it('should leave count_distinct unchanged with sampleWeightExpression', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'count_distinct',
            valueExpression: 'TraceId',
            aggCondition: '',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('count(DISTINCT');
      expect(actual).not.toContain('SampleRate');
      expect(actual).toMatchSnapshot();
    });

    it('should handle complex sampleWeightExpression like SpanAttributes map access', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        sampleWeightExpression: "SpanAttributes['SampleRate']",
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: '',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "greatest(toUInt64OrZero(toString(SpanAttributes['SampleRate'])), 1)",
      );
      expect(actual).toContain('sum(');
      expect(actual).not.toContain('count()');
      expect(actual).toMatchSnapshot();
    });

    it('should rewrite avg with where condition', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'avg',
            valueExpression: 'Duration',
            aggCondition: "ServiceName = 'api'",
            aggConditionLanguage: 'sql',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('sumIf(');
      expect(actual).toContain("ServiceName = 'api'");
      expect(actual).not.toContain('avg(');
      expect(actual).toMatchSnapshot();
    });

    it('should rewrite sum with where condition', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'sum',
            valueExpression: 'Duration',
            aggCondition: "ServiceName = 'api'",
            aggConditionLanguage: 'sql',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('sumIf(');
      expect(actual).toContain("ServiceName = 'api'");
      expect(actual).toMatchSnapshot();
    });

    it('should rewrite quantile with where condition', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'quantile',
            valueExpression: 'Duration',
            aggCondition: "ServiceName = 'api'",
            aggConditionLanguage: 'sql',
            level: 0.95,
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('quantileTDigestWeightedIf(0.95)');
      expect(actual).toContain("ServiceName = 'api'");
      expect(actual).not.toContain('quantile(0.95)');
      expect(actual).toMatchSnapshot();
    });

    it('should handle mixed weighted and passthrough aggregations', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: '',
            alias: 'weighted_count',
          },
          {
            aggFn: 'avg',
            valueExpression: 'Duration',
            aggCondition: '',
            alias: 'weighted_avg',
          },
          {
            aggFn: 'min',
            valueExpression: 'Duration',
            aggCondition: '',
            alias: 'min_duration',
          },
          {
            aggFn: 'count_distinct',
            valueExpression: 'TraceId',
            aggCondition: '',
            alias: 'unique_traces',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('sum(');
      expect(actual).toContain('min(');
      expect(actual).toContain('count(DISTINCT');
      expect(actual).not.toContain('count()');
      expect(actual).not.toContain('avg(');
      expect(actual).toMatchSnapshot();
    });

    it('should not rewrite aggregations without sampleWeightExpression', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseSampledConfig,
        sampleWeightExpression: undefined,
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: '',
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('count()');
      expect(actual).not.toContain('SampleRate');
    });
  });

  describe('PromQL chart config', () => {
    it('should return empty SQL (PromQL is executed via Prometheus API)', async () => {
      const promqlConfig: ChartConfigWithOptDateRange = {
        configType: 'promql' as const,
        promqlExpression: 'rate(http_requests_total[5m])',
        connection: 'test-connection',
        displayType: DisplayType.Line,
        dateRange: [
          new Date('2025-01-01T00:00:00Z'),
          new Date('2025-01-01T01:00:00Z'),
        ],
      };

      const generatedSql = await renderChartConfig(
        promqlConfig,
        mockMetadata,
        undefined,
      );

      // PromQL configs return empty SQL — queries go through the Prometheus API route
      expect(generatedSql.sql).toBe('');
      expect(generatedSql.params).toEqual({});
    });
  });

  // HDX-4371: a source with `timestampValueExpression = "EventDate, EventTime"`
  // should bucket on `EventTime` (the DateTime token), not on `EventDate`
  // (the partition-key Date). The WHERE clause keeps using both columns so
  // partition pruning still works.
  describe('multi-column timestampValueExpression (HDX-4371)', () => {
    it('picks the DateTime token for the bucket, keeps the Date in WHERE', async () => {
      mockMetadata.getColumn = jest
        .fn()
        .mockImplementation(async ({ column }: { column: string }) => {
          if (column === 'EventDate')
            return { name: 'EventDate', type: 'Date' };
          if (column === 'EventTime')
            return { name: 'EventTime', type: 'DateTime' };
          return undefined;
        });

      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from: { databaseName: 'default', tableName: 'logs' },
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: '',
            aggConditionLanguage: 'sql',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'EventDate, EventTime',
        dateRange: [
          new Date('2026-05-27T00:00:00Z'),
          new Date('2026-05-27T12:00:00Z'),
        ],
        granularity: '1 minute',
        limit: { limit: 10 },
      };

      const generated = await renderChartConfig(
        config,
        mockMetadata,
        undefined,
      );
      const sql = parameterizedQueryToSql(generated);

      // Bucket uses EventTime (DateTime), not EventDate (Date).
      expect(sql).toContain('toStartOfInterval(toDateTime(EventTime),');
      expect(sql).not.toContain('toStartOfInterval(toDateTime(EventDate),');
      // WHERE clause should still reference both columns for partition pruning.
      expect(sql).toContain('EventDate');
      expect(sql).toContain('EventTime');
    });

    it('all-Date input falls back to the first token (and warns)', async () => {
      mockMetadata.getColumn = jest
        .fn()
        .mockImplementation(async ({ column }: { column: string }) => {
          if (column === 'EventDate')
            return { name: 'EventDate', type: 'Date' };
          if (column === 'OtherDate')
            return { name: 'OtherDate', type: 'Date' };
          return undefined;
        });

      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from: { databaseName: 'default', tableName: 'logs' },
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: '',
            aggConditionLanguage: 'sql',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'EventDate, OtherDate',
        dateRange: [
          new Date('2026-05-27T00:00:00Z'),
          new Date('2026-05-27T12:00:00Z'),
        ],
        granularity: '1 minute',
        limit: { limit: 10 },
      };

      const generated = await renderChartConfig(
        config,
        mockMetadata,
        undefined,
      );
      const sql = parameterizedQueryToSql(generated);

      // Falls back to first token.
      expect(sql).toContain('toStartOfInterval(toDateTime(EventDate),');
    });

    it('single-column EventTime works unchanged (no regression)', async () => {
      mockMetadata.getColumn = jest
        .fn()
        .mockImplementation(async ({ column }: { column: string }) =>
          column === 'EventTime'
            ? { name: 'EventTime', type: 'DateTime' }
            : undefined,
        );

      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from: { databaseName: 'default', tableName: 'logs' },
        select: [
          {
            aggFn: 'count',
            valueExpression: '',
            aggCondition: '',
            aggConditionLanguage: 'sql',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'EventTime',
        dateRange: [
          new Date('2026-05-27T00:00:00Z'),
          new Date('2026-05-27T12:00:00Z'),
        ],
        granularity: '1 minute',
        limit: { limit: 10 },
      };

      const generated = await renderChartConfig(
        config,
        mockMetadata,
        undefined,
      );
      const sql = parameterizedQueryToSql(generated);
      expect(sql).toContain('toStartOfInterval(toDateTime(EventTime),');
    });
  });

  describe('JSON schema (BETA_CH_OTEL_JSON_SCHEMA_ENABLED)', () => {
    // When the ClickHouse exporter uses json: true, attribute columns are JSON
    // type instead of Map(String, String). mapConcat() fails on JSON columns, so
    // cityHash64 receives the JSON columns directly as variadic arguments.

    let jsonSchemaMockMetadata: jest.Mocked<Metadata>;

    beforeEach(() => {
      const jsonSchemaColumns = [
        { name: 'TimeUnix', type: 'DateTime64(9)' },
        { name: 'MetricName', type: 'LowCardinality(String)' },
        { name: 'Attributes', type: 'JSON' },
        { name: 'ScopeAttributes', type: 'JSON' },
        { name: 'ResourceAttributes', type: 'JSON' },
        { name: 'Value', type: 'Float64' },
        { name: 'AggregationTemporality', type: 'Int32' },
      ];
      jsonSchemaMockMetadata = {
        getColumns: jest.fn().mockResolvedValue(jsonSchemaColumns),
        getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(null),
        getColumn: jest
          .fn()
          .mockImplementation(async ({ column }: { column: string }) =>
            jsonSchemaColumns.find(col => col.name === column),
          ),
        getTableMetadata: jest
          .fn()
          .mockResolvedValue({ primary_key: 'TimeUnix' }),
        getSkipIndices: jest.fn().mockResolvedValue([]),
        getSetting: jest.fn().mockResolvedValue(undefined),
      } as unknown as jest.Mocked<Metadata>;
    });

    const baseMetricConfig = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      from: {
        databaseName: 'default',
        tableName: '',
      },
      where: '',
      whereLanguage: 'sql' as const,
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-12-14')] as [
        Date,
        Date,
      ],
      granularity: '1 minute' as const,
      limit: { limit: 10 },
    };

    it('should use direct cityHash64 for gauge metric when Attributes column is JSON type', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseMetricConfig,
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Value',
            metricName: 'system.cpu.utilization',
            metricType: MetricsDataType.Gauge,
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        jsonSchemaMockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain(
        'cityHash64(ScopeAttributes, ResourceAttributes, Attributes)',
      );
      expect(actual).not.toContain('toJSONString');
      expect(actual).not.toContain('mapConcat');
      expect(actual).toMatchSnapshot();
    });

    it('should use direct cityHash64 for sum metric when Attributes column is JSON type', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseMetricConfig,
        granularity: '5 minute',
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Value',
            metricName: 'db.client.connections.usage',
            metricType: MetricsDataType.Sum,
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        jsonSchemaMockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain(
        'cityHash64(ScopeAttributes, ResourceAttributes, Attributes)',
      );
      expect(actual).not.toContain('toJSONString');
      expect(actual).not.toContain('mapConcat');
      expect(actual).toMatchSnapshot();
    });

    it('should use direct cityHash64 for histogram (quantile) metric when Attributes column is JSON type', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseMetricConfig,
        granularity: '2 minute',
        select: [
          {
            aggFn: 'quantile',
            level: 0.95,
            valueExpression: 'Value',
            metricName: 'http.server.duration',
            metricType: MetricsDataType.Histogram,
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        jsonSchemaMockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain(
        'cityHash64(ScopeAttributes, ResourceAttributes, Attributes)',
      );
      expect(actual).not.toContain('toJSONString');
      expect(actual).not.toContain('mapConcat');
      expect(actual).toMatchSnapshot();
    });

    it('should use direct cityHash64 for histogram (count) metric when Attributes column is JSON type', async () => {
      const config: ChartConfigWithOptDateRange = {
        ...baseMetricConfig,
        granularity: '2 minute',
        select: [
          {
            aggFn: 'count',
            valueExpression: 'Value',
            metricName: 'http.server.request.count',
            metricType: MetricsDataType.Histogram,
          },
        ],
      };

      const generatedSql = await renderChartConfig(
        config,
        jsonSchemaMockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain(
        'cityHash64(ScopeAttributes, ResourceAttributes, Attributes)',
      );
      expect(actual).not.toContain('toJSONString');
      expect(actual).not.toContain('mapConcat');
      expect(actual).toMatchSnapshot();
    });

    it('should still use mapConcat when Attributes column is Map type (non-JSON schema)', async () => {
      // Verify existing Map-schema behaviour is unchanged
      const config: ChartConfigWithOptDateRange = {
        ...baseMetricConfig,
        select: [
          {
            aggFn: 'avg',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Value',
            metricName: 'system.cpu.utilization',
            metricType: MetricsDataType.Gauge,
          },
        ],
      };

      // mockMetadata returns Map-typed columns (default setup from beforeEach)
      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);

      expect(actual).toContain('mapConcat');
      expect(actual).not.toContain('toJSONString');
    });
  });
});
