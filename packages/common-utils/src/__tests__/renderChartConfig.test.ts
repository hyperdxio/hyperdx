import { chSql, ColumnMeta, parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/core/metadata';
import {
  ChartConfigWithOptDateRangeEx,
  renderChartConfig,
  timeFilterExpr,
} from '@/core/renderChartConfig';
import {
  BuilderChartConfig,
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
  QuerySettings,
} from '@/types';

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

  it('renders bound values (not template macros) when generateSqlTemplate is unset', async () => {
    // Regression guard for the generateSqlTemplate flag threaded through
    // timeFilterExpr / timeBucketExpr / renderFrom / renderWhere: real query
    // paths never set it, so the output must keep bound params and literals.
    const config: ChartConfigWithOptDateRange = {
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
    const sql = parameterizedQueryToSql(
      await renderChartConfig(config, mockMetadata, querySettings),
    );
    expect(sql).not.toContain('$__');
    expect(sql).toContain('fromUnixTimestamp64Milli(');
    expect(sql).toContain('INTERVAL 5 minute');
    // parameterizedQueryToSql inlines Identifier params without backticks
    expect(sql).toContain('FROM default.logs');
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

      // seriesLimitDateRange alone (no seriesLimit) must not emit a CTE either.
      const sqlWithRangeOnly = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...baseLogsConfig,
            seriesLimitDateRange: baseLogsConfig.dateRange,
          },
          mockMetadata,
          querySettings,
        ),
      );
      expect(sqlWithRangeOnly).not.toContain('__hdx_series_limit');
    });

    it('does not emit a series-limit CTE when seriesLimit is 0 (unlimited)', async () => {
      // 0 = unlimited; must skip the CTE rather than emit `LIMIT 0`.
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          { ...baseLogsConfig, seriesLimit: 0 },
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).not.toContain('__hdx_series_limit');
    });

    it('pins the series-limit CTE to seriesLimitDateRange while the outer query stays windowed', async () => {
      // The chunking caller pins all chunks to one shared ranking range
      // (the newest window); the render layer is agnostic to which range.
      const rankingRange: [Date, Date] = [
        new Date('2025-02-12T00:00:00Z'),
        new Date('2025-02-13T00:00:00Z'),
      ];
      const renderWindow = async (
        dateRange: [Date, Date],
        dateRangeEndInclusive: boolean,
      ) =>
        parameterizedQueryToSql(
          await renderChartConfig(
            {
              ...baseLogsConfig,
              seriesLimit: 60,
              dateRange,
              dateRangeEndInclusive,
              seriesLimitDateRange: rankingRange,
            },
            mockMetadata,
            querySettings,
          ),
        );

      // Two chunked windows of the same chart (most recent window first,
      // older windows are end-exclusive, mirroring fetchDataInChunks).
      const recentChunk = await renderWindow(
        [new Date('2025-02-12T18:00:00Z'), rankingRange[1]],
        true,
      );
      const olderChunk = await renderWindow(
        [rankingRange[0], new Date('2025-02-12T18:00:00Z')],
        false,
      );

      // The CTE end is the first `) SELECT`; the outer query starts there.
      const cteOf = (sql: string) => {
        const start = sql.indexOf('`__hdx_series_limit` AS (');
        const end = sql.indexOf(') SELECT ');
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        return sql.slice(start, end);
      };

      // Both chunks rank over the identical pinned range, so they keep the
      // same top-N set; the windowed range only applies to the outer query.
      expect(cteOf(recentChunk)).toBe(cteOf(olderChunk));
      expect(cteOf(recentChunk)).toContain(String(rankingRange[0].getTime()));
      expect(cteOf(recentChunk)).toContain(String(rankingRange[1].getTime()));
      const outerOf = (sql: string) => sql.slice(sql.indexOf(') SELECT '));
      expect(outerOf(olderChunk)).toContain(
        String(new Date('2025-02-12T18:00:00Z').getTime()),
      );
      expect(outerOf(olderChunk)).not.toContain(
        String(rankingRange[1].getTime()),
      );
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
      // Each column gets its own NULL check, split on the top-level comma, not
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
    describe('a series with no column picked', () => {
      const configWithValueExpression = (
        valueExpression: string,
      ): ChartConfigWithOptDateRange => ({
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from: { databaseName: 'default', tableName: 'otel_logs' },
        select: [{ aggFn: 'quantile', level: 0.99, valueExpression }],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'Timestamp',
        dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
      });

      it('is rejected rather than sent as `toString()` with no argument', async () => {
        await expect(
          renderChartConfig(
            configWithValueExpression(''),
            mockMetadata,
            querySettings,
          ),
        ).rejects.toThrow(
          'Column is required for all non-count aggregation functions',
        );
      });

      it('is still rejected when the column is only whitespace', async () => {
        await expect(
          renderChartConfig(
            configWithValueExpression('   '),
            mockMetadata,
            querySettings,
          ),
        ).rejects.toThrow(
          'Column is required for all non-count aggregation functions',
        );
      });

      it('renders once a column is there', async () => {
        const sql = parameterizedQueryToSql(
          await renderChartConfig(
            configWithValueExpression('Duration'),
            mockMetadata,
            querySettings,
          ),
        );

        expect(sql).toContain('quantile(0.99)');
        expect(sql).toContain('Duration');
      });

      it('leaves count alone, which takes no argument', async () => {
        const sql = parameterizedQueryToSql(
          await renderChartConfig(
            {
              ...configWithValueExpression(''),
              select: [{ aggFn: 'count', valueExpression: '' }],
            },
            mockMetadata,
            querySettings,
          ),
        );

        expect(sql).toContain('count()');
      });
    });

    describe('quantile', () => {
      it('should generate a whole-range query without a time dimension', async () => {
        const config: ChartConfigWithOptDateRange = {
          displayType: DisplayType.Number,
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
        expect(actual).not.toContain('TimeUnix AS `__hdx_time_bucket`');
        expect(actual).not.toMatch(
          /SELECT `__hdx_time_bucket`, "Value" FROM metrics/,
        );
        expect(actual).toContain(
          'WHERE (TimeUnix >= fromUnixTimestamp64Milli(1739318400000) AND TimeUnix <= fromUnixTimestamp64Milli(1765670400000))',
        );
        expect(actual).not.toContain('toStartOfInterval');
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
          groupBy: 'ServiceName',
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
      it('should generate a whole-range count query without a time dimension', async () => {
        const config: ChartConfigWithOptDateRange = {
          displayType: DisplayType.Number,
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
        expect(actual).not.toContain('TimeUnix AS `__hdx_time_bucket`');
        expect(actual).not.toMatch(
          /SELECT `__hdx_time_bucket`, "Value" FROM metrics/,
        );
        expect(actual).toContain(
          'WHERE (TimeUnix >= fromUnixTimestamp64Milli(1739318400000) AND TimeUnix <= fromUnixTimestamp64Milli(1765670400000))',
        );
        expect(actual).not.toContain('toStartOfInterval');
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

  describe('Event Patterns query with select-alias filter (HDX-1879)', () => {
    // The Event Patterns view rebuilds the SELECT (sampled body + timestamp,
    // ORDER BY rand() LIMIT) instead of reusing the results-table SELECT. When
    // the user filters on a column the source exposes only under an alias
    // (e.g. `ServiceName as service`), that alias is out of scope in the
    // rebuilt query unless its definition is carried through `with`. Threading
    // the source's alias map into the pattern config defines the alias in a
    // WITH clause so the filter resolves.
    const patternConfig = (
      withClauses: BuilderChartConfig['with'],
    ): ChartConfigWithOptDateRange => ({
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      with: withClauses,
      select: 'Body as __hdx_pattern_field, Timestamp as __hdx_timestamp',
      where: "service = 'api'",
      whereLanguage: 'sql',
      orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
      limit: { limit: 10000 },
      timestampValueExpression: 'Timestamp',
      dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
    });

    it('defines the select alias in a WITH clause so the filter resolves', async () => {
      const generatedSql = await renderChartConfig(
        patternConfig([
          { name: 'service', sql: chSql`ServiceName`, isSubquery: false },
        ]),
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);

      // Alias is defined in the rebuilt pattern query...
      expect(sql).toContain('(ServiceName) AS service');
      // ...and the filter still references it.
      expect(sql).toContain("service = 'api'");
    });

    it('omits the alias definition when no alias map is threaded (the bug)', async () => {
      const generatedSql = await renderChartConfig(
        patternConfig(undefined),
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);

      // Without the threaded WITH clauses the alias is undefined, so the
      // filter references a `service` column that does not exist in the
      // rebuilt SELECT (ClickHouse rejects this with "Unknown identifier").
      expect(sql).not.toContain('AS service');
      expect(sql).toContain("service = 'api'");
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

    it('rewrites `Map[key] IN (many)` to hasAny(... array(...)) on ClickHouse >= 26.5', async () => {
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

    it('rewrites `Map[key] IN (many)` to a chain of has() ORs on older ClickHouse (< 26.5)', async () => {
      stubKvItemsMetadata();
      mockMetadata.getServerVersion = jest
        .fn()
        .mockResolvedValue([26, 4, 3, 37]);
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          buildConfig("LogAttributes['k'] IN ('a', 'b', 'c')"),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain("has(`LogAttributeItems`, concat('k', '=', 'a'))");
      expect(sql).toContain("has(`LogAttributeItems`, concat('k', '=', 'b'))");
      expect(sql).toContain("has(`LogAttributeItems`, concat('k', '=', 'c'))");
      expect(sql).not.toContain('hasAny(');
      expect(sql).not.toContain('array(concat(');
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
      expect(sql).not.toContain('has(`LogAttributeItems`');
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
      expect(sql).not.toContain('has(`LogAttributeItems`');
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

    const buildWhereConfig = (where: string): ChartConfigWithOptDateRange => ({
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      select: [{ aggFn: 'count', valueExpression: '' }],
      where,
      whereLanguage: 'sql',
      timestampValueExpression: 'Timestamp',
      dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
      granularity: '1 minute',
    });

    it('rewrites `Map[key] = value` in a SQL `where` (search box path)', async () => {
      stubKvItemsMetadata();
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          buildWhereConfig("LogAttributes['service.name'] = 'api'"),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain(
        "has(`LogAttributeItems`, concat('service.name', '=', 'api'))",
      );
      expect(sql).not.toContain("LogAttributes['service.name'] = 'api'");
    });

    it('rewrites `Map[key] IN (many)` in a SQL `where` to hasAny() on ClickHouse >= 26.5', async () => {
      stubKvItemsMetadata();
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          buildWhereConfig("LogAttributes['k'] IN ('a', 'b')"),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain(
        "hasAny(`LogAttributeItems`, array(concat('k', '=', 'a'), concat('k', '=', 'b')))",
      );
    });

    it('leaves a SQL `where` unchanged when no KV items column exists', async () => {
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
          buildWhereConfig("LogAttributes['k'] = 'v'"),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain("LogAttributes['k'] = 'v'");
      expect(sql).not.toContain('has(`LogAttributeItems`');
    });

    it('leaves a SQL `where` unchanged when the server predates direct_read support (ALIAS items column)', async () => {
      stubKvItemsMetadata();
      // The stub's items column is MATERIALIZED (always eligible); switch it
      // to ALIAS so the supportsDirectReadMap version gate applies.
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
          default_type: 'ALIAS',
          default_expression:
            "arrayMap((arr) -> concat(arr.1, '=', arr.2), LogAttributes::Array(Tuple(String, String)))",
        },
      ]);
      mockMetadata.getServerVersion = jest
        .fn()
        .mockResolvedValue([26, 1, 0, 0]);

      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          buildWhereConfig("LogAttributes['k'] = 'v'"),
          mockMetadata,
          querySettings,
        ),
      );
      expect(sql).toContain("LogAttributes['k'] = 'v'");
      expect(sql).not.toContain('has(`LogAttributeItems`');
    });

    it('rewrites a SQL aggCondition in the WHERE clause but not in the aggregate', async () => {
      stubKvItemsMetadata();
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        from: { databaseName: 'default', tableName: 'otel_logs' },
        select: [
          {
            aggFn: 'count',
            aggCondition: "LogAttributes['service.name'] = 'api'",
            aggConditionLanguage: 'sql',
            valueExpression: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'Timestamp',
        dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
        granularity: '1 minute',
      };
      const sql = parameterizedQueryToSql(
        await renderChartConfig(config, mockMetadata, querySettings),
      );
      // WHERE-clause copy is rewritten so the text index can prune granules...
      expect(sql).toContain(
        "has(`LogAttributeItems`, concat('service.name', '=', 'api'))",
      );
      // ...while the countIf(...) copy keeps the plain Map subscript, which is
      // cheaper to evaluate per-row than has() over an ALIAS items column.
      expect(sql).toContain("countIf(LogAttributes['service.name'] = 'api')");
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
      {
        description:
          'wraps includedDataInterval-expanded bound in toStartOf when PK has toStartOfHour(col) — prevents dropping rows whose hour is before the raw expanded start',
        timestampValueExpression: 'timestamp, toStartOfHour(timestamp)',
        dateRange: [
          new Date('2025-02-12 04:00:00Z'),
          new Date('2025-02-12 04:20:00Z'),
        ],
        includedDataInterval: '5 minute',
        expected: `(timestamp >= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:00:00Z').getTime()}), INTERVAL 5 minute) - INTERVAL 5 minute AND timestamp <= toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:20:00Z').getTime()}), INTERVAL 5 minute) + INTERVAL 5 minute)AND(toStartOfHour(timestamp) >= toStartOfHour(toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:00:00Z').getTime()}), INTERVAL 5 minute) - INTERVAL 5 minute) AND toStartOfHour(timestamp) <= toStartOfHour(toStartOfInterval(fromUnixTimestamp64Milli(${new Date('2025-02-12 04:20:00Z').getTime()}), INTERVAL 5 minute) + INTERVAL 5 minute))`,
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

    it.each(['Date32', 'Nullable(Date)', 'LowCardinality(Date)'])(
      'wraps a %s column in toDate() and keeps the bounds inclusive',
      async type => {
        mockMetadata.getColumn.mockImplementation(
          async () => ({ type }) as ColumnMeta,
        );

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
        });

        expect(parameterizedQueryToSql(actual)).toBe(
          `(date >= toDate(fromUnixTimestamp64Milli(${dateRange[0].getTime()})) AND date <= toDate(fromUnixTimestamp64Milli(${dateRange[1].getTime()})))`,
        );
      },
    );
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

      // PromQL configs return empty SQL; queries go through the Prometheus API route
      expect(generatedSql.sql).toBe('');
      expect(generatedSql.params).toEqual({});
    });
  });

  describe('dashboard variables', () => {
    const configWithVariables: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'logs' },
      select: [
        {
          aggFn: 'count',
          valueExpression: '',
          aggCondition: 'ServiceName IN ($service)',
          aggConditionLanguage: 'sql',
        },
      ],
      groupBy: [{ valueExpression: 'ServiceName' }],
      where: '$__filter(ServiceName, $service)',
      whereLanguage: 'sql',
      having: 'count() > 0',
      timestampValueExpression: 'timestamp',
      dateRange: [new Date('2025-02-12'), new Date('2025-02-13')],
      granularity: '5 minute',
      variables: [{ name: 'service', values: ['api', 'web'] }],
    };

    it('expands references and variable macros in a builder config', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(configWithVariables, mockMetadata, undefined),
      );

      expect(sql).toContain("(ServiceName IN ('api', 'web'))");
      expect(sql).toContain("countIf(ServiceName IN ('api', 'web'))");
      expect(sql).not.toContain('$service');
      expect(sql).not.toContain('$__filter');
    });

    it('leaves references untouched when the config carries no variables', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          { ...configWithVariables, where: '$service', variables: undefined },
          mockMetadata,
          undefined,
        ),
      );

      expect(sql).toContain('$service');
    });

    it('does not re-expand a selected value that looks like a reference', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...configWithVariables,
            variables: [
              { name: 'service', values: ['$other'] },
              { name: 'other', values: ['nope'] },
            ],
          },
          mockMetadata,
          undefined,
        ),
      );

      expect(sql).toContain("(ServiceName IN ('$other'))");
      expect(sql).not.toContain('nope');
    });

    // A metric config is rewritten into CTEs by translateMetricChartConfig
    // (single series) or split into one query per series (multi-series), and
    // both read the config's expressions. Substitution therefore has to run
    // *before* that rewriting for the expansions to reach the generated SQL at
    // all — and exactly once, since the per-series branches recurse back
    // through renderChartConfig.
    const gaugeSeriesWithVariable = {
      aggFn: 'avg' as const,
      aggCondition: 'ServiceName IN ($service)',
      aggConditionLanguage: 'sql' as const,
      valueExpression: 'Value',
      metricName: 'metric.alpha',
      metricType: MetricsDataType.Gauge,
    };

    const metricConfigWithVariables: ChartConfigWithOptDateRange = {
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
      select: [gaugeSeriesWithVariable],
      groupBy: [{ valueExpression: 'ServiceName' }],
      where: '$__filter(ServiceName, $service)',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      granularity: '1 minute',
      variables: [{ name: 'service', values: ['api', 'web'] }],
    };

    it('expands references and macros in a single-series metric config', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          metricConfigWithVariables,
          mockMetadata,
          querySettings,
        ),
      );

      // The WHERE macro and the series aggCondition, once each.
      expect(sql.match(/ServiceName IN \('api', 'web'\)/g)).toHaveLength(2);
      // Both land in the Source CTE's filter, which only happens when
      // substitution runs before the metric translation builds that CTE —
      // afterwards the CTE body is already rendered SQL text.
      expect(sql).toMatch(
        /FROM default\.otel_metrics_gauge[\s\S]*ServiceName IN \('api', 'web'\)[\s\S]*FROM Bucketed/,
      );
      expect(sql).not.toContain('$service');
      expect(sql).not.toContain('$__filter');
    });

    it('expands references in every branch of a multi-series metric config', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...metricConfigWithVariables,
            select: [
              gaugeSeriesWithVariable,
              { ...gaugeSeriesWithVariable, metricName: 'metric.beta' },
              {
                ...gaugeSeriesWithVariable,
                aggFn: 'sum',
                metricName: 'metric.gamma',
                metricType: MetricsDataType.Sum,
              },
            ],
          },
          mockMetadata,
          querySettings,
        ),
      );

      // Three branches (two gauge, one sum — a different physical table with
      // its own CTE scaffolding), each carrying both expansions.
      expect(sql.match(/UNION ALL/g)).toHaveLength(2);
      expect(sql.match(/ServiceName IN \('api', 'web'\)/g)).toHaveLength(6);
      expect(sql).toContain('FROM default.otel_metrics_sum');
      expect(sql).not.toContain('$service');
      expect(sql).not.toContain('$__filter');
    });

    it('substitutes exactly once across a multi-series metric render', async () => {
      const sql = parameterizedQueryToSql(
        await renderChartConfig(
          {
            ...metricConfigWithVariables,
            select: [
              gaugeSeriesWithVariable,
              { ...gaugeSeriesWithVariable, metricName: 'metric.beta' },
            ],
            // The per-series branches recurse through renderChartConfig, so a
            // value that itself looks like a reference must not be expanded a
            // second time on the way down.
            variables: [
              { name: 'service', values: ['$other'] },
              { name: 'other', values: ['nope'] },
            ],
          },
          mockMetadata,
          querySettings,
        ),
      );

      // Two branches × (WHERE macro + aggCondition), all left as written.
      expect(sql.match(/ServiceName IN \('\$other'\)/g)).toHaveLength(4);
      expect(sql).not.toContain('nope');
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

    it('picks the DateTime token when its type carries a timezone', async () => {
      mockMetadata.getColumn = jest
        .fn()
        .mockImplementation(async ({ column }: { column: string }) => {
          if (column === 'EventDate')
            return { name: 'EventDate', type: 'Date' };
          if (column === 'EventTime')
            return { name: 'EventTime', type: "DateTime('UTC')" };
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

      expect(sql).toContain('toStartOfInterval(toDateTime(EventTime),');
      expect(sql).not.toContain('toStartOfInterval(toDateTime(EventDate),');
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

  // The Map-schema vs JSON-schema attrHashExpr distinction was collapsed in
  // HDX-4466. Both schemas now render the same variadic
  // cityHash64(ScopeAttributes, ResourceAttributes, Attributes) expression,
  // which works for both Map(LowCardinality(String), String) and JSON
  // attribute columns. Coverage of the variadic form lives in the regenerated
  // gauge / sum / histogram snapshots earlier in this file plus the
  // cross-scope integration test in packages/api/src/clickhouse/__tests__.

  // A metric chart with multiple select items renders one query per series and
  // composes them into a single UNION ALL + pivot statement (HDX-5077). The
  // end-to-end result-shape contract is pinned by the queryChartConfig
  // integration tests; these snapshots pin the generated SQL structure.
  describe('multi-series metric charts (composed query)', () => {
    const metricTables = {
      gauge: 'otel_metrics_gauge',
      histogram: 'otel_metrics_histogram',
      sum: 'otel_metrics_sum',
      summary: 'otel_metrics_summary',
      'exponential histogram': 'otel_metrics_exponential_histogram',
    };

    const gaugeSelect = (metricName: string) => ({
      aggFn: 'avg' as const,
      aggCondition: '',
      aggConditionLanguage: 'sql' as const,
      valueExpression: 'Value',
      metricName,
      metricType: MetricsDataType.Gauge,
    });

    const baseMultiSeriesConfig: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      metricTables,
      from: { databaseName: 'default', tableName: '' },
      select: [gaugeSelect('metric.alpha'), gaugeSelect('metric.beta')],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'TimeUnix',
      dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      granularity: '1 minute',
    };

    it('composes grouped multi-series gauges into one UNION ALL + pivot query', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseMultiSeriesConfig,
          groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).toMatchSnapshot();

      // One composed statement: both branch SETTINGS hoisted to a single
      // trailing clause, deduped.
      expect(sql.match(/SETTINGS/g)).toHaveLength(1);
      expect(sql.match(/optimize_read_in_order = 0/g)).toHaveLength(1);
      // Value columns pivot under the user-facing aliases, NULL for gaps.
      expect(sql).toContain(
        'anyOrNullIf(`__hdx_value`, `__hdx_series_idx` = 0) AS "avg(metric.alpha)"',
      );
      expect(sql).toContain(
        'anyOrNullIf(`__hdx_value`, `__hdx_series_idx` = 1) AS "avg(metric.beta)"',
      );
      // The group-by column passes through UNRENAMED (consumers look rows up
      // by the single-series column name, which for expressions is
      // ClickHouse's derived name and can't be reproduced node-side): the
      // wrappers keep the branch projection via SELECT * — normalizing only
      // the value column to Float64 via REPLACE, so mixed-type series (e.g.
      // Float64 quantile + Int64 count) never UNION into a Variant — and the
      // outer pivot passes it through via * EXCEPT + GROUP BY ALL.
      expect(sql).toContain(
        'SELECT * REPLACE (toFloat64(`__hdx_value`) AS `__hdx_value`), 0 AS `__hdx_series_idx`',
      );
      expect(sql).toContain(
        '* EXCEPT (`__hdx_value`, `__hdx_series_idx`) FROM',
      );
      expect(sql).toContain('GROUP BY ALL ORDER BY `__hdx_time_bucket`');
    });

    it('renders a metric ratio as a SQL-side division', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseMultiSeriesConfig,
          seriesReturnType: 'ratio',
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).toMatchSnapshot();

      // Missing numerator counts as 0; missing/zero denominator yields NULL.
      expect(sql).toContain(
        'coalesce(anyOrNullIf(`__hdx_value`, `__hdx_series_idx` = 0), 0) / nullif(anyOrNullIf(`__hdx_value`, `__hdx_series_idx` = 1), 0) AS "avg(metric.alpha)/avg(metric.beta)"',
      );
    });

    it('divides by the per-bucket denominator total in share_of_total mode', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseMultiSeriesConfig,
          seriesReturnType: 'ratio',
          ratioMode: 'share_of_total',
          groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).toContain(
        'nullif(sum(anyOrNullIf(`__hdx_value`, `__hdx_series_idx` = 1)) OVER (PARTITION BY `__hdx_time_bucket`), 0)',
      );
    });

    it('pads group columns across gauge and histogram branch classes', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseMultiSeriesConfig,
          select: [
            gaugeSelect('metric.alpha'),
            {
              aggFn: 'quantile',
              level: 0.5,
              aggCondition: '',
              aggConditionLanguage: 'sql',
              valueExpression: 'Value',
              metricName: 'metric.latency',
              metricType: MetricsDataType.Histogram,
            },
          ],
          groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).toMatchSnapshot();

      // The gauge branch pads the histogram's Array group column with [] and
      // the histogram branch pads the scalar group column with NULL, so the
      // UNION column lists line up positionally while grouped rows keep
      // distinct keys. The scalar branch comes first so its (natural) group
      // column names win the union.
      expect(sql).toContain('[] AS `group`');
      expect(sql).toContain('NULL AS `__hdx_group_pad_0`');
      expect(
        sql.indexOf(
          'SELECT * REPLACE (toFloat64(`__hdx_value`) AS `__hdx_value`), 0 AS `__hdx_series_idx`',
        ),
      ).toBeLessThan(sql.indexOf('NULL AS `__hdx_group_pad_0`'));
      // The histogram branch re-projects the value column explicitly, with
      // the same Float64 normalization.
      expect(sql).toContain(
        'SELECT toFloat64(`__hdx_value`) AS `__hdx_value`, NULL AS `__hdx_group_pad_0`',
      );
      expect(sql).toContain('GROUP BY ALL');
    });

    it('suffixes colliding aliases with the split index', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseMultiSeriesConfig,
          select: [
            {
              ...gaugeSelect('metric.alpha'),
              aggCondition: "ServiceName = 'svc-a'",
            },
            gaugeSelect('metric.alpha'),
          ],
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).toContain('AS "avg(metric.alpha)"');
      expect(sql).toContain('AS "avg(metric.alpha)__1"');
    });

    it('merges number-shape series without a GROUP BY into one implicit aggregation', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseMultiSeriesConfig,
          displayType: DisplayType.Number,
          granularity: undefined,
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      // No grouping keys at all: the outer query is one implicit global
      // aggregation. (The branches' internal `__hdx_time_bucket2` CTE alias
      // is unrelated to the composed outer bucket.)
      expect(sql).not.toContain('GROUP BY `__hdx_');
      expect(sql).not.toContain('`__hdx_time_bucket`');
      expect(sql.match(/SETTINGS/g)).toHaveLength(1);
    });

    // HAVING / ORDER BY / LIMIT apply to the final joined result, where the
    // user-facing output columns exist — never inside a per-series branch.
    describe('outer HAVING / ORDER BY / LIMIT', () => {
      it('renders having, orderBy and limit once, on the outer joined statement only', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            displayType: DisplayType.Table,
            granularity: undefined,
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            having: '"avg(metric.alpha)" > 10',
            havingLanguage: 'sql',
            orderBy: [
              { valueExpression: '"avg(metric.beta)"', ordering: 'DESC' },
            ],
            limit: { limit: 5, offset: 10 },
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).toMatchSnapshot();

        // Exactly one of each user clause in the whole composed statement —
        // i.e. none leaked into the UNION ALL branches. (Bare ORDER BY also
        // appears inside the gauge translation's internal CTE scaffolding,
        // so count the user's exact clause text, not the keyword.)
        const count = (needle: string) => sql.split(needle).length - 1;
        expect(count('HAVING "avg(metric.alpha)" > 10')).toBe(1);
        expect(count('ORDER BY "avg(metric.beta)" DESC')).toBe(1);
        expect(count('LIMIT 5 OFFSET 10')).toBe(1);
        expect(count('HAVING')).toBe(1);
        // And on the outer scope: after the join's GROUP BY ALL, in
        // HAVING -> ORDER BY -> LIMIT order.
        const groupByIdx = sql.lastIndexOf('GROUP BY ALL');
        const havingIdx = sql.indexOf('HAVING "avg(metric.alpha)" > 10');
        const orderByIdx = sql.indexOf('ORDER BY "avg(metric.beta)" DESC');
        expect(groupByIdx).toBeGreaterThan(-1);
        expect(havingIdx).toBeGreaterThan(groupByIdx);
        expect(orderByIdx).toBeGreaterThan(havingIdx);
        expect(sql.indexOf('LIMIT 5 OFFSET 10')).toBeGreaterThan(orderByIdx);
      });

      it('keeps time charts bucket-ordered first, with the user sort as tiebreaker', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            orderBy: [{ valueExpression: 'ServiceName', ordering: 'ASC' }],
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).toContain('ORDER BY `__hdx_time_bucket`,ServiceName ASC');
      });

      it('filters a share_of_total ratio through a wrapper, not HAVING (window function)', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            displayType: DisplayType.Table,
            granularity: undefined,
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            seriesReturnType: 'ratio',
            ratioMode: 'share_of_total',
            having: '"avg(metric.alpha)/avg(metric.beta)" >= 0.2',
            havingLanguage: 'sql',
            orderBy: [
              {
                valueExpression: '"avg(metric.alpha)/avg(metric.beta)"',
                ordering: 'DESC',
              },
            ],
            limit: { limit: 2 },
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).toMatchSnapshot();

        // The share_of_total projection is a window function, which
        // ClickHouse rejects inside HAVING — the filter runs as WHERE on a
        // wrapper around the joined result instead.
        expect(sql).not.toContain('HAVING');
        const whereIdx = sql.indexOf(
          'WHERE "avg(metric.alpha)/avg(metric.beta)" >= 0.2',
        );
        expect(whereIdx).toBeGreaterThan(sql.lastIndexOf('GROUP BY ALL'));
        // Filter, then order, then limit — on the outermost statement.
        const orderByIdx = sql.indexOf(
          'ORDER BY "avg(metric.alpha)/avg(metric.beta)" DESC',
        );
        expect(orderByIdx).toBeGreaterThan(whereIdx);
        expect(sql.indexOf('LIMIT 2')).toBeGreaterThan(orderByIdx);
      });

      it('renders a string-form orderBy on the outer statement', async () => {
        // SortSpecificationList also accepts a raw SQL string (saved configs
        // may carry one), not just the structured array form.
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            displayType: DisplayType.Table,
            granularity: undefined,
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            orderBy: '"avg(metric.alpha)" DESC',
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        const count = (needle: string) => sql.split(needle).length - 1;
        expect(count('ORDER BY "avg(metric.alpha)" DESC')).toBe(1);
        expect(
          sql.indexOf('ORDER BY "avg(metric.alpha)" DESC'),
        ).toBeGreaterThan(sql.lastIndexOf('GROUP BY ALL'));
      });

      // HDX-5202: convertToTableChartConfig defaults a table's orderBy to
      // the raw groupBy text. For expression group-bys those expressions
      // don't resolve in the composed outer scope (the source columns are
      // gone and the passthrough column carries ClickHouse's derived name),
      // so they sort via internal `__hdx_sort_<n>` companion columns.
      describe('expression group-by ORDER BY (companion sort columns)', () => {
        // Mirrors the broken "Top Pods by Event Loop Pressure" tile: a
        // multi-series gauge table grouped by a map access plus a
        // concat/if expression, ordered by the same raw text.
        const EXPR_GROUP_BY =
          "ResourceAttributes['service.name'], concat(ResourceAttributes['host.name'], if(ResourceAttributes['hyperdx.alerts.shard.index'] != '', concat('-s', ResourceAttributes['hyperdx.alerts.shard.index']), ''))";

        it('sorts a table default orderBy (= groupBy text) through companion columns', async () => {
          const generatedSql = await renderChartConfig(
            {
              ...baseMultiSeriesConfig,
              displayType: DisplayType.Table,
              granularity: undefined,
              groupBy: EXPR_GROUP_BY,
              orderBy: EXPR_GROUP_BY,
              limit: { limit: 200 },
            },
            mockMetadata,
            querySettings,
          );
          const sql = parameterizedQueryToSql(generatedSql);
          expect(sql).toMatchSnapshot();

          // Each branch projects (and groups by) the companion columns in
          // addition to the un-renamed group columns.
          expect(sql).toContain(
            'ResourceAttributes[\'service.name\'] AS "__hdx_sort_0"',
          );
          expect(sql).toContain('AS "__hdx_sort_1"');
          // The companions never reach the output columns...
          expect(sql).toContain(
            '* EXCEPT (`__hdx_value`, `__hdx_series_idx`, `__hdx_sort_0`, `__hdx_sort_1`)',
          );
          // ...and the outer ORDER BY reaches them through any() instead of
          // re-evaluating the raw expressions in a scope without the source
          // columns.
          expect(sql).toContain(
            'ORDER BY any(`__hdx_sort_0`),any(`__hdx_sort_1`)',
          );
          const orderByIdx = sql.indexOf('ORDER BY any(`__hdx_sort_0`)');
          expect(orderByIdx).toBeGreaterThan(sql.lastIndexOf('GROUP BY ALL'));
          // The raw map access must not leak past the outer GROUP BY ALL.
          expect(
            sql
              .slice(orderByIdx)
              .startsWith(
                'ORDER BY any(`__hdx_sort_0`),any(`__hdx_sort_1`) LIMIT 200',
              ),
          ).toBe(true);
        });

        it('rewrites a structured orderBy item matching an expression group-by, keeping its direction', async () => {
          const generatedSql = await renderChartConfig(
            {
              ...baseMultiSeriesConfig,
              displayType: DisplayType.Table,
              granularity: undefined,
              groupBy: [
                {
                  aggCondition: '',
                  valueExpression: "ResourceAttributes['service.name']",
                },
              ],
              orderBy: [
                {
                  valueExpression: "ResourceAttributes['service.name']",
                  ordering: 'DESC',
                },
              ],
            },
            mockMetadata,
            querySettings,
          );
          const sql = parameterizedQueryToSql(generatedSql);
          expect(sql).toContain('ORDER BY any(`__hdx_sort_0`) DESC');
          // The group column itself still passes through un-renamed.
          expect(sql).toContain(
            '* EXCEPT (`__hdx_value`, `__hdx_series_idx`, `__hdx_sort_0`)',
          );
        });

        it('sorts through the user alias when the matched group-by entry has one', async () => {
          const generatedSql = await renderChartConfig(
            {
              ...baseMultiSeriesConfig,
              displayType: DisplayType.Table,
              granularity: undefined,
              groupBy: [
                {
                  aggCondition: '',
                  valueExpression: "ResourceAttributes['service.name']",
                  alias: 'service',
                },
              ],
              orderBy: [
                {
                  valueExpression: "ResourceAttributes['service.name']",
                  ordering: 'DESC',
                },
              ],
            },
            mockMetadata,
            querySettings,
          );
          const sql = parameterizedQueryToSql(generatedSql);
          // The aliased output column is already resolvable — no companion.
          expect(sql).toContain('ORDER BY "service" DESC');
          expect(sql).not.toContain('__hdx_sort_');
        });

        it('pads companion sort slots with NULL in histogram branches', async () => {
          const generatedSql = await renderChartConfig(
            {
              ...baseMultiSeriesConfig,
              select: [
                gaugeSelect('metric.alpha'),
                {
                  aggFn: 'quantile',
                  level: 0.5,
                  aggCondition: '',
                  aggConditionLanguage: 'sql',
                  valueExpression: 'Value',
                  metricName: 'metric.latency',
                  metricType: MetricsDataType.Histogram,
                },
              ],
              groupBy: [
                {
                  aggCondition: '',
                  valueExpression: "ResourceAttributes['service.name']",
                },
              ],
              orderBy: [
                {
                  valueExpression: "ResourceAttributes['service.name']",
                  ordering: 'ASC',
                },
              ],
            },
            mockMetadata,
            querySettings,
          );
          const sql = parameterizedQueryToSql(generatedSql);
          // A histogram branch can't evaluate the companion (its groups are
          // packed into the `group` array), so its wrapper pads the slot to
          // keep the UNION ALL column lists positionally aligned.
          expect(sql).toContain('NULL AS `__hdx_sort_pad_0`');
          expect(sql).toContain(
            'ResourceAttributes[\'service.name\'] AS "__hdx_sort_0"',
          );
          expect(sql).toContain(
            'ORDER BY `__hdx_time_bucket`,any(`__hdx_sort_0`) ASC',
          );
        });

        it('sorts an all-histogram chart positionally on the packed group array', async () => {
          // With no scalar branch there are no individual group columns
          // anywhere — every branch packs the group values into the `group`
          // Array — so matched sort items address it by element instead of
          // through companion columns.
          const histSelect = (metricName: string, level: number) => ({
            aggFn: 'quantile' as const,
            level,
            aggCondition: '',
            aggConditionLanguage: 'sql' as const,
            valueExpression: 'Value',
            metricName,
            metricType: MetricsDataType.Histogram,
          });
          const generatedSql = await renderChartConfig(
            {
              ...baseMultiSeriesConfig,
              displayType: DisplayType.Table,
              granularity: undefined,
              select: [
                histSelect('metric.latency', 0.5),
                histSelect('metric.latency', 0.99),
              ],
              groupBy: EXPR_GROUP_BY,
              orderBy: EXPR_GROUP_BY,
              limit: { limit: 200 },
            },
            mockMetadata,
            querySettings,
          );
          const sql = parameterizedQueryToSql(generatedSql);
          expect(sql).toMatchSnapshot();

          expect(sql).toContain('ORDER BY `group`[1],`group`[2] LIMIT 200');
          expect(sql).not.toContain('__hdx_sort_');
          // The raw expressions never leak past the outer GROUP BY ALL.
          expect(sql.slice(sql.lastIndexOf('GROUP BY ALL'))).not.toContain(
            'ResourceAttributes',
          );
        });

        it('sorts an all-histogram chart by a plain group column through the packed array', async () => {
          // Even a bare column group-by has no named passthrough column when
          // every branch is a histogram — only the packed `group` Array.
          const generatedSql = await renderChartConfig(
            {
              ...baseMultiSeriesConfig,
              displayType: DisplayType.Table,
              granularity: undefined,
              select: [
                {
                  aggFn: 'quantile',
                  level: 0.5,
                  aggCondition: '',
                  aggConditionLanguage: 'sql',
                  valueExpression: 'Value',
                  metricName: 'metric.latency',
                  metricType: MetricsDataType.Histogram,
                },
                {
                  aggFn: 'count',
                  aggCondition: '',
                  aggConditionLanguage: 'sql',
                  valueExpression: '',
                  metricName: 'metric.latency',
                  metricType: MetricsDataType.Histogram,
                },
              ],
              groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
              orderBy: [{ valueExpression: 'ServiceName', ordering: 'DESC' }],
            },
            mockMetadata,
            querySettings,
          );
          const sql = parameterizedQueryToSql(generatedSql);
          expect(sql).toContain('ORDER BY `group`[1] DESC');
          expect(sql).not.toContain('__hdx_sort_');
        });

        it('rewrites the sort for a share_of_total ratio without HAVING', async () => {
          // Without a HAVING there is no window wrapper — the ORDER BY sits
          // on the GROUP BY ALL statement, where the companion rewrite is
          // valid alongside the window-function ratio projection.
          const generatedSql = await renderChartConfig(
            {
              ...baseMultiSeriesConfig,
              displayType: DisplayType.Table,
              granularity: undefined,
              seriesReturnType: 'ratio',
              ratioMode: 'share_of_total',
              groupBy: "ResourceAttributes['service.name']",
              orderBy: "ResourceAttributes['service.name']",
            },
            mockMetadata,
            querySettings,
          );
          const sql = parameterizedQueryToSql(generatedSql);
          expect(sql).toContain('ORDER BY any(`__hdx_sort_0`)');
          expect(sql).toContain(
            '* EXCEPT (`__hdx_value`, `__hdx_series_idx`, `__hdx_sort_0`)',
          );
        });

        it('keeps the legacy sort when the ORDER BY lands on the share_of_total HAVING wrapper', async () => {
          // share_of_total + HAVING filters through a GROUP-BY-less wrapper,
          // where neither an aggregate nor the excluded companion resolves —
          // the raw expression passes through (pre-existing failure mode).
          const generatedSql = await renderChartConfig(
            {
              ...baseMultiSeriesConfig,
              displayType: DisplayType.Table,
              granularity: undefined,
              seriesReturnType: 'ratio',
              ratioMode: 'share_of_total',
              groupBy: "ResourceAttributes['service.name']",
              orderBy: "ResourceAttributes['service.name']",
              having: '"avg(metric.alpha)/avg(metric.beta)" >= 0.2',
              havingLanguage: 'sql',
            },
            mockMetadata,
            querySettings,
          );
          const sql = parameterizedQueryToSql(generatedSql);
          expect(sql).not.toContain('__hdx_sort_');
          const orderByIdx = sql.lastIndexOf('ORDER BY');
          expect(sql.slice(orderByIdx)).toContain(
            "ORDER BY ResourceAttributes['service.name']",
          );
        });

        it('leaves a plain-column orderBy matching a group-by untouched', async () => {
          const generatedSql = await renderChartConfig(
            {
              ...baseMultiSeriesConfig,
              displayType: DisplayType.Table,
              granularity: undefined,
              groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
              orderBy: 'ServiceName',
            },
            mockMetadata,
            querySettings,
          );
          const sql = parameterizedQueryToSql(generatedSql);
          // A bare column passes through under its own name, so the outer
          // ORDER BY resolves without any rewriting.
          expect(sql).toContain('ORDER BY ServiceName');
          expect(sql).not.toContain('__hdx_sort_');
        });
      });

      it('renders HAVING on the number shape without a GROUP BY ALL', async () => {
        // With no passthrough columns the outer query is one implicit global
        // aggregation — HAVING is valid there without any GROUP BY.
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            displayType: DisplayType.Number,
            granularity: undefined,
            having: '"avg(metric.alpha)" > 10',
            havingLanguage: 'sql',
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).not.toContain('GROUP BY ALL');
        const count = (needle: string) => sql.split(needle).length - 1;
        expect(count('HAVING "avg(metric.alpha)" > 10')).toBe(1);
      });

      it('lets HAVING reference a formula output column', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            displayType: DisplayType.Table,
            granularity: undefined,
            groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
            formulas: [{ expression: 'A / B', alias: 'err rate' }],
            having: '"err rate" > 0.5',
            havingLanguage: 'sql',
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql.match(/HAVING/g)).toHaveLength(1);
        expect(sql.indexOf('HAVING "err rate" > 0.5')).toBeGreaterThan(
          sql.lastIndexOf('GROUP BY ALL'),
        );
      });
    });

    // Formula projection over the pivoted per-series columns.
    describe('formulas', () => {
      const pivot = (idx: number) =>
        `anyOrNullIf(\`__hdx_value\`, \`__hdx_series_idx\` = ${idx})`;

      it('appends the formula column after the operand value columns', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            formulas: [
              { expression: 'A / (A + B) * 100', alias: 'Success rate' },
            ],
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).toMatchSnapshot();

        // Operand series pivot under their user-facing aliases, in select
        // order, followed by the compiled formula column.
        expect(sql).toContain(`${pivot(0)} AS "avg(metric.alpha)"`);
        expect(sql).toContain(`${pivot(1)} AS "avg(metric.beta)"`);
        const formulaSql = `((coalesce(${pivot(0)}, 0) / nullif((coalesce(${pivot(0)}, 0) + coalesce(${pivot(1)}, 0)), 0)) * 100) AS "Success rate"`;
        expect(sql).toContain(formulaSql);
        expect(sql.indexOf('AS "avg(metric.beta)"')).toBeLessThan(
          sql.indexOf('AS "Success rate"'),
        );
      });

      it('emits only the formula column when showOperandSeries is false', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            formulas: [{ expression: 'A / B', alias: 'ratio' }],
            showOperandSeries: false,
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).not.toContain('AS "avg(metric.alpha)"');
        expect(sql).not.toContain('AS "avg(metric.beta)"');
        expect(sql).toContain(
          `(coalesce(${pivot(0)}, 0) / nullif(coalesce(${pivot(1)}, 0), 0)) AS "ratio"`,
        );
        // The passthrough bucket column + grouping survive.
        expect(sql).toContain(
          '* EXCEPT (`__hdx_value`, `__hdx_series_idx`) FROM',
        );
        expect(sql).toContain('GROUP BY ALL ORDER BY `__hdx_time_bucket`');
      });

      it('names an alias-less formula column by its expression text', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            formulas: [{ expression: 'A + B' }],
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).toContain('AS "A + B"');
      });

      it('routes a single-series chart with a formula through the composed path', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            select: [gaugeSelect('metric.alpha')],
            formulas: [{ expression: 'A * 100', alias: 'pct' }],
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).toMatchSnapshot();
        expect(sql).toContain(`(coalesce(${pivot(0)}, 0) * 100) AS "pct"`);
        expect(sql).toContain(
          'SELECT * REPLACE (toFloat64(`__hdx_value`) AS `__hdx_value`), 0 AS `__hdx_series_idx`',
        );
        expect(sql).not.toContain('UNION ALL');
      });

      it('takes precedence over seriesReturnType ratio', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            seriesReturnType: 'ratio',
            formulas: [{ expression: 'B / A', alias: 'inverse' }],
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).toContain('AS "inverse"');
        expect(sql).not.toContain('AS "avg(metric.alpha)/avg(metric.beta)"');
      });

      it('suffixes a formula name colliding with an operand alias', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            formulas: [{ expression: 'A + B', alias: 'avg(metric.alpha)' }],
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).toContain('AS "avg(metric.alpha)"');
        // Formula column index continues after the select entries (2).
        expect(sql).toContain('AS "avg(metric.alpha)__2"');
      });

      it('escapes double quotes in formula and operand column names', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            select: [
              { ...gaugeSelect('metric.alpha'), alias: 'operand "quoted"' },
              gaugeSelect('metric.beta'),
            ],
            formulas: [{ expression: 'A / B', alias: 'bad"name' }],
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        // ClickHouse escapes a double quote inside a double-quoted
        // identifier by doubling it — a raw interpolation would terminate
        // the identifier early (AS "bad"name") and fail to parse.
        expect(sql).toContain('AS "bad""name"');
        expect(sql).toContain('AS "operand ""quoted"""');
        expect(sql).not.toContain('AS "bad"name"');
      });

      it('escapes double quotes in the ratio column label', async () => {
        const generatedSql = await renderChartConfig(
          {
            ...baseMultiSeriesConfig,
            select: [
              { ...gaugeSelect('metric.alpha'), alias: 'err"s' },
              { ...gaugeSelect('metric.beta'), alias: 'total' },
            ],
            seriesReturnType: 'ratio',
          },
          mockMetadata,
          querySettings,
        );
        const sql = parameterizedQueryToSql(generatedSql);
        expect(sql).toContain('AS "err""s/total"');
      });

      it('throws a structured error for an invalid persisted formula', async () => {
        await expect(
          renderChartConfig(
            {
              ...baseMultiSeriesConfig,
              formulas: [{ expression: 'A / C' }],
            },
            mockMetadata,
            querySettings,
          ),
        ).rejects.toThrow(
          'Invalid formula "A / C": Unknown series "C" — this chart only has series A through B',
        );
      });
    });
  });

  // Formulas on event (log/trace) sources compile inline in the single-scan
  // SELECT (renderSelectListWithFormulas) — no UNION ALL / pivot involved.
  describe('event (log/trace) formula charts (inline single-query)', () => {
    const baseEventFormulaConfig: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      select: [
        {
          aggFn: 'count' as const,
          valueExpression: '',
          aggCondition: "SeverityText = 'error'",
          aggConditionLanguage: 'sql' as const,
          alias: 'errors',
        },
        {
          aggFn: 'count' as const,
          valueExpression: '',
          aggCondition: '',
          alias: 'total',
        },
      ],
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'timestamp',
      dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      granularity: '1 minute',
    };

    it('appends the compiled formula column after the operand columns in one scan', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseEventFormulaConfig,
          formulas: [{ expression: 'A / B * 100', alias: 'Error rate' }],
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).toMatchSnapshot();

      // Single scan — no composed UNION ALL / pivot machinery.
      expect(sql).not.toContain('UNION ALL');
      expect(sql).not.toContain('__hdx_series_idx');
      // Operand columns first (select order), then the formula column.
      expect(sql).toContain('AS "errors"');
      expect(sql).toContain('AS "total"');
      expect(sql).toContain('AS "Error rate"');
      expect(sql.indexOf('AS "errors"')).toBeLessThan(
        sql.indexOf('AS "total"'),
      );
      expect(sql.indexOf('AS "total"')).toBeLessThan(
        sql.indexOf('AS "Error rate"'),
      );
      // Ratio-consistent missing-data semantics: refs coalesce to 0 and
      // division denominators nullif to a gap.
      expect(sql).toContain('coalesce(');
      expect(sql).toContain('nullif(');
    });

    it('emits only the formula column when showOperandSeries is false', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseEventFormulaConfig,
          formulas: [{ expression: 'A / B', alias: 'ratio' }],
          showOperandSeries: false,
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).not.toContain('AS "errors"');
      expect(sql).not.toContain('AS "total"');
      expect(sql).toContain('AS "ratio"');
      // The operand aggregates still evaluate inside the formula.
      expect(sql).toContain('countIf(');
    });

    it('names an alias-less formula column by its expression text', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseEventFormulaConfig,
          formulas: [{ expression: 'A + B' }],
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).toContain('AS "A + B"');
    });

    it('takes precedence over seriesReturnType ratio', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseEventFormulaConfig,
          seriesReturnType: 'ratio',
          formulas: [{ expression: 'B / A', alias: 'inverse' }],
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).toContain('AS "inverse"');
      expect(sql).not.toContain('divide(');
    });

    it('suffixes a formula name colliding with an operand alias', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseEventFormulaConfig,
          formulas: [{ expression: 'A + B', alias: 'errors' }],
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).toContain('AS "errors"');
      // Formula column index continues after the select entries (2).
      expect(sql).toContain('AS "errors__2"');
    });

    it('escapes double quotes in the formula column name', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseEventFormulaConfig,
          formulas: [{ expression: 'A / B', alias: 'bad"name' }],
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).toContain('AS "bad""name"');
      expect(sql).not.toContain('AS "bad"name"');
    });

    it('lets HAVING reference a formula output column on a table shape', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseEventFormulaConfig,
          displayType: DisplayType.Table,
          granularity: undefined,
          groupBy: 'ServiceName',
          formulas: [{ expression: 'A / B', alias: 'err rate' }],
          having: '"err rate" > 0.5',
          havingLanguage: 'sql',
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql.match(/HAVING/g)).toHaveLength(1);
      expect(sql.indexOf('HAVING')).toBeGreaterThan(sql.indexOf('GROUP BY'));
    });

    it('renders a single-series chart with a formula in one scan', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...baseEventFormulaConfig,
          select: [
            {
              aggFn: 'count' as const,
              valueExpression: '',
              aggCondition: '',
              alias: 'total',
            },
          ],
          formulas: [{ expression: 'A * 100', alias: 'pct' }],
        },
        mockMetadata,
        querySettings,
      );
      const sql = parameterizedQueryToSql(generatedSql);
      expect(sql).not.toContain('UNION ALL');
      expect(sql).toContain('AS "total"');
      expect(sql).toContain('(coalesce(count(), 0) * 100) AS "pct"');
    });

    it('throws a structured error for an invalid persisted formula', async () => {
      await expect(
        renderChartConfig(
          {
            ...baseEventFormulaConfig,
            formulas: [{ expression: 'A / C' }],
          },
          mockMetadata,
          querySettings,
        ),
      ).rejects.toThrow(
        'Invalid formula "A / C": Unknown series "C" — this chart only has series A through B',
      );
    });
  });
});
