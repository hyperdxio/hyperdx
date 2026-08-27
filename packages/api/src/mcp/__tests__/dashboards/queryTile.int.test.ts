import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  bucketExponentialHistogramObservations,
  bulkInsertLogs,
  bulkInsertMetricsGauge,
  bulkInsertMetricsHistogram,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  DEFAULT_METRICS_TABLE,
  seedExponentialHistogramMetric,
} from '@/fixtures';
import { callTool, getFirstText } from '@/mcp/__tests__/mcpTestUtils';
import { Source } from '@/models/source';

import { setupDashboardTests } from './setup';

describe('MCP Dashboard Tools - clickstack_query_tile', () => {
  const ctx = setupDashboardTests();

  it('should return error for non-existent dashboard', async () => {
    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: '000000000000000000000000',
      tileId: 'some-tile-id',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('not found');
  });

  it('should return error for non-existent tile', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Tile Query Test',
        tiles: [
          {
            name: 'My Tile',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const dashboard = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: 'non-existent-tile-id',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Tile not found');
  });

  it('should return error for invalid time range', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Time Range Test',
        tiles: [
          {
            name: 'Tile',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const dashboard = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: dashboard.tiles[0].id,
      startTime: 'not-a-date',
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Invalid');
  });

  it('should execute query for a valid tile', async () => {
    const sourceId = ctx.traceSource._id.toString();
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Query Tile Test',
        tiles: [
          {
            name: 'Count Tile',
            config: {
              displayType: 'number',
              sourceId,
              select: [{ aggFn: 'count' }],
            },
          },
        ],
      },
    );
    const dashboard = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: dashboard.tiles[0].id,
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      endTime: new Date().toISOString(),
    });

    // Should succeed (may have empty results since no data inserted)
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
  });

  it('should save and query a metric formula tile', async () => {
    const metricSource = await Source.create({
      kind: SourceKind.Metric,
      team: ctx.team._id,
      from: { databaseName: DEFAULT_DATABASE, tableName: '' },
      metricTables: {
        [MetricsDataType.Gauge.toLowerCase()]: DEFAULT_METRICS_TABLE.GAUGE,
      },
      timestampValueExpression: 'TimeUnix',
      connection: ctx.connection._id,
      name: 'Gauge Metrics',
    });
    const now = new Date();
    await bulkInsertMetricsGauge([
      {
        MetricName: 'formula.errors',
        ResourceAttributes: {},
        ServiceName: 'api',
        TimeUnix: now,
        Value: 10,
      },
      {
        MetricName: 'formula.requests',
        ResourceAttributes: {},
        ServiceName: 'api',
        TimeUnix: now,
        Value: 200,
      },
    ]);

    const formulas = [{ expression: 'A / B * 100', alias: 'Error rate %' }];
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Formula Dashboard',
        tiles: [
          {
            name: 'Error rate',
            config: {
              displayType: 'line',
              sourceId: metricSource._id.toString(),
              select: [
                {
                  aggFn: 'max',
                  metricType: 'gauge',
                  metricName: 'formula.errors',
                  alias: 'Errors',
                },
                {
                  aggFn: 'max',
                  metricType: 'gauge',
                  metricName: 'formula.requests',
                  alias: 'Requests',
                },
              ],
              formulas,
              showOperandSeries: false,
            },
          },
        ],
      },
    );
    if (createResult.isError) {
      throw new Error(getFirstText(createResult));
    }
    const dashboard = JSON.parse(getFirstText(createResult));
    // The formula config round-trips through the save response.
    expect(dashboard.tiles[0].config.formulas).toEqual(formulas);
    expect(dashboard.tiles[0].config.showOperandSeries).toBe(false);

    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: dashboard.tiles[0].id,
      startTime: new Date(now.getTime() - 60_000).toISOString(),
      endTime: new Date(now.getTime() + 60_000).toISOString(),
    });

    expect(result.isError).toBeFalsy();
    const parsed: {
      result: { data: Array<Record<string, unknown>> };
    } = JSON.parse(getFirstText(result));
    const rows = parsed.result.data;
    expect(rows.length).toBeGreaterThan(0);
    // The formula column is computed in ClickHouse (10 / 200 * 100 = 5) and,
    // with showOperandSeries: false, the raw operand columns are hidden.
    expect(Number(rows[0]['Error rate %'])).toBe(5);
    expect(rows[0]).not.toHaveProperty('Errors');
    expect(rows[0]).not.toHaveProperty('Requests');
  });

  it('should save and query a log-source formula tile', async () => {
    // Event (log/trace) formulas render through a different path than
    // metric formulas (inline single-scan SELECT vs the composed query),
    // so cover them end-to-end: save → round-trip → query_tile.
    const logSource = await Source.create({
      kind: SourceKind.Log,
      team: ctx.team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_LOGS_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: ctx.connection._id,
      name: 'Formula Logs',
      bodyExpression: 'Body',
      severityTextExpression: 'SeverityText',
    });
    const now = new Date();
    await bulkInsertLogs([
      ...Array.from({ length: 3 }, (_, i) => ({
        Body: `formula error log ${i}`,
        ServiceName: 'api',
        SeverityText: 'error',
        Timestamp: now,
      })),
      ...Array.from({ length: 9 }, (_, i) => ({
        Body: `formula info log ${i}`,
        ServiceName: 'api',
        SeverityText: 'info',
        Timestamp: now,
      })),
    ]);

    const formulas = [{ expression: 'A / B * 100', alias: 'Error rate %' }];
    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Log Formula Dashboard',
        tiles: [
          {
            name: 'Log error rate',
            config: {
              displayType: 'number',
              sourceId: logSource._id.toString(),
              select: [
                {
                  aggFn: 'count',
                  where: 'SeverityText:error',
                  alias: 'Errors',
                },
                { aggFn: 'count', alias: 'Total' },
              ],
              formulas,
            },
          },
        ],
      },
    );
    if (createResult.isError) {
      throw new Error(getFirstText(createResult));
    }
    const dashboard = JSON.parse(getFirstText(createResult));
    expect(dashboard.tiles[0].config.formulas).toEqual(formulas);

    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: dashboard.tiles[0].id,
      startTime: new Date(now.getTime() - 60_000).toISOString(),
      endTime: new Date(now.getTime() + 60_000).toISOString(),
    });

    expect(result.isError).toBeFalsy();
    const parsed: {
      result: { data: Array<Record<string, unknown>> };
    } = JSON.parse(getFirstText(result));
    const rows = parsed.result.data;
    expect(rows.length).toBeGreaterThan(0);
    // 3 errors / 12 total * 100 = 25; number tiles always hide operands.
    expect(Number(rows[0]['Error rate %'])).toBe(25);
    expect(rows[0]).not.toHaveProperty('Errors');
    expect(rows[0]).not.toHaveProperty('Total');
  });

  it('should reject a formula tile on a formula-incapable source kind', async () => {
    const sessionSource = await Source.create({
      kind: SourceKind.Session,
      team: ctx.team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: 'rrweb_events',
      },
      timestampValueExpression: 'Timestamp',
      traceSourceId: ctx.traceSource._id.toString(),
      connection: ctx.connection._id,
      name: 'Sessions',
    });

    const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
      name: 'Bad Formula Dashboard',
      tiles: [
        {
          name: 'Formula on sessions',
          config: {
            displayType: 'line',
            sourceId: sessionSource._id.toString(),
            select: [
              { aggFn: 'count', alias: 'A' },
              { aggFn: 'count', alias: 'B' },
            ],
            formulas: [{ expression: 'A / B' }],
          },
        },
      ],
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain(
      'require a Metric, Log, or Trace source',
    );
  });

  it('should reject a formula referencing an unknown series', async () => {
    const metricSource = await Source.create({
      kind: SourceKind.Metric,
      team: ctx.team._id,
      from: { databaseName: DEFAULT_DATABASE, tableName: '' },
      metricTables: {
        [MetricsDataType.Gauge.toLowerCase()]: DEFAULT_METRICS_TABLE.GAUGE,
      },
      timestampValueExpression: 'TimeUnix',
      connection: ctx.connection._id,
      name: 'Gauge Metrics Invalid Formula',
    });

    const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
      name: 'Invalid Formula Dashboard',
      tiles: [
        {
          name: 'Unknown ref',
          config: {
            displayType: 'line',
            sourceId: metricSource._id.toString(),
            select: [
              {
                aggFn: 'max',
                metricType: 'gauge',
                metricName: 'formula.errors',
              },
            ],
            formulas: [{ expression: 'A / B' }],
          },
        },
      ],
    });

    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('Unknown series');
  });

  it('should save and query an exponential histogram tile', async () => {
    const metricSource = await Source.create({
      kind: SourceKind.Metric,
      team: ctx.team._id,
      from: { databaseName: DEFAULT_DATABASE, tableName: '' },
      metricTables: {
        [MetricsDataType.ExponentialHistogram.toLowerCase()]:
          DEFAULT_METRICS_TABLE.EXPONENTIAL_HISTOGRAM,
      },
      timestampValueExpression: 'TimeUnix',
      connection: ctx.connection._id,
      name: 'Exponential Metrics',
    });
    const now = new Date();
    await seedExponentialHistogramMetric({
      metricName: 'http.server.request.duration.exponential',
      aggregationTemporality: 1,
      points: [
        {
          TimeUnix: now,
          ...bucketExponentialHistogramObservations([2, 4, 8]),
        },
      ],
    });

    const createResult = await callTool(
      ctx.client!,
      'clickstack_save_dashboard',
      {
        name: 'Exponential Histogram Dashboard',
        tiles: [
          {
            name: 'P95 Duration',
            config: {
              displayType: 'line',
              sourceId: metricSource._id.toString(),
              select: [
                {
                  aggFn: 'quantile',
                  level: 0.95,
                  metricType: 'exponential histogram',
                  metricName: 'http.server.request.duration.exponential',
                  alias: 'P95 Duration',
                },
              ],
            },
          },
        ],
      },
    );
    if (createResult.isError) {
      throw new Error(getFirstText(createResult));
    }
    const dashboard = JSON.parse(getFirstText(createResult));

    const result = await callTool(ctx.client!, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: dashboard.tiles[0].id,
      startTime: new Date(now.getTime() - 60_000).toISOString(),
      endTime: new Date(now.getTime() + 60_000).toISOString(),
    });

    expect(result.isError).toBeFalsy();
  });

  // Regression: a metric source rendered as a categorical (bar/pie) tile with a
  // groupBy runs the chart config through convertToCategoricalChartConfig, which
  // structuredClones it. `source.metricTables` is a live Mongoose subdocument
  // that structuredClone cannot copy, so the tile used to fail with
  // "DataCloneError: [object Array] could not be cloned". These cover the
  // grouped bar/pie histogram paths that surface a group-array column.
  describe('metric histogram categorical (bar/pie) tiles with groupBy', () => {
    const now = new Date();

    it('queries a grouped bar tile over an exponential histogram', async () => {
      const metricSource = await Source.create({
        kind: SourceKind.Metric,
        team: ctx.team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: '' },
        metricTables: {
          [MetricsDataType.ExponentialHistogram.toLowerCase()]:
            DEFAULT_METRICS_TABLE.EXPONENTIAL_HISTOGRAM,
        },
        timestampValueExpression: 'TimeUnix',
        connection: ctx.connection._id,
        name: 'Exponential Metrics Bar',
      });
      await seedExponentialHistogramMetric({
        metricName: 'exp.histogram.by.route',
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: now,
            Attributes: { route: '/a' },
            ...bucketExponentialHistogramObservations([2, 4, 8]),
          },
          {
            TimeUnix: now,
            Attributes: { route: '/b' },
            ...bucketExponentialHistogramObservations([1, 2]),
          },
        ],
      });

      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Exp Histogram Bar Dashboard',
          tiles: [
            {
              name: 'P95 by route',
              config: {
                displayType: 'bar',
                sourceId: metricSource._id.toString(),
                groupBy: "Attributes['route']",
                select: [
                  {
                    aggFn: 'quantile',
                    level: 0.95,
                    metricType: 'exponential histogram',
                    metricName: 'exp.histogram.by.route',
                    alias: 'P95 Duration',
                  },
                ],
              },
            },
          ],
        },
      );
      if (createResult.isError) {
        throw new Error(getFirstText(createResult));
      }
      const dashboard = JSON.parse(getFirstText(createResult));

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime: new Date(now.getTime() - 60_000).toISOString(),
        endTime: new Date(now.getTime() + 60_000).toISOString(),
      });

      expect(result.isError).toBeFalsy();
      const parsed: { result: { data: Array<{ group?: string[] }> } } =
        JSON.parse(getFirstText(result));
      const rows = parsed.result.data;
      // Each row carries the group-array column that triggered the clone bug.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(r => Array.isArray(r.group))).toBe(true);
      const routes = rows
        .map(r => r.group?.[0])
        .filter((v): v is string => typeof v === 'string')
        .sort();
      expect(routes).toEqual(['/a', '/b']);
    });

    it('queries a grouped bar tile over a (regular) histogram', async () => {
      const metricSource = await Source.create({
        kind: SourceKind.Metric,
        team: ctx.team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: '' },
        metricTables: {
          [MetricsDataType.Histogram.toLowerCase()]:
            DEFAULT_METRICS_TABLE.HISTOGRAM,
        },
        timestampValueExpression: 'TimeUnix',
        connection: ctx.connection._id,
        name: 'Histogram Metrics Bar',
      });
      await bulkInsertMetricsHistogram([
        {
          MetricName: 'histogram.by.route',
          ResourceAttributes: {},
          Attributes: { route: '/a' },
          TimeUnix: now,
          Count: 3,
          BucketCounts: [1, 1, 1],
          ExplicitBounds: [1, 5],
          AggregationTemporality: 1,
        },
        {
          MetricName: 'histogram.by.route',
          ResourceAttributes: {},
          Attributes: { route: '/b' },
          TimeUnix: now,
          Count: 2,
          BucketCounts: [2, 0, 0],
          ExplicitBounds: [1, 5],
          AggregationTemporality: 1,
        },
      ]);

      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Histogram Bar Dashboard',
          tiles: [
            {
              name: 'P95 by route',
              config: {
                displayType: 'bar',
                sourceId: metricSource._id.toString(),
                groupBy: "Attributes['route']",
                select: [
                  {
                    aggFn: 'quantile',
                    level: 0.95,
                    metricType: 'histogram',
                    metricName: 'histogram.by.route',
                    alias: 'P95 Duration',
                  },
                ],
              },
            },
          ],
        },
      );
      if (createResult.isError) {
        throw new Error(getFirstText(createResult));
      }
      const dashboard = JSON.parse(getFirstText(createResult));

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime: new Date(now.getTime() - 60_000).toISOString(),
        endTime: new Date(now.getTime() + 60_000).toISOString(),
      });

      expect(result.isError).toBeFalsy();
      const parsed: { result: { data: Array<{ group?: string[] }> } } =
        JSON.parse(getFirstText(result));
      const rows = parsed.result.data;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(r => Array.isArray(r.group))).toBe(true);
    });
  });

  describe('raw SQL macro warnings', () => {
    it('attaches a non-blocking warning when a raw SQL tile omits macros', async () => {
      const connectionId = ctx.connection._id.toString();
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Query macro-less SQL tile',
          tiles: [
            {
              name: 'Static SQL',
              config: {
                configType: 'sql',
                displayType: 'table',
                connectionId,
                // Runs fine against ClickHouse but uses no time-range /
                // filter / source macros.
                sqlTemplate: 'SELECT 1 AS value LIMIT 1',
              },
            },
          ],
        },
      );
      const dashboard = JSON.parse(getFirstText(createResult));

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      // Non-blocking: the query still executes and returns its row.
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getFirstText(result));
      expect(parsed.result).toBeDefined();

      // The advisory rides alongside the result.
      expect(Array.isArray(parsed.warnings)).toBe(true);
      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.warnings[0]).toContain('Static SQL');
      expect(parsed.warnings[0]).toContain('$__timeFilter');
      expect(parsed.warnings[0]).toContain('strongly recommended');
    });

    it('does not attach warnings when a raw SQL tile uses all recommended macros', async () => {
      const connectionId = ctx.connection._id.toString();
      const sourceId = ctx.traceSource._id.toString();
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: 'Query macro SQL tile',
          tiles: [
            {
              name: 'Macro SQL',
              config: {
                configType: 'sql',
                displayType: 'table',
                connectionId,
                sourceId,
                sqlTemplate:
                  'SELECT ServiceName, count() AS c FROM $__sourceTable ' +
                  'WHERE $__timeFilter(Timestamp) AND $__filters GROUP BY ServiceName LIMIT 10',
              },
            },
          ],
        },
      );
      const dashboard = JSON.parse(getFirstText(createResult));

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getFirstText(result));
      expect(parsed.warnings).toBeUndefined();
    });
  });

  describe('dashboard variables', () => {
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const startTime = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 60 * 1000).toISOString();

    let logSourceId: string;

    beforeEach(async () => {
      const logSource = await Source.create({
        kind: SourceKind.Log,
        team: ctx.team._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        connection: ctx.connection._id,
        name: 'Variable Logs',
        bodyExpression: 'Body',
        severityTextExpression: 'SeverityText',
      });
      logSourceId = logSource._id.toString();

      await bulkInsertLogs([
        {
          Body: 'checkout one',
          ServiceName: 'checkout',
          SeverityText: 'INFO',
          Timestamp: tenMinAgo,
        },
        {
          Body: 'checkout two',
          ServiceName: 'checkout',
          SeverityText: 'INFO',
          Timestamp: new Date(tenMinAgo.getTime() + 10),
        },
        {
          Body: 'payments one',
          ServiceName: 'payments',
          SeverityText: 'INFO',
          Timestamp: new Date(tenMinAgo.getTime() + 20),
        },
      ]);
    });

    const variableFilter = () => ({
      type: 'QUERY_EXPRESSION' as const,
      name: 'Service',
      expression: 'ServiceName',
      sourceId: logSourceId,
      whereLanguage: 'sql' as const,
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'service',
    });

    const saveDashboard = async (tiles: unknown[]) => {
      const result = await callTool(ctx.client!, 'clickstack_save_dashboard', {
        name: 'Variable tiles',
        tiles,
        filters: [variableFilter()],
      });
      expect(result.isError).toBeFalsy();
      return JSON.parse(getFirstText(result));
    };

    const rowsOf = (text: string) => {
      const parsed = JSON.parse(text);
      const result = parsed.result;
      return Array.isArray(result) ? result : (result?.data ?? []);
    };

    const sqlTile = () => ({
      name: 'Rows by service',
      config: {
        configType: 'sql',
        displayType: 'table',
        connectionId: ctx.connection._id.toString(),
        sourceId: logSourceId,
        sqlTemplate:
          'SELECT ServiceName, count() AS c FROM $__sourceTable ' +
          'WHERE $__timeFilter(Timestamp) AND $__filters ' +
          'AND $__filter(ServiceName, service) ' +
          'GROUP BY ServiceName ORDER BY ServiceName LIMIT 10',
      },
    });

    const builderTile = () => ({
      name: 'Rows by service (builder)',
      config: {
        displayType: 'table',
        sourceId: logSourceId,
        groupBy: 'ServiceName',
        select: [
          {
            aggFn: 'count',
            alias: 'Count',
            where: '$__filter(ServiceName, service)',
            whereLanguage: 'sql',
          },
        ],
      },
    });

    const eventPatternsTile = (
      where = '$__filter(ServiceName, service)',
      whereLanguage: 'sql' | 'lucene' = 'sql',
    ) => ({
      name: 'Log patterns',
      config: {
        displayType: 'event_patterns',
        sourceId: logSourceId,
        select: 'Body',
        where,
        whereLanguage,
      },
    });

    const patternsOf = (text: string) => {
      const parsed = JSON.parse(text);
      return {
        totalCount: Number(parsed.summary.totalCount),
        sampledCount: Number(parsed.summary.sampledCount),
        bodies: Array.isArray(parsed.patterns)
          ? parsed.patterns.flatMap(p => ('samples' in p ? p.samples : []))
          : [],
      };
    };

    it('expands $__filter to a no-op on an event_patterns tile with nothing selected', async () => {
      const dashboard = await saveDashboard([eventPatternsTile()]);

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime,
        endTime,
      });

      expect(result.isError).toBeFalsy();
      const { totalCount, bodies } = patternsOf(getFirstText(result));
      // Nothing selected means the macro contributes no condition, so both
      // services are still mined.
      expect(totalCount).toBe(3);
      expect(bodies.some(b => b.includes('checkout'))).toBe(true);
      expect(bodies.some(b => b.includes('payments'))).toBe(true);
    });

    it('narrows an event_patterns tile when variableValues supplies a selection', async () => {
      const dashboard = await saveDashboard([eventPatternsTile()]);

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime,
        endTime,
        variableValues: [{ name: 'service', values: ['checkout'] }],
      });

      expect(result.isError).toBeFalsy();
      const { totalCount, sampledCount, bodies } = patternsOf(
        getFirstText(result),
      );
      // The selection narrows BOTH the sampled rows and the total count the
      // estimates are extrapolated from — the payments row is gone from each.
      expect(totalCount).toBe(2);
      expect(sampledCount).toBe(2);
      expect(bodies.some(b => b.includes('checkout'))).toBe(true);
      expect(bodies.some(b => b.includes('payments'))).toBe(false);
    });

    it('expands a Lucene variable reference on an event_patterns tile', async () => {
      // event_patterns tiles default to Lucene, where a reference renders as a
      // value list rather than a SQL predicate.
      const dashboard = await saveDashboard([
        eventPatternsTile('ServiceName:$service', 'lucene'),
      ]);

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime,
        endTime,
        variableValues: [{ name: 'service', values: ['payments'] }],
      });

      expect(result.isError).toBeFalsy();
      const { totalCount, bodies } = patternsOf(getFirstText(result));
      expect(totalCount).toBe(1);
      expect(bodies.some(b => b.includes('checkout'))).toBe(false);
      expect(bodies.some(b => b.includes('payments'))).toBe(true);
    });

    it('reports an event_patterns macro naming a variable the dashboard does not declare', async () => {
      const dashboard = await saveDashboard([
        eventPatternsTile('$__filter(ServiceName, tenant)'),
      ]);

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime,
        endTime,
      });

      // Expansion throws before ClickHouse sees anything, and the mining path
      // surfaces the same named error and hint as every other tile type.
      expect(result.isError).toBe(true);
      const text = getFirstText(result);
      expect(text).toContain("references unknown variable 'tenant'");
      expect(text).toContain('isVariableEnabled');
    });

    it('expands $__filter to a no-op on a raw SQL tile with nothing selected', async () => {
      // Before variables were threaded through, the macro text reached
      // ClickHouse verbatim and the tile died with a syntax error.
      const dashboard = await saveDashboard([sqlTile()]);

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime,
        endTime,
      });

      expect(result.isError).toBeFalsy();
      // Nothing selected means the macro contributes no condition, so every
      // service is still counted.
      expect(rowsOf(getFirstText(result))).toHaveLength(2);
    });

    it('narrows a raw SQL tile when variableValues supplies a selection', async () => {
      const dashboard = await saveDashboard([sqlTile()]);

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime,
        endTime,
        variableValues: [{ name: 'service', values: ['checkout'] }],
      });

      expect(result.isError).toBeFalsy();
      const rows = rowsOf(getFirstText(result));
      expect(rows).toHaveLength(1);
      expect(rows[0].ServiceName).toBe('checkout');
    });

    it('expands $__filter in a builder tile per-series where', async () => {
      const dashboard = await saveDashboard([builderTile()]);

      const unselected = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime,
        endTime,
      });
      expect(unselected.isError).toBeFalsy();
      expect(rowsOf(getFirstText(unselected))).toHaveLength(2);

      const selected = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime,
        endTime,
        variableValues: [{ name: 'service', values: ['payments'] }],
      });
      expect(selected.isError).toBeFalsy();
      const rows = rowsOf(getFirstText(selected));
      // countIf leaves the other group at zero rather than dropping it.
      const payments = rows.find(
        (r: Record<string, unknown>) => r.ServiceName === 'payments',
      );
      const checkout = rows.find(
        (r: Record<string, unknown>) => r.ServiceName === 'checkout',
      );
      expect(Number(payments?.Count)).toBe(1);
      expect(Number(checkout?.Count ?? 0)).toBe(0);
    });

    it('reports a macro naming a variable the dashboard does not declare', async () => {
      const dashboard = await saveDashboard([
        {
          name: 'Typo',
          config: {
            configType: 'sql',
            displayType: 'table',
            connectionId: ctx.connection._id.toString(),
            sourceId: logSourceId,
            sqlTemplate:
              'SELECT count() AS c FROM $__sourceTable ' +
              'WHERE $__timeFilter(Timestamp) AND $__filter(ServiceName, tenant) LIMIT 1',
          },
        },
      ]);

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime,
        endTime,
      });

      // Expansion throws before ClickHouse sees anything, and the message
      // names the variable rather than surfacing as a SQL syntax error.
      expect(result.isError).toBe(true);
      const text = getFirstText(result);
      expect(text).toContain("references unknown variable 'tenant'");
      expect(text).toContain('HINT:');
      expect(text).toContain('isVariableEnabled');
    });

    it('rejects a variableValues entry the dashboard does not declare', async () => {
      const dashboard = await saveDashboard([sqlTile()]);

      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime,
        endTime,
        variableValues: [{ name: 'tenant', values: ['acme'] }],
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Available variables: service');
    });
  });

  describe('categorical (bar) tile series limit', () => {
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);

    // Five distinct services with descending row counts, so a limit keeps a
    // strict, deterministic top-N subset.
    const SERVICE_COUNTS: [string, number][] = [
      ['svc-a', 5],
      ['svc-b', 4],
      ['svc-c', 3],
      ['svc-d', 2],
      ['svc-e', 1],
    ];

    let logSourceId: string;

    beforeEach(async () => {
      const logSource = await Source.create({
        kind: SourceKind.Log,
        team: ctx.team._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        connection: ctx.connection._id,
        name: 'Bar Limit Logs',
        bodyExpression: 'Body',
        severityTextExpression: 'SeverityText',
      });
      logSourceId = logSource._id.toString();

      const logs: Parameters<typeof bulkInsertLogs>[0] = [];
      SERVICE_COUNTS.forEach(([serviceName, count], svcIdx) => {
        for (let i = 0; i < count; i++) {
          logs.push({
            Body: `bar limit log ${serviceName} ${i}`,
            ServiceName: serviceName,
            SeverityText: 'INFO',
            Timestamp: new Date(tenMinAgo.getTime() + (svcIdx * 100 + i) * 10),
          });
        }
      });
      await bulkInsertLogs(logs);
    });

    const saveCategoricalDashboard = async ({
      displayType = 'bar',
      limit,
      orderBy,
    }: {
      displayType?: 'bar' | 'pie';
      limit?: number;
      orderBy?: string;
    } = {}) => {
      const createResult = await callTool(
        ctx.client!,
        'clickstack_save_dashboard',
        {
          name: `Categorical ${displayType} Dashboard ${limit ?? 'none'} ${
            orderBy ?? 'default-order'
          }`,
          tiles: [
            {
              name: 'Groups by service',
              config: {
                displayType,
                sourceId: logSourceId,
                select: [{ aggFn: 'count' }],
                groupBy: 'ServiceName',
                ...(limit != null ? { limit } : {}),
                ...(orderBy != null ? { orderBy } : {}),
              },
            },
          ],
        },
      );
      expect(createResult.isError).toBeFalsy();
      return JSON.parse(getFirstText(createResult));
    };

    const queryTileRows = async (dashboard: any) => {
      const result = await callTool(ctx.client!, 'clickstack_query_tile', {
        dashboardId: dashboard.id,
        tileId: dashboard.tiles[0].id,
        startTime: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
        endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
      });
      expect(result.isError).toBeFalsy();
      const parsed: { result: { data: Array<Record<string, string>> } } =
        JSON.parse(getFirstText(result));
      return parsed.result.data;
    };

    it('returns every group when no limit is set', async () => {
      const dashboard = await saveCategoricalDashboard();
      const rows = await queryTileRows(dashboard);
      expect(rows).toHaveLength(SERVICE_COUNTS.length);
    });

    it('caps the bars to the series limit, keeping the largest groups', async () => {
      const dashboard = await saveCategoricalDashboard({ limit: 3 });
      const rows = await queryTileRows(dashboard);

      // The limit must actually reduce the result below the full set.
      expect(rows).toHaveLength(3);
      expect(rows.length).toBeLessThan(SERVICE_COUNTS.length);

      // And it must keep the top-3 by count, not an arbitrary subset.
      const services = rows.map(r => r.ServiceName).sort();
      expect(services).toEqual(['svc-a', 'svc-b', 'svc-c']);
    });

    it('applies a custom orderBy to a bar tile, driving the SQL result order', async () => {
      const dashboard = await saveCategoricalDashboard({
        orderBy: 'ServiceName ASC',
      });
      const rows = await queryTileRows(dashboard);

      // Every group is returned, ordered ascending by ServiceName rather than
      // by the aggregated count.
      expect(rows.map(r => r.ServiceName)).toEqual([
        'svc-a',
        'svc-b',
        'svc-c',
        'svc-d',
        'svc-e',
      ]);
    });

    it('lets a custom orderBy override the default value-descending ordering when a limit is applied', async () => {
      // ServiceName DESC + LIMIT 3 keeps the alphabetically-last three
      // services (svc-e, svc-d, svc-c). The default value-descending ordering
      // would instead keep the highest-count three (svc-a, svc-b, svc-c), so
      // the differing result proves the custom orderBy overrides the default
      // and controls which groups survive the limit.
      const dashboard = await saveCategoricalDashboard({
        limit: 3,
        orderBy: 'ServiceName DESC',
      });
      const rows = await queryTileRows(dashboard);

      expect(rows).toHaveLength(3);
      expect(rows.map(r => r.ServiceName)).toEqual(['svc-e', 'svc-d', 'svc-c']);
    });

    it('applies a custom orderBy to a pie tile with a limit', async () => {
      const dashboard = await saveCategoricalDashboard({
        displayType: 'pie',
        limit: 3,
        orderBy: 'ServiceName DESC',
      });
      const rows = await queryTileRows(dashboard);

      expect(rows).toHaveLength(3);
      expect(rows.map(r => r.ServiceName)).toEqual(['svc-e', 'svc-d', 'svc-c']);
    });
  });
});
