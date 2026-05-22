import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import * as config from '@/config';
import {
  bulkInsertData,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Insert trace spans into the default otel_traces table. */
async function bulkInsertTraces(
  spans: {
    Timestamp: Date;
    TraceId: string;
    SpanId: string;
    ParentSpanId: string;
    SpanName: string;
    SpanKind: string;
    ServiceName: string;
    Duration: number; // nanoseconds
    StatusCode: string;
    StatusMessage?: string;
    SpanAttributes?: Record<string, string>;
  }[],
) {
  await bulkInsertData(
    `${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`,
    spans.map(s => ({
      ...s,
      StatusMessage: s.StatusMessage ?? '',
      SpanAttributes: s.SpanAttributes ?? {},
      ResourceAttributes: {},
    })),
  );
}

/** Insert log rows into the default otel_logs table. */
async function bulkInsertLogs(
  logs: {
    Timestamp: Date;
    TraceId: string;
    SpanId: string;
    Body: string;
    ServiceName: string;
    SeverityText: string;
  }[],
) {
  await bulkInsertData(`${DEFAULT_DATABASE}.${DEFAULT_LOGS_TABLE}`, logs);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('MCP Trace Tools', () => {
  const server = getServer();
  let team: any;
  let user: any;
  let connection: any;
  let traceSource: SourceDocument;
  let logSource: SourceDocument;
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
      serviceNameExpression: 'ServiceName',
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
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
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
      parentSpanIdExpression: 'ParentSpanId',
      spanNameExpression: 'SpanName',
      spanKindExpression: 'SpanKind',
      durationExpression: 'Duration',
      durationPrecision: 9,
      serviceNameExpression: 'ServiceName',
      statusCodeExpression: 'StatusCode',
      statusMessageExpression: 'StatusMessage',
      eventAttributesExpression: 'SpanAttributes',
      logSourceId: logSource._id.toString(),
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

  // ─── Schema serialization ──────────────────────────────────────────────────

  describe('schema serialization', () => {
    it('should expose hyperdx_trace_waterfall with expected properties', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find(t => t.name === 'hyperdx_trace_waterfall');
      expect(tool).toBeDefined();

      const props = Object.keys(tool!.inputSchema.properties ?? {});
      expect(props).toContain('sourceId');
      expect(props).toContain('traceId');
      expect(props).toContain('pickFilter');
      expect(props).toContain('pickBy');
      expect(props).toContain('maxSpans');
      expect(props).toContain('includeLogs');
      expect(tool!.inputSchema.required).toContain('sourceId');
    });

    it('should expose hyperdx_trace_top_time_consuming_operations with expected properties', async () => {
      const { tools } = await client.listTools();
      const tool = tools.find(
        t => t.name === 'hyperdx_trace_top_time_consuming_operations',
      );
      expect(tool).toBeDefined();

      const props = Object.keys(tool!.inputSchema.properties ?? {});
      expect(props).toContain('sourceId');
      expect(props).toContain('parentFilter');
      expect(props).toContain('startTime');
      expect(props).toContain('endTime');
      expect(props).toContain('minParentDurationMs');
      expect(props).toContain('topN');
      expect(tool!.inputSchema.required).toContain('sourceId');
      expect(tool!.inputSchema.required).toContain('parentFilter');
      expect(tool!.inputSchema.required).toContain('startTime');
      expect(tool!.inputSchema.required).toContain('endTime');
    });
  });

  // ─── hyperdx_trace_waterfall ───────────────────────────────────────────────

  describe('hyperdx_trace_waterfall', () => {
    it('should return error for non-existent source', async () => {
      const result = await callTool(client, 'hyperdx_trace_waterfall', {
        sourceId: '000000000000000000000000',
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Source not found');
    });

    it('should return error for non-trace source', async () => {
      const result = await callTool(client, 'hyperdx_trace_waterfall', {
        sourceId: logSource._id.toString(),
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('kind=');
    });

    it('should return error for invalid time range', async () => {
      const result = await callTool(client, 'hyperdx_trace_waterfall', {
        sourceId: traceSource._id.toString(),
        startTime: 'not-a-date',
      });
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Invalid');
    });

    it('should return no-match hint when no traces exist', async () => {
      const result = await callTool(client, 'hyperdx_trace_waterfall', {
        sourceId: traceSource._id.toString(),
        startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.result).toBeNull();
      expect(output.hint).toBeDefined();
    });

    describe('with seeded trace data', () => {
      const TRACE_ID = 'aaaabbbbccccddddeeeeffffgggghhhh';
      const ROOT_SPAN_ID = '1111111111111111';
      const CHILD_A_SPAN_ID = '2222222222222222';
      const CHILD_B_SPAN_ID = '3333333333333333';
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

      beforeEach(async () => {
        await bulkInsertTraces([
          {
            Timestamp: fiveMinAgo,
            TraceId: TRACE_ID,
            SpanId: ROOT_SPAN_ID,
            ParentSpanId: '',
            SpanName: 'GET /api/users',
            SpanKind: 'SPAN_KIND_SERVER',
            ServiceName: 'api-gateway',
            Duration: 500_000_000, // 500ms in ns
            StatusCode: 'STATUS_CODE_OK',
          },
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 10),
            TraceId: TRACE_ID,
            SpanId: CHILD_A_SPAN_ID,
            ParentSpanId: ROOT_SPAN_ID,
            SpanName: 'SELECT users',
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: 'api-gateway',
            Duration: 200_000_000, // 200ms in ns
            StatusCode: 'STATUS_CODE_OK',
          },
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 20),
            TraceId: TRACE_ID,
            SpanId: CHILD_B_SPAN_ID,
            ParentSpanId: ROOT_SPAN_ID,
            SpanName: 'cache.get',
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: 'cache-service',
            Duration: 50_000_000, // 50ms in ns
            StatusCode: 'STATUS_CODE_OK',
          },
        ]);
      });

      it('should fetch a trace by traceId and return a waterfall tree', async () => {
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: traceSource._id.toString(),
          traceId: TRACE_ID,
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.traceId).toBe(TRACE_ID);
        expect(output.spanCount).toBe(3);
        expect(output.spans).toHaveLength(3);

        // Root span should be first (depth 0)
        expect(output.spans[0].depth).toBe(0);
        expect(output.spans[0].spanId).toBe(ROOT_SPAN_ID);
        expect(output.spans[0].serviceName).toBe('api-gateway');
        expect(output.spans[0].spanName).toBe('GET /api/users');

        // Children should follow (depth 1)
        const children = output.spans.filter((s: any) => s.depth === 1);
        expect(children).toHaveLength(2);

        // Summary fields
        expect(output.rootSpan).toBeDefined();
        expect(output.rootSpan.spanId).toBe(ROOT_SPAN_ID);
        expect(output.totalDurationMs).toBeGreaterThan(0);
      });

      it('should auto-pick the slowest trace when traceId is omitted', async () => {
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: traceSource._id.toString(),
          pickBy: 'slowest',
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.traceId).toBe(TRACE_ID);
        expect(output.spanCount).toBeGreaterThan(0);
      });

      it('should auto-pick the most recent trace', async () => {
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: traceSource._id.toString(),
          pickBy: 'most_recent',
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.traceId).toBe(TRACE_ID);
      });

      it('should respect maxSpans and note truncation', async () => {
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: traceSource._id.toString(),
          traceId: TRACE_ID,
          maxSpans: 2,
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.spanCount).toBe(2);
        expect(output.note).toBeDefined();
        expect(output.note).toContain('truncated');
      });

      it('should include correlated logs when includeLogs is true and logSourceId is configured', async () => {
        // Insert correlated log rows
        await bulkInsertLogs([
          {
            Timestamp: fiveMinAgo,
            TraceId: TRACE_ID,
            SpanId: ROOT_SPAN_ID,
            Body: 'Handling GET /api/users request',
            ServiceName: 'api-gateway',
            SeverityText: 'INFO',
          },
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 15),
            TraceId: TRACE_ID,
            SpanId: CHILD_A_SPAN_ID,
            Body: 'Executing SELECT query',
            ServiceName: 'api-gateway',
            SeverityText: 'DEBUG',
          },
        ]);

        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: traceSource._id.toString(),
          traceId: TRACE_ID,
          includeLogs: true,
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.logs).toBeDefined();
        expect(output.logsCount).toBe(2);
        expect(output.logs[0]).toHaveProperty('spanId');
        expect(output.logs[0]).toHaveProperty('body');
      });

      it('should omit logs when includeLogs is false', async () => {
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: traceSource._id.toString(),
          traceId: TRACE_ID,
          includeLogs: false,
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.logs).toBeUndefined();
      });

      it('should apply pickFilter to narrow which trace is picked', async () => {
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: traceSource._id.toString(),
          pickFilter: 'ServiceName:api-gateway',
          pickBy: 'slowest',
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.traceId).toBe(TRACE_ID);
      });
    });
  });

  // ─── hyperdx_trace_top_time_consuming_operations ───────────────────────────

  describe('hyperdx_trace_top_time_consuming_operations', () => {
    it('should return error for non-existent source', async () => {
      const result = await callTool(
        client,
        'hyperdx_trace_top_time_consuming_operations',
        {
          sourceId: '000000000000000000000000',
          parentFilter: "ServiceName = 'api-gateway'",
          startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          endTime: new Date().toISOString(),
        },
      );
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Source not found');
    });

    it('should return error for non-trace source', async () => {
      const result = await callTool(
        client,
        'hyperdx_trace_top_time_consuming_operations',
        {
          sourceId: logSource._id.toString(),
          parentFilter: "ServiceName = 'api-gateway'",
          startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          endTime: new Date().toISOString(),
        },
      );
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('kind=');
    });

    it('should return error for invalid time range', async () => {
      const result = await callTool(
        client,
        'hyperdx_trace_top_time_consuming_operations',
        {
          sourceId: traceSource._id.toString(),
          parentFilter: "ServiceName = 'api-gateway'",
          startTime: 'not-a-date',
          endTime: new Date().toISOString(),
        },
      );
      expect(result.isError).toBe(true);
      expect(getFirstText(result)).toContain('Invalid');
    });

    it('should return empty operations when no traces match', async () => {
      const result = await callTool(
        client,
        'hyperdx_trace_top_time_consuming_operations',
        {
          sourceId: traceSource._id.toString(),
          parentFilter: "ServiceName = 'nonexistent-service'",
          startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          endTime: new Date().toISOString(),
        },
      );
      expect(result.isError).toBeFalsy();
      const output = JSON.parse(getFirstText(result));
      expect(output.operations).toHaveLength(0);
      expect(output.summary.hint).toContain('No matching parent traces');
    });

    describe('with seeded trace data', () => {
      const TRACE_ID_1 = 'aaaa1111bbbb2222cccc3333dddd4444';
      const TRACE_ID_2 = 'eeee5555ffff6666aaaa7777bbbb8888';
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

      beforeEach(async () => {
        // Trace 1: api-gateway -> db-service + cache-service
        await bulkInsertTraces([
          // Parent span in trace 1
          {
            Timestamp: fiveMinAgo,
            TraceId: TRACE_ID_1,
            SpanId: 'root_span_0001',
            ParentSpanId: '',
            SpanName: 'GET /api/users',
            SpanKind: 'SPAN_KIND_SERVER',
            ServiceName: 'api-gateway',
            Duration: 800_000_000, // 800ms in ns
            StatusCode: 'STATUS_CODE_OK',
          },
          // Child: slow DB call
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 10),
            TraceId: TRACE_ID_1,
            SpanId: 'child_db_0001',
            ParentSpanId: 'root_span_0001',
            SpanName: 'SELECT users',
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: 'db-service',
            Duration: 600_000_000, // 600ms
            StatusCode: 'STATUS_CODE_OK',
          },
          // Child: fast cache call
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 20),
            TraceId: TRACE_ID_1,
            SpanId: 'child_cache_001',
            ParentSpanId: 'root_span_0001',
            SpanName: 'cache.get',
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: 'cache-service',
            Duration: 10_000_000, // 10ms
            StatusCode: 'STATUS_CODE_OK',
          },
          // Trace 2: same parent pattern, different child durations
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 1000),
            TraceId: TRACE_ID_2,
            SpanId: 'root_span_0002',
            ParentSpanId: '',
            SpanName: 'GET /api/users',
            SpanKind: 'SPAN_KIND_SERVER',
            ServiceName: 'api-gateway',
            Duration: 900_000_000, // 900ms
            StatusCode: 'STATUS_CODE_OK',
          },
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 1010),
            TraceId: TRACE_ID_2,
            SpanId: 'child_db_0002',
            ParentSpanId: 'root_span_0002',
            SpanName: 'SELECT users',
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: 'db-service',
            Duration: 700_000_000, // 700ms
            StatusCode: 'STATUS_CODE_OK',
          },
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 1020),
            TraceId: TRACE_ID_2,
            SpanId: 'child_cache_002',
            ParentSpanId: 'root_span_0002',
            SpanName: 'cache.get',
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: 'cache-service',
            Duration: 20_000_000, // 20ms
            StatusCode: 'STATUS_CODE_OK',
          },
        ]);
      });

      it('should break down child operations ranked by total time', async () => {
        const result = await callTool(
          client,
          'hyperdx_trace_top_time_consuming_operations',
          {
            sourceId: traceSource._id.toString(),
            parentFilter:
              "ServiceName = 'api-gateway' AND SpanName = 'GET /api/users'",
            startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
            endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
          },
        );

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.operations.length).toBeGreaterThanOrEqual(2);

        // DB operations should be ranked first (higher total time)
        const dbOp = output.operations.find(
          (op: any) => op.operation === 'SELECT users',
        );
        const cacheOp = output.operations.find(
          (op: any) => op.operation === 'cache.get',
        );
        expect(dbOp).toBeDefined();
        expect(cacheOp).toBeDefined();
        expect(dbOp.totalTimeMs).toBeGreaterThan(cacheOp.totalTimeMs);

        // DB op should appear in both parent traces
        expect(dbOp.inParents).toBe(2);
        expect(dbOp.calls).toBe(2);

        // Each operation should have share of total time
        expect(dbOp.shareOfTotalTime).toBeGreaterThan(0);
        expect(dbOp.shareOfTotalTime).toBeLessThanOrEqual(1);
      });

      it('should filter by minParentDurationMs', async () => {
        // Only trace 2 has a parent >= 850ms (900ms)
        const result = await callTool(
          client,
          'hyperdx_trace_top_time_consuming_operations',
          {
            sourceId: traceSource._id.toString(),
            parentFilter:
              "ServiceName = 'api-gateway' AND SpanName = 'GET /api/users'",
            minParentDurationMs: 850, // 850ms threshold
            startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
            endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
          },
        );

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.operations.length).toBeGreaterThanOrEqual(1);

        // Only trace 2's children should be included (1 call each)
        const dbOp = output.operations.find(
          (op: any) => op.operation === 'SELECT users',
        );
        expect(dbOp).toBeDefined();
        expect(dbOp.inParents).toBe(1);
      });

      it('should respect topN parameter', async () => {
        const result = await callTool(
          client,
          'hyperdx_trace_top_time_consuming_operations',
          {
            sourceId: traceSource._id.toString(),
            parentFilter:
              "ServiceName = 'api-gateway' AND SpanName = 'GET /api/users'",
            topN: 1,
            startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
            endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
          },
        );

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.operations).toHaveLength(1);
        // The top operation should be the DB call (highest total time)
        expect(output.operations[0].operation).toBe('SELECT users');
      });

      it('should include summary with parentFilter and time range', async () => {
        const startTime = new Date(
          now.getTime() - 10 * 60 * 1000,
        ).toISOString();
        const endTime = new Date(now.getTime() + 60 * 1000).toISOString();

        const result = await callTool(
          client,
          'hyperdx_trace_top_time_consuming_operations',
          {
            sourceId: traceSource._id.toString(),
            parentFilter:
              "ServiceName = 'api-gateway' AND SpanName = 'GET /api/users'",
            startTime,
            endTime,
          },
        );

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.summary).toBeDefined();
        expect(output.summary.parentFilter).toContain('api-gateway');
        expect(output.summary.operationsReturned).toBeGreaterThan(0);
        expect(output.summary.grandTotalTimeMs).toBeGreaterThan(0);
      });

      it('should return error for invalid parentFilter SQL', async () => {
        const result = await callTool(
          client,
          'hyperdx_trace_top_time_consuming_operations',
          {
            sourceId: traceSource._id.toString(),
            parentFilter: 'INVALID SQL @@@ SYNTAX',
            startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
            endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
          },
        );

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain('Failed to compute breakdown');
      });
    });
  });
});
