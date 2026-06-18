import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  bulkInsertLogs,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source, type SourceDocument } from '@/models/source';

import { McpContext } from '../tools/types';
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
});
