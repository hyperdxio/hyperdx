import { renderBuilderConfigAsSqlTemplate as renderBuilderConfigAsSqlTemplateResult } from '@/core/builderToRawSql';
import { Metadata } from '@/core/metadata';
import { validateRawSqlForAlert } from '@/core/utils';
import { replaceMacros } from '@/macros';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
  SelectList,
} from '@/types';

// Most tests here assert on the generated SQL. This wrapper unwraps the
// {sql}|{error} result to the SQL string (or null when the config was
// rejected), so the behavioral assertions stay focused; the "error results"
// block below covers the {error} messages via the raw function.
async function renderBuilderConfigAsSqlTemplate(
  ...args: Parameters<typeof renderBuilderConfigAsSqlTemplateResult>
): Promise<string | null> {
  const result = await renderBuilderConfigAsSqlTemplateResult(...args);
  return result.isError ? null : result.sql;
}

describe('renderBuilderConfigAsSqlTemplate', () => {
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
      { name: 'date', type: 'Date' },
      { name: 'value', type: 'Float64' },
      { name: 'ServiceName', type: 'String' },
    ];
    mockMetadata = {
      getColumns: jest.fn().mockResolvedValue(columns),
      getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(new Map()),
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

  const baseLineConfig: ChartConfigWithOptDateRange = {
    displayType: DisplayType.Line,
    connection: 'test-connection',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
    groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
    where: 'ServiceName:api',
    whereLanguage: 'lucene',
    timestampValueExpression: 'timestamp',
    granularity: '1 minute',
  };

  it('generates a macro-based template for a line chart with group-by and lucene where', async () => {
    const sql = await renderBuilderConfigAsSqlTemplate(
      baseLineConfig,
      mockMetadata,
    );

    expect(sql).not.toBeNull();
    expect(sql).toContain('$__fromTime_ms');
    expect(sql).toContain('$__toTime_ms');
    expect(sql).toContain('$__timeInterval(timestamp)');
    expect(sql).toContain('$__sourceTable');
    expect(sql).toContain('$__filters');
    expect(sql).toContain('`__hdx_time_bucket`');
    // No hardcoded table, interval, or unbound render params
    expect(sql).not.toContain('otel_logs');
    expect(sql).not.toContain('HYPERDX_PARAM_');
    expect(sql).not.toMatch(/INTERVAL 1 minute/i);
    expect(sql).toMatchSnapshot();
  });

  it('generates a template without interval macros for a table chart and inlines LIMIT', async () => {
    const sql = await renderBuilderConfigAsSqlTemplate(
      {
        ...baseLineConfig,
        displayType: DisplayType.Table,
        granularity: undefined,
        orderBy: 'count() DESC',
        limit: { limit: 100 },
      },
      mockMetadata,
    );

    expect(sql).not.toBeNull();
    expect(sql).toContain('$__fromTime_ms');
    expect(sql).toContain('$__toTime_ms');
    expect(sql).toContain('$__sourceTable');
    // intervalSeconds is not bound for Table charts, so no interval macro
    expect(sql).not.toContain('$__timeInterval');
    expect(sql).not.toContain('intervalSeconds');
    expect(sql).toMatch(/LIMIT\s+100/);
    expect(sql).not.toContain('HYPERDX_PARAM_');
  });

  it('strips granularity for a table chart even when the form carries one', async () => {
    const sql = await renderBuilderConfigAsSqlTemplate(
      { ...baseLineConfig, displayType: DisplayType.Table },
      mockMetadata,
    );
    expect(sql).not.toBeNull();
    expect(sql).not.toContain('$__timeInterval');
  });

  it.each([DisplayType.Bar, DisplayType.Pie])(
    'carries seriesLimit into the SQL as a LIMIT (with default value-desc ORDER BY) for a %s chart',
    async displayType => {
      const sql = await renderBuilderConfigAsSqlTemplate(
        {
          ...baseLineConfig,
          displayType,
          // Categorical charts carry a string groupBy (as the chart editor
          // produces) and render seriesLimit as a plain SQL LIMIT.
          groupBy: 'ServiceName',
          seriesLimit: 2,
        },
        mockMetadata,
      );
      expect(sql).not.toBeNull();
      expect(sql).toContain('$__fromTime_ms');
      expect(sql).toContain('$__toTime_ms');
      expect(sql).toContain('$__sourceTable');
      expect(sql).toContain('$__filters');
      expect(sql).toContain('GROUP BY');
      // Categorical (not time series) → no interval macro / bucketing.
      expect(sql).not.toContain('$__timeInterval');
      expect(sql).not.toContain('intervalSeconds');
      // seriesLimit is carried over as a plain LIMIT...
      expect(sql).toMatch(/LIMIT\s+2/);
      // ...ordered by the first aggregated value descending so the limit
      // deterministically keeps the largest bars/slices.
      expect(sql).toMatch(/ORDER BY[\s\S]*DESC/i);
      expect(sql).not.toContain('HYPERDX_PARAM_');
    },
  );

  it('does not add a LIMIT to a categorical chart without a seriesLimit', async () => {
    const sql = await renderBuilderConfigAsSqlTemplate(
      { ...baseLineConfig, displayType: DisplayType.Bar },
      mockMetadata,
    );
    expect(sql).not.toBeNull();
    expect(sql).not.toMatch(/LIMIT/i);
  });

  it.each(['auto' as const, undefined])(
    'emits $__timeInterval for a line chart with granularity=%s',
    async granularity => {
      const sql = await renderBuilderConfigAsSqlTemplate(
        { ...baseLineConfig, granularity },
        mockMetadata,
      );
      expect(sql).not.toBeNull();
      expect(sql).toContain('$__timeInterval(timestamp)');
    },
  );

  it('wraps time-range macros for a Date-typed timestamp column', async () => {
    const sql = await renderBuilderConfigAsSqlTemplate(
      { ...baseLineConfig, timestampValueExpression: 'date' },
      mockMetadata,
    );
    expect(sql).not.toBeNull();
    expect(sql).toContain('toDate($__fromTime_ms)');
    expect(sql).toContain('toDate($__toTime_ms)');
  });

  it('macro-izes every condition of a multi-column timestamp expression', async () => {
    const sql = await renderBuilderConfigAsSqlTemplate(
      { ...baseLineConfig, timestampValueExpression: 'date, timestamp' },
      mockMetadata,
    );
    expect(sql).not.toBeNull();
    expect(sql?.match(/\$__fromTime_ms/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql?.match(/\$__toTime_ms/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).not.toContain('HYPERDX_PARAM_');
  });

  it('macro-izes the series-limit CTE and inlines its LIMIT', async () => {
    const sql = await renderBuilderConfigAsSqlTemplate(
      { ...baseLineConfig, seriesLimit: 5 },
      mockMetadata,
    );
    expect(sql).not.toBeNull();
    expect(sql).toContain('__hdx_series_limit');
    expect(sql).toMatch(/LIMIT\s+5/);
    // The CTE reuses the FROM/WHERE fragments, so macros must appear there too
    expect(sql?.match(/\$__sourceTable/g)?.length).toBe(2);
    expect(sql).not.toContain('HYPERDX_PARAM_');
    expect(sql).toMatchSnapshot();
  });

  describe('metric charts (single-series only)', () => {
    const metricTables = {
      gauge: 'otel_metrics_gauge',
      histogram: 'otel_metrics_histogram',
      sum: 'otel_metrics_sum',
      summary: 'otel_metrics_summary',
      'exponential histogram': 'otel_metrics_exponential_histogram',
    };

    const metricLineConfig = (
      metricType: MetricsDataType,
      aggFn = 'avg',
    ): ChartConfigWithOptDateRange => ({
      displayType: DisplayType.Line,
      connection: 'test-connection',
      // Metric sources carry no single `from.tableName`; the table comes from
      // metricTables per metric type.
      from: { databaseName: 'default', tableName: '' },
      metricTables,
      select: [
        {
          aggFn: aggFn as any,
          aggCondition: '',
          valueExpression: 'Value',
          metricType,
          metricName: 'my.metric',
        },
      ],
      where: '',
      whereLanguage: 'lucene',
      timestampValueExpression: 'TimeUnix',
      granularity: '1 minute',
    });

    it('generates a macro-based template for a single-series gauge metric line chart', async () => {
      const sql = await renderBuilderConfigAsSqlTemplate(
        metricLineConfig(MetricsDataType.Gauge),
        mockMetadata,
      );
      expect(sql).not.toBeNull();
      // The table is emitted as the typed source-table macro, not hardcoded.
      expect(sql).toContain('$__sourceTable(gauge)');
      expect(sql).not.toContain('otel_metrics_gauge');
      // Still wired to the dashboard time range and granularity.
      expect(sql).toContain('$__fromTime_ms');
      expect(sql).toContain('$__toTime_ms');
      expect(sql).toContain('$__timeInterval');
      expect(sql).not.toContain('HYPERDX_PARAM_');
      expect(sql).not.toMatch(/INTERVAL 1 minute/i);
      expect(sql).toMatchSnapshot();
    });

    it('generates a macro-based template for a single-series sum metric line chart', async () => {
      const sql = await renderBuilderConfigAsSqlTemplate(
        metricLineConfig(MetricsDataType.Sum),
        mockMetadata,
      );
      expect(sql).not.toBeNull();
      expect(sql).toContain('$__sourceTable(sum)');
      expect(sql).not.toContain('otel_metrics_sum');
      // Sum widens the source window by one bucket; that widening is expressed
      // with the $__interval_s macro so it stays wired to the granularity.
      expect(sql).toContain('$__interval_s');
      expect(sql).not.toContain('HYPERDX_PARAM_');
      expect(sql).toMatchSnapshot();
    });

    it('generates a macro-based template for a single-series histogram metric line chart', async () => {
      const config = metricLineConfig(MetricsDataType.Histogram, 'quantile');
      const sql = await renderBuilderConfigAsSqlTemplate(
        {
          ...config,
          // Histograms support quantile (with a level) or count.
          select: [{ ...((config as any).select as any[])[0], level: 0.95 }],
        },
        mockMetadata,
      );
      expect(sql).not.toBeNull();
      expect(sql).toContain('$__sourceTable(histogram)');
      expect(sql).not.toContain('otel_metrics_histogram');
      expect(sql).not.toContain('HYPERDX_PARAM_');
      expect(sql).toMatchSnapshot();
    });

    it('resolves the metric source-table macro through replaceMacros', async () => {
      const sqlTemplate = await renderBuilderConfigAsSqlTemplate(
        metricLineConfig(MetricsDataType.Gauge),
        mockMetadata,
      );
      expect(sqlTemplate).not.toBeNull();

      const expanded = replaceMacros({
        sqlTemplate: sqlTemplate!,
        from: { databaseName: 'default', tableName: '' },
        metricTables,
      });
      expect(expanded).not.toContain('$__');
      // $__sourceTable(gauge) resolves against metricTables.
      expect(expanded).toContain('`default`.`otel_metrics_gauge`');
    });

    it('returns null for a multi-series metric chart', async () => {
      const config = metricLineConfig(MetricsDataType.Gauge);
      const sql = await renderBuilderConfigAsSqlTemplate(
        {
          ...config,
          select: [
            ...((config as any).select as any[]),
            {
              aggFn: 'sum',
              aggCondition: '',
              valueExpression: 'Value',
              metricType: MetricsDataType.Gauge,
              metricName: 'my.other.metric',
            },
          ],
        },
        mockMetadata,
      );
      expect(sql).toBeNull();
    });

    it('returns null for a non-time-series metric chart', async () => {
      const sql = await renderBuilderConfigAsSqlTemplate(
        {
          ...metricLineConfig(MetricsDataType.Gauge),
          displayType: DisplayType.Number,
          granularity: undefined,
        },
        mockMetadata,
      );
      expect(sql).toBeNull();
    });
  });

  it('returns null for string selects and unsupported display types', async () => {
    await expect(
      renderBuilderConfigAsSqlTemplate(
        {
          ...baseLineConfig,
          displayType: DisplayType.Search,
          select: 'timestamp, ServiceName',
        },
        mockMetadata,
      ),
    ).resolves.toBeNull();

    await expect(
      renderBuilderConfigAsSqlTemplate(
        { ...baseLineConfig, displayType: DisplayType.Heatmap },
        mockMetadata,
      ),
    ).resolves.toBeNull();
  });

  it('returns null for raw SQL and PromQL configs', async () => {
    await expect(
      renderBuilderConfigAsSqlTemplate(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT 1',
          connection: 'test-connection',
        },
        mockMetadata,
      ),
    ).resolves.toBeNull();

    await expect(
      renderBuilderConfigAsSqlTemplate(
        {
          configType: 'promql',
          promqlExpression: 'up',
          connection: 'test-connection',
        },
        mockMetadata,
      ),
    ).resolves.toBeNull();
  });

  describe('error results', () => {
    const metricConfig: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: '' },
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
      select: [
        {
          aggFn: 'avg',
          aggCondition: '',
          valueExpression: 'Value',
          metricType: MetricsDataType.Gauge,
          metricName: 'my.metric',
        },
      ],
      where: '',
      whereLanguage: 'lucene',
      timestampValueExpression: 'TimeUnix',
      granularity: '1 minute',
    };

    it('reports a specific reason for a multi-series metric chart', async () => {
      const result = await renderBuilderConfigAsSqlTemplateResult(
        {
          ...metricConfig,
          select: [
            ...(metricConfig.select as any[]),
            {
              aggFn: 'sum',
              aggCondition: '',
              valueExpression: 'Value',
              metricType: MetricsDataType.Gauge,
              metricName: 'my.other.metric',
            },
          ],
        },
        mockMetadata,
      );
      expect(result).toEqual({
        isError: true,
        error: 'Multi-series metric charts cannot be auto-converted to SQL.',
      });
    });

    it('reports a specific reason for a non-time-series metric chart', async () => {
      const result = await renderBuilderConfigAsSqlTemplateResult(
        {
          ...metricConfig,
          displayType: DisplayType.Table,
          granularity: undefined,
        },
        mockMetadata,
      );
      expect(result).toEqual({
        isError: true,
        error:
          'Metric charts can only be auto-converted to SQL for time series display types.',
      });
    });

    it('reports a missing-source reason when the source table is unset', async () => {
      const result = await renderBuilderConfigAsSqlTemplateResult(
        {
          ...baseLineConfig,
          from: { databaseName: '', tableName: '' },
        },
        mockMetadata,
      );
      expect(result).toEqual({
        isError: true,
        error: 'Auto-converting to SQL requires a source to be selected.',
      });
    });

    it('reports an unconvertible-chart reason for unsupported display types', async () => {
      const result = await renderBuilderConfigAsSqlTemplateResult(
        { ...baseLineConfig, displayType: DisplayType.Heatmap },
        mockMetadata,
      );
      expect(result).toEqual({
        isError: true,
        error: 'This chart type cannot be auto-converted to SQL.',
      });
    });

    it('returns the generated SQL under the `sql` key on success', async () => {
      const result = await renderBuilderConfigAsSqlTemplateResult(
        baseLineConfig,
        mockMetadata,
      );
      expect(result).toHaveProperty('sql');
      expect((result as { sql: string }).sql).toContain('$__sourceTable');
    });
  });

  it('round-trips through replaceMacros into an executable, alert-valid query', async () => {
    const sqlTemplate = await renderBuilderConfigAsSqlTemplate(
      baseLineConfig,
      mockMetadata,
    );
    expect(sqlTemplate).not.toBeNull();

    const expanded = replaceMacros({
      sqlTemplate: sqlTemplate!,
      from: { databaseName: 'default', tableName: 'otel_logs' },
    });
    // All macros resolved; only the documented raw-SQL query params remain
    expect(expanded).not.toContain('$__');
    expect(expanded).toContain('{startDateMilliseconds:Int64}');
    expect(expanded).toContain('{endDateMilliseconds:Int64}');
    expect(expanded).toContain('{intervalSeconds:Int64}');
    expect(expanded).toContain('`default`.`otel_logs`');

    const { errors } = validateRawSqlForAlert({
      configType: 'sql',
      sqlTemplate: sqlTemplate!,
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      displayType: DisplayType.Line,
    });
    expect(errors).toEqual([]);
  });

  /**
   * Full-output snapshots, one per raw-SQL-capable display type, each
   * populated with every clause that display type exposes in the chart
   * builder (see ChartEditorControls / ChartActionBar / ChartDisplaySettingsDrawer):
   *
   *   - Line / StackedBar (time tab): multi-series, WHERE, GROUP BY,
   *     granularity (time bucket), series limit.
   *   - Table: multi-series, WHERE, GROUP BY, HAVING, ORDER BY.
   *   - Pie: single series, WHERE, GROUP BY.
   *   - Number: single series, WHERE.
   *
   * These lock in the exact generated SQL so regressions in how any clause
   * is turned into macros are caught.
   */
  describe('full SQL output per display type', () => {
    // Shared source-level fields every builder config carries.
    const sourceFields = {
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'timestamp',
      where: 'ServiceName:api',
      whereLanguage: 'lucene' as const,
    };

    const twoSeries = [
      { aggFn: 'count' as const, aggCondition: '', valueExpression: '' },
      { aggFn: 'avg' as const, aggCondition: '', valueExpression: 'Duration' },
    ];
    const groupBy = [{ aggCondition: '', valueExpression: 'ServiceName' }];

    const configs: Record<string, ChartConfigWithOptDateRange> = {
      // Time-series charts: multi-series + group by + granularity + series limit.
      [DisplayType.Line]: {
        ...sourceFields,
        displayType: DisplayType.Line,
        select: twoSeries,
        groupBy,
        granularity: '5 minute',
        seriesLimit: 10,
      },
      [DisplayType.StackedBar]: {
        ...sourceFields,
        displayType: DisplayType.StackedBar,
        select: twoSeries,
        groupBy,
        granularity: '5 minute',
        seriesLimit: 10,
      },
      // Table: multi-series + group by + having + order by (no time bucket).
      [DisplayType.Table]: {
        ...sourceFields,
        displayType: DisplayType.Table,
        select: twoSeries,
        groupBy,
        having: 'count() > 5',
        havingLanguage: 'sql',
        orderBy: 'count() DESC',
      },
      // Pie: single series + group by (max one series, no order/having).
      [DisplayType.Pie]: {
        ...sourceFields,
        displayType: DisplayType.Pie,
        select: [twoSeries[0]],
        groupBy,
      },
      // Number: single series + where only (no group by / granularity).
      [DisplayType.Number]: {
        ...sourceFields,
        displayType: DisplayType.Number,
        select: [twoSeries[0]],
      },
    };

    it.each(Object.keys(configs))(
      'generates the full macro-based SQL for a %s chart',
      async (displayType: string) => {
        const sql = await renderBuilderConfigAsSqlTemplate(
          // eslint-disable-next-line security/detect-object-injection
          configs[displayType],
          mockMetadata,
        );
        expect(sql).not.toBeNull();
        expect(sql).not.toContain('HYPERDX_PARAM_');
        expect(sql).toMatchSnapshot();
      },
    );
  });

  /**
   * Series-level WHERE — the path the chart builder actually takes.
   *
   * In the chart editor the WHERE for a series is stored per-series on
   * `select[].aggCondition` / `aggConditionLanguage` (see
   * EditTimeChartForm's `series` field), NOT on the top-level `where`.
   * renderChartConfig turns a series' aggCondition into an `-If` combinator
   * at the aggregate function (countIf/avgIf/...), and — only when *every*
   * series is filtered — also OR's those conditions into the WHERE clause so
   * the primary index can still be used. These tests lock in that the
   * builder-to-SQL conversion carries the per-series filters through as
   * `-If` combinators (and macro-izes the surrounding query the same way).
   */
  describe('series-level WHERE (aggCondition → -If combinators)', () => {
    const seriesLevelConfig = (
      select: SelectList,
    ): ChartConfigWithOptDateRange => ({
      displayType: DisplayType.Line,
      connection: 'test-connection',
      from: { databaseName: 'default', tableName: 'otel_logs' },
      select,
      groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
      // No top-level where — the filter lives on the series, as it does in
      // the chart editor.
      where: '',
      whereLanguage: 'lucene',
      timestampValueExpression: 'timestamp',
      granularity: '1 minute',
    });

    it('renders a single filtered series as an -If combinator', async () => {
      const sql = await renderBuilderConfigAsSqlTemplate(
        seriesLevelConfig([
          {
            aggFn: 'count',
            aggCondition: 'ServiceName:api',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
        ]),
        mockMetadata,
      );
      expect(sql).not.toBeNull();
      expect(sql).not.toContain('HYPERDX_PARAM_');
      expect(sql).toMatchSnapshot();
    });

    it('renders one -If per series and OR-pushes conditions when every series is filtered', async () => {
      const sql = await renderBuilderConfigAsSqlTemplate(
        seriesLevelConfig([
          {
            aggFn: 'count',
            aggCondition: 'ServiceName:api',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
          {
            aggFn: 'avg',
            aggCondition: 'ServiceName:web',
            aggConditionLanguage: 'lucene',
            valueExpression: 'value',
          },
        ]),
        mockMetadata,
      );
      expect(sql).not.toBeNull();
      expect(sql).not.toContain('HYPERDX_PARAM_');
      expect(sql).toMatchSnapshot();
    });

    it('keeps -If per series but does not push to WHERE when only some series are filtered', async () => {
      const sql = await renderBuilderConfigAsSqlTemplate(
        seriesLevelConfig([
          {
            aggFn: 'count',
            aggCondition: 'ServiceName:api',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
          { aggFn: 'avg', aggCondition: '', valueExpression: 'value' },
        ]),
        mockMetadata,
      );
      expect(sql).not.toBeNull();
      expect(sql).not.toContain('HYPERDX_PARAM_');
      expect(sql).toMatchSnapshot();
    });

    it('supports a sql-language series aggCondition', async () => {
      const sql = await renderBuilderConfigAsSqlTemplate(
        seriesLevelConfig([
          {
            aggFn: 'count',
            aggCondition: "ServiceName = 'api'",
            aggConditionLanguage: 'sql',
            valueExpression: '',
          },
        ]),
        mockMetadata,
      );
      expect(sql).not.toBeNull();
      expect(sql).not.toContain('HYPERDX_PARAM_');
      expect(sql).toMatchSnapshot();
    });

    it('tightens the two argument lists of a parametric combinator', async () => {
      // A quantile series with a series-level filter renders as
      // `quantileIf(level)(expr, condition)`; the formatter must not leave a
      // space before either paren.
      const sql = await renderBuilderConfigAsSqlTemplate(
        seriesLevelConfig([
          {
            aggFn: 'quantile',
            level: 0.95,
            aggCondition: 'ServiceName:api',
            aggConditionLanguage: 'lucene',
            valueExpression: 'value',
          },
        ]),
        mockMetadata,
      );
      expect(sql).not.toBeNull();
      expect(sql).not.toContain('HYPERDX_PARAM_');
      expect(sql).toMatchSnapshot();
    });

    it('round-trips a series-level -If template into an executable, alert-valid query', async () => {
      const sqlTemplate = await renderBuilderConfigAsSqlTemplate(
        seriesLevelConfig([
          {
            aggFn: 'count',
            aggCondition: 'ServiceName:api',
            aggConditionLanguage: 'lucene',
            valueExpression: '',
          },
          {
            aggFn: 'avg',
            aggCondition: 'ServiceName:web',
            aggConditionLanguage: 'lucene',
            valueExpression: 'value',
          },
        ]),
        mockMetadata,
      );
      expect(sqlTemplate).not.toBeNull();

      const expanded = replaceMacros({
        sqlTemplate: sqlTemplate!,
        from: { databaseName: 'default', tableName: 'otel_logs' },
      });
      expect(expanded).not.toContain('$__');
      expect(expanded).toMatch(/countIf\s*\(/);
      expect(expanded).toContain('`default`.`otel_logs`');

      const { errors } = validateRawSqlForAlert({
        configType: 'sql',
        sqlTemplate: sqlTemplate!,
        connection: 'test-connection',
        from: { databaseName: 'default', tableName: 'otel_logs' },
        displayType: DisplayType.Line,
      });
      expect(errors).toEqual([]);
    });
  });
});
