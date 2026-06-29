import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  bulkInsertMetricsGauge,
  bulkInsertMetricsHistogram,
  bulkInsertMetricsSum,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import { McpContext } from '@/mcp/tools/types';
import Connection from '@/models/connection';
import { Source } from '@/models/source';
import Team from '@/models/team';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('MCP Source Tools', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let traceSource: any;
  let logSource: any;
  let connection: any;
  let client: Client;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    team = result.team;
    user = result.user;

    connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_TRACES_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Traces',
      spanNameExpression: 'SpanName',
      durationExpression: 'Duration',
      durationPrecision: 9,
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
      spanKindExpression: 'SpanKind',
      statusCodeExpression: 'StatusCode',
      serviceNameExpression: 'ServiceName',
    });

    logSource = await Source.create({
      kind: SourceKind.Log,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_LOGS_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      defaultTableSelectExpression:
        'Timestamp, ServiceName as service, SeverityText as level, Body',
      bodyExpression: 'Body',
      serviceNameExpression: 'ServiceName',
      severityTextExpression: 'SeverityText',
      traceIdExpression: 'TraceId',
      connection: connection._id,
      name: 'Logs',
    });

    const context: McpContext = {
      teamId: team._id.toString(),
      userId: user._id.toString(),
    };
    client = await createTestClient(context);
  });

  afterEach(async () => {
    await client?.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ── clickstack_list_sources ──────────────────────────────────────────────────

  describe('clickstack_list_sources', () => {
    it('should list sources and connections as a lightweight catalog', async () => {
      const result = await callTool(client, 'clickstack_list_sources');

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const output = JSON.parse(getFirstText(result));
      expect(output.sources).toHaveLength(2);

      const trace = output.sources.find(
        (s: any) => s.kind === SourceKind.Trace,
      );
      expect(trace).toMatchObject({
        id: traceSource._id.toString(),
        name: 'Traces',
        kind: SourceKind.Trace,
      });

      expect(output.connections).toHaveLength(1);
      expect(output.connections[0]).toMatchObject({
        id: connection._id.toString(),
        name: 'Default',
      });

      // Catalog should NOT include column schema or map keys
      expect(trace.columns).toBeUndefined();
      expect(trace.mapAttributeKeys).toBeUndefined();

      // Should include nextStep guidance pointing to describe_source
      expect(output.nextStep).toBeDefined();
      expect(output.nextStep).toContain('clickstack_describe_source');
    });

    it('should include keyColumns from source config without ClickHouse queries', async () => {
      const result = await callTool(client, 'clickstack_list_sources');
      const output = JSON.parse(getFirstText(result));

      const trace = output.sources.find(
        (s: any) => s.kind === SourceKind.Trace,
      );
      expect(trace.keyColumns).toBeDefined();
      expect(trace.keyColumns).toHaveProperty('spanName');
      expect(trace.keyColumns).toHaveProperty('duration');

      const log = output.sources.find((s: any) => s.kind === SourceKind.Log);
      expect(log.keyColumns).toBeDefined();
      expect(log.keyColumns).toHaveProperty('severityText');
      expect(log.keyColumns).toHaveProperty('body');
    });

    it('should return empty sources for a team with no sources', async () => {
      await client.close();
      await server.clearDBs();
      const result2 = await getLoggedInAgent(server);
      const context2: McpContext = {
        teamId: result2.team._id.toString(),
        userId: result2.user._id.toString(),
      };
      const client2 = await createTestClient(context2);

      const result = await callTool(client2, 'clickstack_list_sources');
      const output = JSON.parse(getFirstText(result));

      expect(output.sources).toHaveLength(0);
      expect(output.connections).toHaveLength(0);

      await client2.close();
    });
  });

  // ── clickstack_describe_source ───────────────────────────────────────────────

  describe('clickstack_describe_source', () => {
    it('should return full column schema for a trace source', async () => {
      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: traceSource._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const output = JSON.parse(getFirstText(result));
      expect(output.source).toMatchObject({
        id: traceSource._id.toString(),
        name: 'Traces',
        kind: SourceKind.Trace,
      });

      // Column schema from ClickHouse DESCRIBE TABLE
      expect(output.source.columns).toBeDefined();
      expect(Array.isArray(output.source.columns)).toBe(true);
      expect(output.source.columns.length).toBeGreaterThan(0);
      expect(output.source.columns[0]).toHaveProperty('name');
      expect(output.source.columns[0]).toHaveProperty('type');
      expect(output.source.columns[0]).toHaveProperty('jsType');
    });

    it('should return full column schema for a log source', async () => {
      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: logSource._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));

      expect(output.source).toMatchObject({
        id: logSource._id.toString(),
        name: 'Logs',
        kind: SourceKind.Log,
      });

      // Log source should have columns
      expect(output.source.columns).toBeDefined();
      expect(output.source.columns.length).toBeGreaterThan(0);

      // Should expose log-specific keyColumns
      expect(output.source.keyColumns).toMatchObject({
        body: 'Body',
        severityText: 'SeverityText',
        serviceName: 'ServiceName',
      });
    });

    it('should include map attribute keys', async () => {
      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: traceSource._id.toString(),
      });
      const output = JSON.parse(getFirstText(result));

      // Trace sources have SpanAttributes and ResourceAttributes map columns.
      // Map keys may be empty when the table has no data, but the field
      // should still be a plain object (or absent).
      if (output.source.mapAttributeKeys) {
        expect(typeof output.source.mapAttributeKeys).toBe('object');
      }
    });

    it('should include keyColumns for trace source', async () => {
      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: traceSource._id.toString(),
      });
      const output = JSON.parse(getFirstText(result));

      expect(output.source.keyColumns).toBeDefined();
      expect(output.source.keyColumns).toHaveProperty('spanName');
      expect(output.source.keyColumns).toHaveProperty('duration');
      expect(output.source.keyColumns).toHaveProperty('traceId');
      expect(output.source.keyColumns).toHaveProperty('spanId');
    });

    it('should return metricTables AND column schema for a metric source', async () => {
      const metricSource = await Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: '',
        },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: 'otel_metrics_gauge',
          [MetricsDataType.Sum.toLowerCase()]: 'otel_metrics_sum',
          [MetricsDataType.Histogram.toLowerCase()]: 'otel_metrics_histogram',
        },
        timestampValueExpression: 'TimeUnix',
        connection: connection._id,
        name: 'Metrics',
      });

      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: metricSource._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));

      expect(output.source).toMatchObject({
        id: metricSource._id.toString(),
        name: 'Metrics',
        kind: SourceKind.Metric,
      });

      // Metric sources surface metricTables AND run column / map-key
      // discovery against the representative metric table (gauge picked
      // first by pickRepresentativeMetricTable).
      expect(output.source.metricTables).toBeDefined();
      expect(output.source.metricTables).toHaveProperty('gauge');
      // metricTables should only contain valid kind keys — not a stray
      // Mongoose `_id` from the embedded subdoc.
      expect(output.source.metricTables).not.toHaveProperty('_id');
      expect(Object.keys(output.source.metricTables).sort()).toEqual(
        ['gauge', 'histogram', 'sum'].sort(),
      );
      expect(output.source.discoveryMetricKind).toBe('gauge');
      expect(output.source.columns).toBeDefined();
      expect(Array.isArray(output.source.columns)).toBe(true);
      // The OTel Collector gauge schema includes MetricName + Value
      // as native columns.
      const columnNames = output.source.columns.map(
        (c: { name: string }) => c.name,
      );
      expect(columnNames).toContain('MetricName');
      expect(columnNames).toContain('Value');

      // nextSteps points at the new metric discovery tools.
      expect(output.nextSteps.query).toContain('metricType');
      expect(output.nextSteps.discovery).toContain('clickstack_list_metrics');
      expect(output.nextSteps.discovery).toContain(
        'clickstack_describe_metric',
      );
    });

    it('should include usage guidance and nextSteps', async () => {
      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: traceSource._id.toString(),
      });
      const output = JSON.parse(getFirstText(result));

      expect(output.usage).toBeDefined();
      expect(output.nextSteps).toBeDefined();
      expect(output.nextSteps.query).toContain(traceSource._id.toString());
    });

    it('should return error for non-existent source', async () => {
      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: '000000000000000000000000',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });

    it('should not allow access to another team source', async () => {
      const otherTeam = await Team.create({ name: 'Other Team' });
      const otherConnection = await Connection.create({
        team: otherTeam._id,
        name: 'Other Connection',
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });
      const otherSource = await Source.create({
        kind: SourceKind.Trace,
        team: otherTeam._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_TRACES_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        connection: otherConnection._id,
        name: 'Other Traces',
      });

      const result = await callTool(client, 'clickstack_describe_source', {
        sourceId: otherSource._id.toString(),
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });
  });

  // ── clickstack_list_metrics ──────────────────────────────────────────────

  describe('clickstack_list_metrics', () => {
    const createMetricSource = () =>
      Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: '' },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: 'otel_metrics_gauge',
          [MetricsDataType.Sum.toLowerCase()]: 'otel_metrics_sum',
          [MetricsDataType.Histogram.toLowerCase()]: 'otel_metrics_histogram',
        },
        timestampValueExpression: 'TimeUnix',
        connection: connection._id,
        name: 'Metrics',
      });

    const seedMetricNames = async () => {
      const now = new Date();
      await bulkInsertMetricsGauge([
        {
          MetricName: 'system.cpu.utilization',
          ResourceAttributes: { 'service.name': 'svc-a' },
          ServiceName: 'svc-a',
          TimeUnix: now,
          Value: 0.42,
        },
        {
          MetricName: 'system.memory.usage',
          ResourceAttributes: { 'service.name': 'svc-a' },
          ServiceName: 'svc-a',
          TimeUnix: now,
          Value: 12345,
        },
      ]);
      await bulkInsertMetricsSum([
        {
          MetricName: 'http.server.request.count',
          AggregationTemporality: 1,
          IsMonotonic: true,
          ResourceAttributes: { 'service.name': 'svc-a' },
          ServiceName: 'svc-a',
          TimeUnix: now,
          Value: 100,
        },
      ]);
      await bulkInsertMetricsHistogram([
        {
          MetricName: 'http.server.request.duration',
          ResourceAttributes: { 'service.name': 'svc-a' },
          TimeUnix: now,
          BucketCounts: [1, 2, 3],
          ExplicitBounds: [10, 100, 1000],
          AggregationTemporality: 1,
        },
      ]);
    };

    it('rejects non-metric sources with a friendly error', async () => {
      const result = await callTool(client, 'clickstack_list_metrics', {
        sourceId: traceSource._id.toString(),
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not a metric source');
    });

    it('returns 404 for unknown source IDs', async () => {
      const result = await callTool(client, 'clickstack_list_metrics', {
        sourceId: '000000000000000000000000',
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not found');
    });

    it('returns metrics across all populated kinds when kind is omitted', async () => {
      const metricSource = await createMetricSource();
      await seedMetricNames();

      const result = await callTool(client, 'clickstack_list_metrics', {
        sourceId: metricSource._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      const namesByKind: Record<string, string[]> = {};
      for (const entry of output.metrics ?? []) {
        if (!namesByKind[entry.kind]) namesByKind[entry.kind] = [];
        namesByKind[entry.kind].push(entry.name);
      }
      expect(namesByKind.gauge ?? []).toEqual(
        expect.arrayContaining([
          'system.cpu.utilization',
          'system.memory.usage',
        ]),
      );
      expect(namesByKind.sum ?? []).toEqual(
        expect.arrayContaining(['http.server.request.count']),
      );
      expect(namesByKind.histogram ?? []).toEqual(
        expect.arrayContaining(['http.server.request.duration']),
      );
    });

    it('restricts results to a single kind when kind is set', async () => {
      const metricSource = await createMetricSource();
      await seedMetricNames();

      const result = await callTool(client, 'clickstack_list_metrics', {
        sourceId: metricSource._id.toString(),
        kind: 'gauge',
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      for (const entry of output.metrics ?? []) {
        expect(entry.kind).toBe('gauge');
      }
    });

    it('applies namePattern as a server-side ILIKE filter', async () => {
      const metricSource = await createMetricSource();
      await seedMetricNames();

      const result = await callTool(client, 'clickstack_list_metrics', {
        sourceId: metricSource._id.toString(),
        namePattern: 'system.cpu.%',
      });
      const output = JSON.parse(getFirstText(result));
      for (const entry of output.metrics ?? []) {
        expect(entry.name).toMatch(/^system\.cpu\./);
      }
    });

    it('paginates via opaque nextCursor and resumes cleanly', async () => {
      const metricSource = await createMetricSource();
      await seedMetricNames();

      // First page: only ask for one entry so the cap is forced even with
      // a small seed; sanity-check the cursor round-trip.
      const first = await callTool(client, 'clickstack_list_metrics', {
        sourceId: metricSource._id.toString(),
        kind: 'gauge',
        limit: 1,
      });
      const firstOutput = JSON.parse(getFirstText(first));
      expect(firstOutput.metrics.length).toBe(1);
      expect(typeof firstOutput.nextCursor).toBe('string');

      const second = await callTool(client, 'clickstack_list_metrics', {
        sourceId: metricSource._id.toString(),
        kind: 'gauge',
        limit: 5,
        cursor: firstOutput.nextCursor,
      });
      expect(second.isError).toBeFalsy();
      const secondOutput = JSON.parse(getFirstText(second));
      // The second page must not repeat the first page's last name.
      const firstNames = new Set(
        (firstOutput.metrics as { name: string }[]).map(m => m.name),
      );
      for (const entry of secondOutput.metrics as { name: string }[]) {
        expect(firstNames.has(entry.name)).toBe(false);
      }
    });

    it('rejects a malformed cursor with an actionable error', async () => {
      const metricSource = await createMetricSource();
      const result = await callTool(client, 'clickstack_list_metrics', {
        sourceId: metricSource._id.toString(),
        cursor: 'not-base64!',
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toMatch(/Invalid cursor/);
    });

    it('returns an empty-result hint when nothing matches', async () => {
      const metricSource = await createMetricSource();
      const result = await callTool(client, 'clickstack_list_metrics', {
        sourceId: metricSource._id.toString(),
        namePattern: 'this.name.does.not.exist.%',
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.metrics).toEqual([]);
      expect(output.hint).toMatch(/widening|removing|omitting/);
    });

    it('surfaces partialFailure instead of the empty hint when a kind fetch fails', async () => {
      // Point the gauge kind at the logs table: it exists (so source
      // resolution succeeds) but has no MetricName/TimeUnix columns, so
      // the per-kind listing query throws.
      const brokenSource = await Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: '' },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'TimeUnix',
        connection: connection._id,
        name: 'BrokenMetrics',
      });
      const result = await callTool(client, 'clickstack_list_metrics', {
        sourceId: brokenSource._id.toString(),
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.metrics).toEqual([]);
      expect(output.partialFailure).toHaveLength(1);
      expect(output.partialFailure[0].kind).toBe('gauge');
      expect(output.partialFailure[0].error).toBeTruthy();
      // The misleading "No metrics matched … widen the window" hint must
      // NOT appear — the agent should retry, not widen.
      expect(output.hint).not.toMatch(/No metrics matched/);
    });
  });

  // ── clickstack_describe_metric ───────────────────────────────────────────

  describe('clickstack_describe_metric', () => {
    const createMetricSource = () =>
      Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: '' },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: 'otel_metrics_gauge',
          [MetricsDataType.Sum.toLowerCase()]: 'otel_metrics_sum',
          [MetricsDataType.Histogram.toLowerCase()]: 'otel_metrics_histogram',
        },
        timestampValueExpression: 'TimeUnix',
        connection: connection._id,
        name: 'Metrics',
      });

    it('rejects non-metric sources', async () => {
      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: traceSource._id.toString(),
        metricName: 'system.cpu.utilization',
        kind: 'gauge',
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('not a metric source');
    });

    it('rejects calls that omit kind', async () => {
      // `kind` is required. Calling without it returns an MCP error
      // surfaced from the schema parser rather than reaching ClickHouse.
      const metricSource = await createMetricSource();
      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: metricSource._id.toString(),
        metricName: 'system.cpu.utilization',
      });
      expect(result.isError).toBe(true);
    });

    it('returns an actionable hint when the metric has no data in the kind table', async () => {
      const metricSource = await createMetricSource();
      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: metricSource._id.toString(),
        metricName: 'definitely.not.a.metric',
        kind: 'gauge',
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      // We always return a single kindDetail for the requested kind —
      // attribute keys are empty when the metric has no data.
      expect(output.kinds).toHaveLength(1);
      expect(output.kinds[0].kind).toBe('gauge');
      expect(output.kinds[0].attributeKeys).toEqual({});
      expect(output.hint).toMatch(/No data found/);
      expect(output.partialFailure).toBeUndefined();
    });

    it('surfaces partialFailure instead of the no-data hint when discovery fails', async () => {
      // Point the gauge kind at the logs table: it exists (so getColumns
      // succeeds) but lacks MetricName/TimeUnix columns, so the
      // attribute-keys discovery query throws.
      const brokenSource = await Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: '' },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'TimeUnix',
        connection: connection._id,
        name: 'BrokenMetrics',
      });
      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: brokenSource._id.toString(),
        metricName: 'whatever',
        kind: 'gauge',
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.partialFailure).toBeDefined();
      expect(
        output.partialFailure.map((f: { stage: string }) => f.stage),
      ).toContain('attributeKeys');
      // The misleading "No data found … widen startTime/endTime" hint
      // must NOT appear — the fetch failed; widening would not help.
      expect(output.hint).not.toMatch(/No data found/);
    });

    it('returns attribute keys for a gauge metric when kind is specified', async () => {
      const metricSource = await createMetricSource();
      const now = new Date();
      await bulkInsertMetricsGauge([
        {
          MetricName: 'system.cpu.utilization',
          ResourceAttributes: { 'service.name': 'auto-detect-svc' },
          ServiceName: 'auto-detect-svc',
          TimeUnix: now,
          Value: 0.5,
        },
      ]);

      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: metricSource._id.toString(),
        metricName: 'system.cpu.utilization',
        kind: 'gauge',
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.metricName).toBe('system.cpu.utilization');
      expect(output.kinds.length).toBe(1);
      const detail = output.kinds[0];
      expect(detail.kind).toBe('gauge');
      expect(detail.usage).toContain('aggFn');
      expect(detail.attributeKeys).toBeDefined();
      // ResourceAttributes['service.name'] should land in the keys map
      // under ResourceAttributes.
      expect(detail.attributeKeys.ResourceAttributes ?? []).toEqual(
        expect.arrayContaining(['service.name']),
      );
      // Attribute values should be sampled by default.
      expect(detail.attributeValues).toBeDefined();
      // nextSteps.query carries a worked example matching the requested kind.
      expect(output.nextSteps.query).toContain('metricType: "gauge"');
    });

    it('reports sampledKeys and truncatedKeys so unsampled keys are distinguishable', async () => {
      // 15 attribute keys > MAX_ATTR_KEYS_TO_SAMPLE (12): the overflow
      // must land in truncatedKeys so the agent knows those keys were
      // never queried (vs. sampled-but-empty).
      const metricSource = await createMetricSource();
      const manyAttrs: Record<string, string> = {};
      for (let i = 0; i < 15; i++) {
        manyAttrs[`attr.key.${String(i).padStart(2, '0')}`] = `value-${i}`;
      }
      await bulkInsertMetricsGauge([
        {
          MetricName: 'many.attrs.metric',
          ResourceAttributes: manyAttrs,
          ServiceName: 'many-attrs-svc',
          TimeUnix: new Date(),
          Value: 1,
        },
      ]);

      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: metricSource._id.toString(),
        metricName: 'many.attrs.metric',
        kind: 'gauge',
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      const detail = output.kinds[0];
      const meta = detail.attributeValuesMeta;
      expect(meta).toBeDefined();
      expect(meta.sampledKeys).toHaveLength(12);
      expect(meta.truncatedKeys).toHaveLength(3);
      // Sampled and truncated sets are disjoint and cover all 15 keys.
      expect(new Set([...meta.sampledKeys, ...meta.truncatedKeys]).size).toBe(
        15,
      );
      // Every key with values must have been sampled.
      for (const key of Object.keys(detail.attributeValues ?? {})) {
        expect(meta.sampledKeys).toContain(key);
      }
    });

    it('reports empty truncatedKeys when all attribute keys fit the cap', async () => {
      const metricSource = await createMetricSource();
      await bulkInsertMetricsGauge([
        {
          MetricName: 'few.attrs.metric',
          ResourceAttributes: { 'service.name': 'few-attrs-svc' },
          ServiceName: 'few-attrs-svc',
          TimeUnix: new Date(),
          Value: 1,
        },
      ]);

      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: metricSource._id.toString(),
        metricName: 'few.attrs.metric',
        kind: 'gauge',
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      const meta = output.kinds[0].attributeValuesMeta;
      expect(meta).toBeDefined();
      expect(meta.truncatedKeys).toEqual([]);
      expect(meta.sampledKeys).toContain("ResourceAttributes['service.name']");
    });

    it('skips value sampling when sampleValues is false', async () => {
      const metricSource = await createMetricSource();
      const now = new Date();
      await bulkInsertMetricsGauge([
        {
          MetricName: 'system.cpu.utilization',
          ResourceAttributes: { 'service.name': 'no-sample-svc' },
          ServiceName: 'no-sample-svc',
          TimeUnix: now,
          Value: 0.5,
        },
      ]);

      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: metricSource._id.toString(),
        metricName: 'system.cpu.utilization',
        kind: 'gauge',
        sampleValues: false,
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.kinds[0].attributeValues).toBeUndefined();
    });

    it('returns the correct usage example for a sum metric', async () => {
      const metricSource = await createMetricSource();
      const now = new Date();
      await bulkInsertMetricsSum([
        {
          MetricName: 'http.server.request.count',
          AggregationTemporality: 1,
          IsMonotonic: true,
          ResourceAttributes: { 'service.name': 'sum-svc' },
          ServiceName: 'sum-svc',
          TimeUnix: now,
          Value: 42,
        },
      ]);

      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: metricSource._id.toString(),
        metricName: 'http.server.request.count',
        kind: 'sum',
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.kinds[0].kind).toBe('sum');
      expect(output.kinds[0].usage).toContain('increase');
      expect(output.nextSteps.query).toContain('"increase"');
    });

    it('returns the quantile + level example for a histogram metric', async () => {
      const metricSource = await createMetricSource();
      const now = new Date();
      await bulkInsertMetricsHistogram([
        {
          MetricName: 'http.server.request.duration',
          ResourceAttributes: { 'service.name': 'hist-svc' },
          TimeUnix: now,
          BucketCounts: [1, 2, 3],
          ExplicitBounds: [10, 100, 1000],
          AggregationTemporality: 1,
        },
      ]);

      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: metricSource._id.toString(),
        metricName: 'http.server.request.duration',
        kind: 'histogram',
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.kinds[0].kind).toBe('histogram');
      expect(output.kinds[0].usage).toContain('quantile');
      expect(output.nextSteps.query).toContain('"quantile"');
      expect(output.nextSteps.query).toContain('level: 0.95');
    });

    it('rejects explicit kind when the source has no table for that kind', async () => {
      // Source with only gauge populated.
      const gaugeOnly = await Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: '' },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: 'otel_metrics_gauge',
        },
        timestampValueExpression: 'TimeUnix',
        connection: connection._id,
        name: 'GaugeOnly',
      });
      const result = await callTool(client, 'clickstack_describe_metric', {
        sourceId: gaugeOnly._id.toString(),
        metricName: 'whatever',
        kind: 'sum',
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toMatch(/no "sum" metric table/);
    });
  });
});
