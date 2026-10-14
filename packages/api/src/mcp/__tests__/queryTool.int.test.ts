import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ObjectId } from 'mongodb';

import * as config from '@/config';
import {
  bucketExponentialHistogramObservations,
  bulkInsertLogs,
  bulkInsertMetricsGauge,
  bulkInsertMetricsHistogram,
  bulkInsertMetricsSum,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  DEFAULT_METRICS_TABLE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
  seedExponentialHistogramMetric,
} from '@/fixtures';
import { McpContext } from '@/mcp/tools/types';
import Connection from '@/models/connection';
import { Source, type SourceDocument } from '@/models/source';
import Team from '@/models/team';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

describe('MCP Query Tools', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let traceSource: SourceDocument;
  let logSource: SourceDocument;
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
    });

    logSource = await Source.create({
      kind: SourceKind.Log,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_LOGS_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Logs',
      bodyExpression: 'Body',
      severityTextExpression: 'SeverityText',
    });

    const context: McpContext = {
      teamId: team._id.toString(),
      userId: user._id.toString(),
    };
    client = await createTestClient(context);
  });

  afterEach(async () => {
    await client.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ─── Schema serialization ────────────────────────────────────────────────────

  describe('schema serialization', () => {
    it('should expose clickstack_timeseries with expected properties', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'clickstack_timeseries');
      expect(tool).toBeDefined();

      const props = Object.keys(tool!.inputSchema.properties ?? {});
      expect(props).toContain('sourceId');
      expect(props).toContain('select');
      expect(props).toContain('shape');
      expect(props).toContain('granularity');
      expect(props).toContain('groupBy');
      expect(tool!.inputSchema.required).toContain('sourceId');
      expect(tool!.inputSchema.required).toContain('select');
    });

    it('should expose clickstack_table with expected properties', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'clickstack_table');
      expect(tool).toBeDefined();

      const props = Object.keys(tool!.inputSchema.properties ?? {});
      expect(props).toContain('sourceId');
      expect(props).toContain('select');
      expect(props).toContain('shape');
      expect(props).toContain('groupBy');
      expect(tool!.inputSchema.required).toContain('sourceId');
      expect(tool!.inputSchema.required).toContain('select');
    });

    it('should expose clickstack_search with expected properties', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'clickstack_search');
      expect(tool).toBeDefined();

      const props = Object.keys(tool!.inputSchema.properties ?? {});
      expect(props).toContain('sourceId');
      expect(props).toContain('where');
      expect(props).toContain('columns');
      expect(props).toContain('maxResults');
      expect(tool!.inputSchema.required).toContain('sourceId');
    });

    it('should expose clickstack_event_patterns with expected properties', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'clickstack_event_patterns');
      expect(tool).toBeDefined();

      const props = Object.keys(tool!.inputSchema.properties ?? {});
      expect(props).toContain('sourceId');
      expect(props).toContain('where');
      expect(props).toContain('sampleSize');
      expect(props).toContain('topN');
      expect(props).toContain('bodyExpression');
      expect(tool!.inputSchema.required).toContain('sourceId');
    });

    it('should expose clickstack_sql with expected properties', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'clickstack_sql');
      expect(tool).toBeDefined();

      const props = Object.keys(tool!.inputSchema.properties ?? {});
      expect(props).toContain('connectionId');
      expect(props).toContain('sql');
      expect(props).toContain('startTime');
      expect(props).toContain('endTime');
      expect(tool!.inputSchema.required).toContain('connectionId');
      expect(tool!.inputSchema.required).toContain('sql');
    });

    it('exposes an optional sourceId on clickstack_sql', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'clickstack_sql')!;

      expect(Object.keys(tool.inputSchema.properties ?? {})).toContain(
        'sourceId',
      );
      expect(tool.inputSchema.required).not.toContain('sourceId');
    });
  });

  // ─── clickstack_timeseries ─────────────────────────────────────────────────────

  describe('clickstack_timeseries', () => {
    it('should execute a line chart query', async () => {
      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const output = JSON.parse(getFirstText(result));
      expect(output).toHaveProperty('result');
    });

    it('should execute a stacked bar chart query', async () => {
      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        shape: 'stacked_bar',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should default to line shape when shape is omitted', async () => {
      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should accept granularity in correct format', async () => {
      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        granularity: '1 minute',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should return error for invalid time range', async () => {
      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        startTime: 'invalid-date',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Invalid');
    });
  });

  // ─── clickstack_table ──────────────────────────────────────────────────────────

  describe('clickstack_table', () => {
    it('should execute a table query', async () => {
      const result = await callTool(client, 'clickstack_table', {
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        groupBy: 'SpanName',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const output = JSON.parse(getFirstText(result));
      expect(output).toHaveProperty('result');
    });

    it('should execute a number query', async () => {
      const result = await callTool(client, 'clickstack_table', {
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        shape: 'number',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should execute a pie query', async () => {
      const result = await callTool(client, 'clickstack_table', {
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        shape: 'pie',
        groupBy: 'SpanName',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should execute a bar query', async () => {
      const result = await callTool(client, 'clickstack_table', {
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
        shape: 'bar',
        groupBy: 'SpanName',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should auto-upgrade shape:"number" to "table" when select has multiple items', async () => {
      // This should NOT error — it should silently upgrade to table
      const result = await callTool(client, 'clickstack_table', {
        sourceId: traceSource._id.toString(),
        select: [
          { aggFn: 'count' },
          { aggFn: 'avg', valueExpression: 'Duration' },
        ],
        shape: 'number',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should auto-upgrade shape:"pie" to "table" when select has multiple items', async () => {
      const result = await callTool(client, 'clickstack_table', {
        sourceId: traceSource._id.toString(),
        select: [
          { aggFn: 'count' },
          { aggFn: 'sum', valueExpression: 'Duration' },
        ],
        shape: 'pie',
        groupBy: 'SpanName',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should auto-upgrade shape:"bar" to "table" when select has multiple items', async () => {
      const result = await callTool(client, 'clickstack_table', {
        sourceId: traceSource._id.toString(),
        select: [
          { aggFn: 'count' },
          { aggFn: 'sum', valueExpression: 'Duration' },
        ],
        shape: 'bar',
        groupBy: 'SpanName',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should use default time range when not provided', async () => {
      const result = await callTool(client, 'clickstack_table', {
        sourceId: traceSource._id.toString(),
        select: [{ aggFn: 'count' }],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });
  });

  // ─── clickstack_search ─────────────────────────────────────────────────────────

  describe('clickstack_search', () => {
    it('should execute a search query', async () => {
      const result = await callTool(client, 'clickstack_search', {
        sourceId: traceSource._id.toString(),
        where: '',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should respect maxResults parameter', async () => {
      const result = await callTool(client, 'clickstack_search', {
        sourceId: traceSource._id.toString(),
        maxResults: 10,
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
    });

    it('should use default time range when not provided', async () => {
      const result = await callTool(client, 'clickstack_search', {
        sourceId: traceSource._id.toString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should reject calls missing sourceId', async () => {
      const result = await callTool(client, 'clickstack_search', {
        where: 'level:error',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toMatch(/sourceId/i);
    });

    it('should expose denoise property in schema', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'clickstack_search');
      expect(tool).toBeDefined();
      const props = Object.keys(tool!.inputSchema.properties ?? {});
      expect(props).toContain('denoise');
    });

    it('should emit denoised block when denoise=true on empty results', async () => {
      const result = await callTool(client, 'clickstack_search', {
        sourceId: logSource._id.toString(),
        denoise: true,
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      // With no data, the denoised block should not appear because the
      // search result itself has no rows to process (early return path).
      const output = JSON.parse(getFirstText(result));
      expect(output).toHaveProperty('result');
    });

    describe('denoise with seeded data', () => {
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

      beforeEach(async () => {
        const logs: Parameters<typeof bulkInsertLogs>[0] = [];

        // Noisy pattern: "Health check OK from <ip>" — 80 rows (>10% threshold)
        for (let i = 0; i < 80; i++) {
          logs.push({
            Body: `Health check OK from 10.0.${Math.floor(i / 256)}.${i % 256}`,
            ServiceName: 'loadbalancer',
            SeverityText: 'INFO',
            Timestamp: new Date(fiveMinAgo.getTime() + i * 100),
          });
        }

        // Unique/rare events — 5 rows (well below 10% threshold)
        for (let i = 0; i < 5; i++) {
          logs.push({
            Body: `Rare event type ${String.fromCharCode(65 + i)} occurred in subsystem`,
            ServiceName: 'worker',
            SeverityText: 'WARN',
            Timestamp: new Date(fiveMinAgo.getTime() + (80 + i) * 1000),
          });
        }

        await bulkInsertLogs(logs);
      });

      it('should filter noisy patterns and emit denoised metadata', async () => {
        const result = await callTool(client, 'clickstack_search', {
          sourceId: logSource._id.toString(),
          denoise: true,
          maxResults: 200,
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));

        // Must have a denoised block
        expect(output).toHaveProperty('denoised');
        expect(output.denoised).toHaveProperty('removedPatterns');
        expect(output.denoised).toHaveProperty('returnedRowCountBeforeDenoise');
        expect(output.denoised).toHaveProperty('filteredRowCount');

        // Should not have a skipped reason
        expect(output.denoised.skipped).toBeUndefined();

        // The noisy health check pattern should be in removedPatterns
        expect(output.denoised.removedPatterns.length).toBeGreaterThanOrEqual(
          1,
        );
        const healthPattern = output.denoised.removedPatterns.find(
          (p: { pattern: string }) => p.pattern.includes('Health check'),
        );
        expect(healthPattern).toBeDefined();

        // Filtered count should be less than original
        expect(output.denoised.filteredRowCount).toBeLessThan(
          output.denoised.returnedRowCountBeforeDenoise,
        );
      });

      it('should return results without denoised block when denoise=false', async () => {
        const result = await callTool(client, 'clickstack_search', {
          sourceId: logSource._id.toString(),
          denoise: false,
          maxResults: 200,
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output).not.toHaveProperty('denoised');
      });
    });
  });

  // ─── clickstack_event_patterns ─────────────────────────────────────────────────

  describe('clickstack_event_patterns', () => {
    it('should execute an event_patterns query on a log source', async () => {
      const result = await callTool(client, 'clickstack_event_patterns', {
        sourceId: logSource._id.toString(),
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const output = JSON.parse(getFirstText(result));
      expect(output).toHaveProperty('summary');
      expect(output).toHaveProperty('patterns');
      expect(output.summary).toHaveProperty('totalCount');
      expect(output.summary).toHaveProperty('sampledCount');
      expect(output.summary).toHaveProperty('sampleMultiplier');
      expect(output.summary).toHaveProperty('bodyColumn', 'Body');
      expect(output.summary).toHaveProperty('timeRange');
      expect(Array.isArray(output.patterns)).toBe(true);
    });

    it('should execute with explicit bodyExpression on trace source', async () => {
      const result = await callTool(client, 'clickstack_event_patterns', {
        sourceId: traceSource._id.toString(),
        bodyExpression: 'SpanName',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const output = JSON.parse(getFirstText(result));
      expect(output).toHaveProperty('summary');
      expect(Array.isArray(output.patterns)).toBe(true);
      expect(output.summary).toHaveProperty('bodyColumn', 'SpanName');
    });

    it('should accept custom bodyExpression on log source', async () => {
      const result = await callTool(client, 'clickstack_event_patterns', {
        sourceId: logSource._id.toString(),
        bodyExpression: 'SeverityText',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const output = JSON.parse(getFirstText(result));
      expect(output.summary).toHaveProperty('bodyColumn', 'SeverityText');
    });

    it('should respect sampleSize parameter', async () => {
      const result = await callTool(client, 'clickstack_event_patterns', {
        sourceId: logSource._id.toString(),
        sampleSize: 100,
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should respect where filter', async () => {
      const result = await callTool(client, 'clickstack_event_patterns', {
        sourceId: logSource._id.toString(),
        where: "SeverityText = 'ERROR'",
        whereLanguage: 'sql',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should reject calls missing sourceId', async () => {
      const result = await callTool(client, 'clickstack_event_patterns', {
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toMatch(/sourceId/i);
    });

    it('should return error for non-existent source', async () => {
      const result = await callTool(client, 'clickstack_event_patterns', {
        sourceId: '000000000000000000000000',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Source not found');
    });

    describe('with seeded data', () => {
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

      beforeEach(async () => {
        const logs: Parameters<typeof bulkInsertLogs>[0] = [];

        // Template A: "User <name> logged in from <ip>" — 20 rows
        for (let i = 0; i < 20; i++) {
          logs.push({
            Body: `User user_${i} logged in from 10.0.0.${i % 256}`,
            ServiceName: 'auth-service',
            SeverityText: 'INFO',
            Timestamp: new Date(fiveMinAgo.getTime() + i * 1000),
          });
        }

        // Template B: "Payment processed for order <id>" — 10 rows
        for (let i = 0; i < 10; i++) {
          logs.push({
            Body: `Payment processed for order ${1000 + i}`,
            ServiceName: 'payment-service',
            SeverityText: 'INFO',
            Timestamp: new Date(fiveMinAgo.getTime() + (20 + i) * 1000),
          });
        }

        // Template C: unique single message
        logs.push({
          Body: 'System startup complete, all services healthy',
          ServiceName: 'system',
          SeverityText: 'INFO',
          Timestamp: new Date(fiveMinAgo.getTime() + 31000),
        });

        await bulkInsertLogs(logs);
      });

      it('should mine patterns from seeded data and return non-empty results', async () => {
        const result = await callTool(client, 'clickstack_event_patterns', {
          sourceId: logSource._id.toString(),
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        const { patterns } = output;
        const { totalCount, sampledCount } = output.summary;

        expect(totalCount).toBeGreaterThanOrEqual(31);
        expect(sampledCount).toBeGreaterThanOrEqual(31);
        expect(patterns.length).toBeGreaterThanOrEqual(1);

        // The most common pattern should contain <*> placeholders
        const topPattern = patterns[0];
        expect(topPattern.pattern).toContain('<*>');

        // Patterns should be sorted by estimatedCount descending
        for (let i = 1; i < patterns.length; i++) {
          expect(patterns[i - 1].estimatedCount).toBeGreaterThanOrEqual(
            patterns[i].estimatedCount,
          );
        }

        // Each pattern should have trend data with at least some non-zero buckets
        for (const p of patterns) {
          expect(p.trend.length).toBeGreaterThan(0);
        }

        const hasNonZeroTrend = patterns.some((p: any) =>
          p.trend.some((t: any) => t.count > 0),
        );
        expect(hasNonZeroTrend).toBe(true);
      });
    });
  });

  // ─── clickstack_sql ────────────────────────────────────────────────────────────

  describe('clickstack_sql', () => {
    it('should execute a raw SQL query', async () => {
      const result = await callTool(client, 'clickstack_sql', {
        connectionId: connection._id.toString(),
        sql: 'SELECT 1 AS value',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should execute SQL with time macros', async () => {
      const result = await callTool(client, 'clickstack_sql', {
        connectionId: connection._id.toString(),
        sql: `SELECT count() AS cnt FROM ${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE} WHERE $__timeFilter(Timestamp) LIMIT 10`,
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should use default time range when not provided', async () => {
      const result = await callTool(client, 'clickstack_sql', {
        connectionId: connection._id.toString(),
        sql: 'SELECT 1 AS value',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
    });

    it('should return error for invalid time range', async () => {
      const result = await callTool(client, 'clickstack_sql', {
        connectionId: connection._id.toString(),
        sql: 'SELECT 1',
        startTime: 'not-a-date',
      });

      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Invalid');
    });

    it.each([
      '$__filter(ServiceName, $service)',
      '$__conditionalAll(1=1, $svc)',
    ])(
      'rejects %s, which needs a dashboard to resolve against',
      async macro => {
        // Rejected up front rather than sent on: an unrecognized macro passes
        // through as literal text, so ClickHouse would answer with an opaque
        // syntax error pointing at a '$'.
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: `SELECT 1 AS value WHERE ${macro}`,
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain(
          'only resolve for a tile on a dashboard',
        );
      },
    );

    it('still allows $__filters, which needs no variable context', async () => {
      const result = await callTool(client, 'clickstack_sql', {
        connectionId: connection._id.toString(),
        sql: 'SELECT 1 AS value WHERE $__filters',
      });

      expect(result.isError).toBeFalsy();
    });

    // The tool description advertises these bucket-size parameters and
    // macros, so each one has to resolve to a value rather than fail with
    // "Substitution intervalSeconds is not set".
    it('binds the interval parameters and $__interval_s to the same bucket size', async () => {
      const result = await callTool(client, 'clickstack_sql', {
        connectionId: connection._id.toString(),
        sql:
          'SELECT {intervalSeconds:Int64} AS s, ' +
          '{intervalMilliseconds:Int64} AS ms, ' +
          '$__interval_s AS macro_s',
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });

      expect(result.isError).toBeFalsy();
      const [row] = JSON.parse(getFirstText(result)).result.data;
      const seconds = Number(row.s);
      expect(seconds).toBeGreaterThan(0);
      expect(Number(row.ms)).toBe(seconds * 1000);
      expect(Number(row.macro_s)).toBe(seconds);
    });

    it.each(['$__timeInterval', '$__timeInterval_ms'])(
      'runs a time-series query bucketed with %s',
      async macro => {
        const now = Date.now();
        await bulkInsertLogs(
          [5, 10, 15, 20].map(minutesAgo => ({
            Body: 'bucketed',
            ServiceName: 'sql-buckets',
            SeverityText: 'INFO',
            Timestamp: new Date(now - minutesAgo * 60 * 1000),
          })),
        );

        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql:
            `SELECT ${macro}(Timestamp) AS ts, ` +
            'toUnixTimestamp(ts) % $__interval_s AS offset, count() AS cnt ' +
            `FROM ${DEFAULT_DATABASE}.${DEFAULT_LOGS_TABLE} ` +
            "WHERE $__timeFilter(Timestamp) AND ServiceName = 'sql-buckets' " +
            'GROUP BY ts ORDER BY ts LIMIT 10',
          startTime: new Date(now - 60 * 60 * 1000).toISOString(),
          endTime: new Date(now).toISOString(),
        });

        expect(getFirstText(result)).not.toContain('Substitution');
        expect(result.isError).toBeFalsy();
        const rows: { offset: unknown; cnt: unknown }[] = JSON.parse(
          getFirstText(result),
        ).result.data;
        expect(rows).toHaveLength(4);
        expect(rows.map(row => Number(row.offset))).toEqual([0, 0, 0, 0]);
        expect(rows.map(row => Number(row.cnt))).toEqual([1, 1, 1, 1]);
      },
    );

    describe('sql parameter examples', () => {
      const getDescription = async () => {
        const { tools } = await client.listTools();
        const sqlParam = tools.find(t => t.name === 'clickstack_sql')!
          .inputSchema.properties?.sql;
        return sqlParam &&
          typeof sqlParam === 'object' &&
          'description' in sqlParam
          ? String(sqlParam.description)
          : '';
      };
      const getExamples = async () =>
        [
          ...(await getDescription()).matchAll(/^Example \(.+\):\n {2}(.+)$/gm),
        ].map(match => match[1]);

      // timestampColumn can list several columns ("TimestampTime, Timestamp"),
      // which breaks $__timeFilter if pasted whole. Metric sources return a
      // database instead of a table.
      it('say how to fill placeholders for multi-column timestamps and metric sources', async () => {
        const description = await getDescription();

        expect(description).toMatch(
          /first expression in its `timestampColumn`/,
        );
        expect(description).toMatch(/metricTables.*`database`/);
      });

      // Agents copy examples literally. A concrete table or column in one
      // becomes the guess, and it only exists on some schemas.
      it('leave the table and timestamp column as placeholders', async () => {
        const examples = await getExamples();

        expect(examples).toHaveLength(2);
        for (const sql of examples) {
          expect(sql).toMatch(/FROM (<table>|\$__sourceTable) /);
          expect(sql).toContain('<timestampColumn>');
          expect(sql).not.toMatch(/otel_|TimestampTime/);
        }
      });

      it('show $__sourceTable for a source and <table> for any other table', async () => {
        const [timeSeries, table] = await getExamples();

        expect(timeSeries).toContain('FROM $__sourceTable ');
        expect(table).toContain('FROM <table> ');
      });

      it('run once the placeholders are filled from a source', async () => {
        const examples = await getExamples();

        expect(examples).toHaveLength(2);
        for (const example of examples) {
          const sql = example
            .replaceAll('<table>', `${DEFAULT_DATABASE}.${DEFAULT_LOGS_TABLE}`)
            .replaceAll('<timestampColumn>', 'Timestamp');
          const result = await callTool(client, 'clickstack_sql', {
            connectionId: connection._id.toString(),
            sourceId: logSource._id.toString(),
            sql,
            startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            endTime: new Date().toISOString(),
          });
          expect({
            sql,
            error: result.isError ? getFirstText(result) : null,
          }).toEqual({ sql, error: null });
        }
      });
    });

    describe('sourceId', () => {
      const countSql =
        'SELECT count() AS n FROM $__sourceTable WHERE $__timeFilter(Timestamp)';

      it('resolves $__sourceTable to the table of the given source', async () => {
        const now = Date.now();
        await bulkInsertLogs(
          [1, 2, 3].map(minutesAgo => ({
            Body: 'from source',
            ServiceName: 'sql-source',
            SeverityText: 'INFO',
            Timestamp: new Date(now - minutesAgo * 60 * 1000),
          })),
        );

        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sourceId: logSource._id.toString(),
          sql: `${countSql} AND ServiceName = 'sql-source'`,
          startTime: new Date(now - 60 * 60 * 1000).toISOString(),
          endTime: new Date(now).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        expect(JSON.parse(getFirstText(result)).result.data).toEqual([
          { n: '3' },
        ]);
      });

      it('rejects $__sourceTable without a sourceId, saying to pass one', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: countSql,
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain(
          '$__sourceTable needs a sourceId',
        );
      });

      it('rejects a sourceId that does not exist', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sourceId: new ObjectId().toString(),
          sql: countSql,
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Source not found');
      });

      it("rejects another team's sourceId as not found", async () => {
        const otherTeam = await Team.create({ name: 'Other Team' });
        const otherSource = await Source.create({
          kind: SourceKind.Log,
          team: otherTeam._id,
          from: {
            databaseName: DEFAULT_DATABASE,
            tableName: DEFAULT_LOGS_TABLE,
          },
          timestampValueExpression: 'Timestamp',
          connection: connection._id,
          name: 'Other Logs',
        });

        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sourceId: otherSource._id.toString(),
          sql: countSql,
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Source not found');
      });

      // $__sourceTable would otherwise expand to a table on another server.
      it('rejects a sourceId whose connection differs from connectionId', async () => {
        const otherConnection = await Connection.create({
          team: team._id,
          name: 'Other',
          host: config.CLICKHOUSE_HOST,
          username: config.CLICKHOUSE_USER,
          password: config.CLICKHOUSE_PASSWORD,
        });

        const result = await callTool(client, 'clickstack_sql', {
          connectionId: otherConnection._id.toString(),
          sourceId: logSource._id.toString(),
          sql: countSql,
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('does not match the connection');
      });
    });

    it('returns plain query rows unchanged', async () => {
      const result = await callTool(client, 'clickstack_sql', {
        connectionId: connection._id.toString(),
        sql: "SELECT 1 AS value, 'a' AS label",
      });

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(getFirstText(result)).result.data).toEqual([
        { value: 1, label: 'a' },
      ]);
    });
  });

  // ─── ClickHouse query errors ──────────────────────────────────────────────────

  describe('ClickHouse query error handling', () => {
    describe('clickstack_sql errors', () => {
      it('should return isError for a syntax error', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: 'SELECTT 1',
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toMatch(
          /SYNTAX_ERROR|Syntax error|unknown/i,
        );
      });

      it('should return isError for a nonexistent column', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: `SELECT nonexistent_column_xyz FROM ${DEFAULT_DATABASE}.${DEFAULT_LOGS_TABLE} LIMIT 1`,
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toMatch(
          /UNKNOWN_IDENTIFIER|Missing columns|unknown/i,
        );
      });

      it('should return isError for a nonexistent table', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: `SELECT 1 FROM ${DEFAULT_DATABASE}.nonexistent_table_xyz LIMIT 1`,
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toMatch(
          /UNKNOWN_TABLE|doesn.t exist|unknown/i,
        );
      });

      it.each([
        'nonexistent_table_xyz',
        `${DEFAULT_DATABASE}.nonexistent_table_xyz`,
      ])(
        'hints that %s should come from clickstack_list_sources',
        async table => {
          const result = await callTool(client, 'clickstack_sql', {
            connectionId: connection._id.toString(),
            sql: `SELECT 1 FROM ${table} LIMIT 1`,
          });

          expect(result.isError).toBe(true);
          expect(getFirstText(result)).toContain(
            'HINT: Use the `table` of a source from clickstack_list_sources',
          );
        },
      );
    });

    describe('clickstack_table errors', () => {
      it('should return isError for a nonexistent valueExpression column', async () => {
        const result = await callTool(client, 'clickstack_table', {
          sourceId: traceSource._id.toString(),
          select: [{ aggFn: 'avg', valueExpression: 'nonexistent_column_xyz' }],
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toMatch(
          /UNKNOWN_IDENTIFIER|Missing columns|unknown/i,
        );
      });

      it('does not send a source whose table is missing back to clickstack_list_sources', async () => {
        const missing = await Source.create({
          kind: SourceKind.Log,
          team: team._id,
          from: {
            databaseName: DEFAULT_DATABASE,
            tableName: 'nonexistent_table_xyz',
          },
          timestampValueExpression: 'Timestamp',
          connection: connection._id,
          name: 'Missing logs',
        });

        const result = await callTool(client, 'clickstack_table', {
          sourceId: missing._id.toString(),
          select: [{ aggFn: 'count' }],
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toMatch(
          /UNKNOWN_TABLE|does(n.t| not) exist/i,
        );
        expect(getFirstText(result)).not.toContain('clickstack_list_sources');
      });
    });

    describe('clickstack_timeseries errors', () => {
      it('should return isError for a nonexistent valueExpression column', async () => {
        const result = await callTool(client, 'clickstack_timeseries', {
          sourceId: traceSource._id.toString(),
          select: [{ aggFn: 'sum', valueExpression: 'nonexistent_column_xyz' }],
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toMatch(
          /UNKNOWN_IDENTIFIER|Missing columns|unknown/i,
        );
      });
    });

    it('should not leak _errorCategory on the wire result', async () => {
      const result = await callTool(client, 'clickstack_sql', {
        connectionId: connection._id.toString(),
        sql: 'SELECTT 1',
      });

      expect(result.isError).toBe(true);
      expect(result).not.toHaveProperty('_errorCategory');
    });

    describe('infrastructure errors (unreachable ClickHouse)', () => {
      let deadConnection: any;
      let deadSource: SourceDocument;

      beforeEach(async () => {
        deadConnection = await Connection.create({
          team: team._id,
          name: 'Dead',
          host: 'http://localhost:1',
          username: 'default',
          password: '',
        });

        deadSource = await Source.create({
          kind: SourceKind.Trace,
          team: team._id,
          from: {
            databaseName: DEFAULT_DATABASE,
            tableName: DEFAULT_TRACES_TABLE,
          },
          timestampValueExpression: 'Timestamp',
          connection: deadConnection._id,
          name: 'Dead Traces',
        });
      });

      it('should return isError for clickstack_sql against unreachable host', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: deadConnection._id.toString(),
          sql: 'SELECT 1',
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result).length).toBeGreaterThan(0);
      });

      it('should return isError for clickstack_table against unreachable host', async () => {
        const result = await callTool(client, 'clickstack_table', {
          sourceId: deadSource._id.toString(),
          select: [{ aggFn: 'count' }],
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result).length).toBeGreaterThan(0);
      });

      it('should return isError for clickstack_timeseries against unreachable host', async () => {
        const result = await callTool(client, 'clickstack_timeseries', {
          sourceId: deadSource._id.toString(),
          select: [{ aggFn: 'count' }],
        });

        expect(result.isError).toBe(true);
        expect(getFirstText(result).length).toBeGreaterThan(0);
      });
    });
  });

  // ─── Safety settings (readonly + max_execution_time) ─────────────────────────

  describe('ClickHouse safety settings', () => {
    describe('readonly enforcement via clickstack_sql', () => {
      it('should reject CREATE TABLE (DDL)', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: 'CREATE TABLE __mcp_test_ddl (id UInt64) ENGINE = Memory',
        });

        expect(result.isError).toBe(true);
        const text = getFirstText(result);
        expect(text).toMatch(/readonly/i);
      });

      it('should reject INSERT (DML)', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: `INSERT INTO ${DEFAULT_DATABASE}.${DEFAULT_LOGS_TABLE} (Body) VALUES ('injected')`,
        });

        expect(result.isError).toBe(true);
        const text = getFirstText(result);
        expect(text).toMatch(/readonly/i);
      });

      it('should reject DROP TABLE (DDL)', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: `DROP TABLE IF EXISTS ${DEFAULT_DATABASE}.${DEFAULT_LOGS_TABLE}`,
        });

        expect(result.isError).toBe(true);
        const text = getFirstText(result);
        expect(text).toMatch(/readonly/i);
      });

      it('should allow SELECT (read-only query)', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: 'SELECT 1 AS value',
        });

        expect(result.isError).toBeFalsy();
      });
    });

    describe('max_execution_time enforcement', () => {
      it('should kill a query that exceeds max_execution_time', async () => {
        // Test directly with ClickhouseClient to use a short timeout (1s)
        // instead of waiting for the full 30s MCP default.
        const clickhouseClient = new ClickhouseClient({
          host: config.CLICKHOUSE_HOST,
          username: config.CLICKHOUSE_USER,
          password: config.CLICKHOUSE_PASSWORD,
          requestTimeout: 5_000,
        });

        await expect(
          clickhouseClient.query({
            query: 'SELECT sleep(3)',
            format: 'JSON',
            clickhouse_settings: {
              max_execution_time: 1,
            },
          }),
        ).rejects.toThrow(/TIMEOUT_EXCEEDED|timeout/i);
      });
    });

    describe('settings propagation via clickstack_sql', () => {
      it('should propagate max_execution_time=30 to ClickHouse', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: "SELECT getSetting('max_execution_time') AS value",
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(getFirstText(result));
        expect(parsed.result?.data?.[0]?.value).toBe(30);
      });

      it('should propagate readonly=2 to ClickHouse', async () => {
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: "SELECT getSetting('readonly') AS value",
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(getFirstText(result));
        expect(parsed.result?.data?.[0]?.value).toBe(2);
      });

      it('should apply all safety settings together without readonly conflicts', async () => {
        // readonly=1 rejects setting changes, so max_execution_time
        // would be silently ignored. readonly=2 allows setting changes
        // while still blocking writes. This test verifies both settings
        // are applied in a single query.
        const result = await callTool(client, 'clickstack_sql', {
          connectionId: connection._id.toString(),
          sql: `SELECT
              getSetting('readonly') AS readonly_mode,
              getSetting('max_execution_time') AS max_exec_time`,
        });

        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(getFirstText(result));
        const row = parsed.result?.data?.[0];
        expect(row?.readonly_mode).toBe(2);
        expect(row?.max_exec_time).toBe(30);
      });
    });
  });

  // ── Metric source query coverage ─────────────────────────────────────────

  describe('Metric sources (timeseries + table)', () => {
    const createMetricSource = () =>
      Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        from: { databaseName: DEFAULT_DATABASE, tableName: '' },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: 'otel_metrics_gauge',
          [MetricsDataType.Sum.toLowerCase()]: 'otel_metrics_sum',
          [MetricsDataType.Histogram.toLowerCase()]: 'otel_metrics_histogram',
          [MetricsDataType.ExponentialHistogram.toLowerCase()]:
            DEFAULT_METRICS_TABLE.EXPONENTIAL_HISTOGRAM,
        },
        timestampValueExpression: 'TimeUnix',
        connection: connection._id,
        name: 'Metrics',
      });

    const seedGauge = async (now: Date) => {
      await bulkInsertMetricsGauge([
        {
          MetricName: 'system.cpu.utilization',
          ResourceAttributes: { 'service.name': 'svc-a' },
          ServiceName: 'svc-a',
          TimeUnix: now,
          Value: 0.42,
        },
        {
          MetricName: 'system.cpu.utilization',
          ResourceAttributes: { 'service.name': 'svc-a' },
          ServiceName: 'svc-a',
          TimeUnix: new Date(now.getTime() + 1000),
          Value: 0.61,
        },
      ]);
    };

    const seedSum = async (now: Date) => {
      await bulkInsertMetricsSum([
        {
          MetricName: 'http.server.request.count',
          AggregationTemporality: 1, // DELTA
          IsMonotonic: true,
          ResourceAttributes: { 'service.name': 'svc-a' },
          ServiceName: 'svc-a',
          TimeUnix: now,
          Value: 100,
        },
        {
          MetricName: 'http.server.request.count',
          AggregationTemporality: 1,
          IsMonotonic: true,
          ResourceAttributes: { 'service.name': 'svc-a' },
          ServiceName: 'svc-a',
          TimeUnix: new Date(now.getTime() + 1000),
          Value: 25,
        },
      ]);
    };

    const seedHistogram = async (now: Date) => {
      await bulkInsertMetricsHistogram([
        {
          MetricName: 'http.server.request.duration',
          ResourceAttributes: { 'service.name': 'svc-a' },
          TimeUnix: now,
          BucketCounts: [1, 2, 3, 4],
          ExplicitBounds: [10, 100, 1000],
          AggregationTemporality: 1,
        },
      ]);
    };

    const seedExponentialHistogram = async (now: Date) => {
      await seedExponentialHistogramMetric({
        metricName: 'http.server.request.duration.exponential',
        aggregationTemporality: 1,
        points: [
          {
            TimeUnix: now,
            ResourceAttributes: { 'service.name': 'svc-a' },
            ServiceName: 'svc-a',
            ...bucketExponentialHistogramObservations([2, 4, 8]),
          },
        ],
      });
    };

    it('runs clickstack_timeseries against a gauge metric source', async () => {
      const metricSource = await createMetricSource();
      const now = new Date();
      await seedGauge(now);

      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: metricSource._id.toString(),
        select: [
          {
            aggFn: 'avg',
            metricType: 'gauge',
            metricName: 'system.cpu.utilization',
            alias: 'cpu',
          },
        ],
        startTime: new Date(now.getTime() - 60_000).toISOString(),
        endTime: new Date(now.getTime() + 60_000).toISOString(),
        granularity: '1 minute',
      });

      expect(result.isError).toBeFalsy();
      // No "Both table name and UUID are empty" error from the renderer.
      expect(getFirstText(result)).not.toMatch(/UUID are empty/);

      // Granularity must survive into the renderer: the result is bucketed
      // over time (the __hdx_time_bucket column is present) rather than
      // collapsed into a single per-group aggregate. Regression guard for
      // the granularity-stripping bug.
      const output = JSON.parse(getFirstText(result));
      const metaNames = (output.result?.meta ?? []).map(
        (m: { name: string }) => m.name,
      );
      expect(metaNames).toContain('__hdx_time_bucket');
      // Since the result IS bucketed, the "not bucketed over time" hint
      // must never fire (it would be wrong advice).
      const hints: string[] = output.hints ?? [];
      expect(hints.some(h => /not bucketed over time/.test(h))).toBe(false);
    });

    it('runs clickstack_table aggFn:"increase" against a sum metric source', async () => {
      const metricSource = await createMetricSource();
      const now = new Date();
      await seedSum(now);

      const result = await callTool(client, 'clickstack_table', {
        sourceId: metricSource._id.toString(),
        select: [
          {
            aggFn: 'increase',
            metricType: 'sum',
            metricName: 'http.server.request.count',
            alias: 'requests',
          },
        ],
        startTime: new Date(now.getTime() - 60_000).toISOString(),
        endTime: new Date(now.getTime() + 60_000).toISOString(),
      });

      expect(result.isError).toBeFalsy();
      expect(getFirstText(result)).not.toMatch(/UUID are empty/);
    });

    it('runs clickstack_timeseries quantile against a histogram metric source', async () => {
      const metricSource = await createMetricSource();
      const now = new Date();
      await seedHistogram(now);

      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: metricSource._id.toString(),
        select: [
          {
            aggFn: 'quantile',
            level: 0.95,
            metricType: 'histogram',
            metricName: 'http.server.request.duration',
            alias: 'p95',
          },
        ],
        startTime: new Date(now.getTime() - 60_000).toISOString(),
        endTime: new Date(now.getTime() + 60_000).toISOString(),
        granularity: '1 minute',
      });

      expect(result.isError).toBeFalsy();
    });

    it('runs clickstack_timeseries quantile against an exponential histogram metric source', async () => {
      const metricSource = await createMetricSource();
      const now = new Date();
      await seedExponentialHistogram(now);

      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: metricSource._id.toString(),
        select: [
          {
            aggFn: 'quantile',
            level: 0.95,
            metricType: 'exponential histogram',
            metricName: 'http.server.request.duration.exponential',
            alias: 'p95',
          },
        ],
        startTime: new Date(now.getTime() - 60_000).toISOString(),
        endTime: new Date(now.getTime() + 60_000).toISOString(),
        granularity: '1 minute',
      });

      expect(result.isError).toBeFalsy();
    });

    it('runs clickstack_table count against an exponential histogram metric source', async () => {
      const metricSource = await createMetricSource();
      const now = new Date();
      await seedExponentialHistogram(now);

      const result = await callTool(client, 'clickstack_table', {
        sourceId: metricSource._id.toString(),
        select: [
          {
            aggFn: 'count',
            metricType: 'exponential histogram',
            metricName: 'http.server.request.duration.exponential',
            alias: 'count',
          },
        ],
        startTime: new Date(now.getTime() - 60_000).toISOString(),
        endTime: new Date(now.getTime() + 60_000).toISOString(),
      });

      expect(result.isError).toBeFalsy();
    });

    it('rejects aggFn:"increase" on a gauge select item with a friendly schema error', async () => {
      const metricSource = await createMetricSource();
      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: metricSource._id.toString(),
        select: [
          {
            aggFn: 'increase',
            metricType: 'gauge',
            metricName: 'system.cpu.utilization',
          },
        ],
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toMatch(/"increase" is only valid for sum/);
    });

    it('rejects aggFn:"quantile" on a histogram without level', async () => {
      const metricSource = await createMetricSource();
      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: metricSource._id.toString(),
        select: [
          {
            aggFn: 'quantile',
            metricType: 'histogram',
            metricName: 'http.server.request.duration',
          },
        ],
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toMatch(/level is required/);
    });

    it('rejects aggFn:"avg" on a histogram select item', async () => {
      const metricSource = await createMetricSource();
      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: metricSource._id.toString(),
        select: [
          {
            aggFn: 'avg',
            metricType: 'histogram',
            metricName: 'http.server.request.duration',
          },
        ],
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toMatch(
        /Histogram metrics only support aggFn/,
      );
    });

    it('rejects metricType without metricName', async () => {
      const metricSource = await createMetricSource();
      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: metricSource._id.toString(),
        select: [{ aggFn: 'avg', metricType: 'gauge' }],
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toMatch(/metricName is required/);
    });

    it('rejects isDelta on a non-gauge metric', async () => {
      const metricSource = await createMetricSource();
      const result = await callTool(client, 'clickstack_timeseries', {
        sourceId: metricSource._id.toString(),
        select: [
          {
            aggFn: 'increase',
            metricType: 'sum',
            metricName: 'http.server.request.count',
            isDelta: true,
          },
        ],
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toMatch(/isDelta is only valid for gauge/);
    });
  });
});
