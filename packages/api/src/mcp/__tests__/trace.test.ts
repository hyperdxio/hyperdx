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
      // Use unique names to avoid collisions with other test suites —
      // otel_traces is NOT truncated between tests (see clearClickhouseTables).
      const TRACE_ID = 'aaaabbbbccccddddeeeeffffgggghhhh';
      const ROOT_SPAN_ID = '1111111111111111';
      const CHILD_A_SPAN_ID = '2222222222222222';
      const CHILD_B_SPAN_ID = '3333333333333333';
      const WF_SVC = 'wf-test-api-gateway';
      const WF_ROOT_OP = 'GET /wf-test/users';
      const WF_CHILD_A_OP = 'wf-test-SELECT-users';
      const WF_CHILD_B_OP = 'wf-test-cache.get';
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

      beforeEach(async () => {
        await bulkInsertTraces([
          {
            Timestamp: fiveMinAgo,
            TraceId: TRACE_ID,
            SpanId: ROOT_SPAN_ID,
            ParentSpanId: '',
            SpanName: WF_ROOT_OP,
            SpanKind: 'SPAN_KIND_SERVER',
            ServiceName: WF_SVC,
            Duration: 500_000_000, // 500ms in ns
            StatusCode: 'STATUS_CODE_OK',
          },
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 10),
            TraceId: TRACE_ID,
            SpanId: CHILD_A_SPAN_ID,
            ParentSpanId: ROOT_SPAN_ID,
            SpanName: WF_CHILD_A_OP,
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: WF_SVC,
            Duration: 200_000_000, // 200ms in ns
            StatusCode: 'STATUS_CODE_OK',
          },
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 20),
            TraceId: TRACE_ID,
            SpanId: CHILD_B_SPAN_ID,
            ParentSpanId: ROOT_SPAN_ID,
            SpanName: WF_CHILD_B_OP,
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: 'wf-test-cache-service',
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
        expect(output.spans[0].serviceName).toBe(WF_SVC);
        expect(output.spans[0].spanName).toBe(WF_ROOT_OP);

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
          pickFilter: `ServiceName:${WF_SVC}`,
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
          pickFilter: `ServiceName:${WF_SVC}`,
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
            Body: 'Handling request',
            ServiceName: WF_SVC,
            SeverityText: 'INFO',
          },
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 15),
            TraceId: TRACE_ID,
            SpanId: CHILD_A_SPAN_ID,
            Body: 'Executing query',
            ServiceName: WF_SVC,
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
          pickFilter: `ServiceName:${WF_SVC}`,
          pickBy: 'slowest',
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.traceId).toBe(TRACE_ID);
      });

      it('should apply pickFilter with sql language', async () => {
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: traceSource._id.toString(),
          pickFilter: `ServiceName = '${WF_SVC}'`,
          pickFilterLanguage: 'sql',
          pickBy: 'most_recent',
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.traceId).toBe(TRACE_ID);
        expect(output.spanCount).toBeGreaterThan(0);
      });
    });

    describe('first_error pick mode', () => {
      const ERROR_TRACE_ID = 'ffff0000eeee1111dddd2222cccc3333';
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

      beforeEach(async () => {
        await bulkInsertTraces([
          {
            Timestamp: fiveMinAgo,
            TraceId: ERROR_TRACE_ID,
            SpanId: 'err_root_span01',
            ParentSpanId: '',
            SpanName: 'GET /wf-test-err/fail',
            SpanKind: 'SPAN_KIND_SERVER',
            ServiceName: 'wf-test-err-svc',
            Duration: 100_000_000,
            StatusCode: 'STATUS_CODE_ERROR',
            StatusMessage: 'Internal Server Error',
          },
        ]);
      });

      it('should auto-pick trace with an error span', async () => {
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: traceSource._id.toString(),
          pickFilter: 'ServiceName:wf-test-err-svc',
          pickBy: 'first_error',
          startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.traceId).toBe(ERROR_TRACE_ID);
        expect(output.spanCount).toBeGreaterThan(0);
      });
    });

    describe('logSource edge cases', () => {
      it('should handle missing logSourceId gracefully (no logs section)', async () => {
        // Create a trace source WITHOUT logSourceId
        const noLogTraceSource = await Source.create({
          kind: SourceKind.Trace,
          team: team._id,
          from: {
            databaseName: DEFAULT_DATABASE,
            tableName: DEFAULT_TRACES_TABLE,
          },
          timestampValueExpression: 'Timestamp',
          connection: connection._id,
          name: 'Traces No Log Link',
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
          // logSourceId intentionally omitted
        });

        const TRACE_ID = 'aaaabbbbccccddddeeeeffffgggghhhh';
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: noLogTraceSource._id.toString(),
          traceId: TRACE_ID,
          includeLogs: true,
          startTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(Date.now() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        // Should succeed without a logs section
        expect(output.logs).toBeUndefined();
      });

      it('should note when logSourceId points to a non-existent source', async () => {
        const badLogTraceSource = await Source.create({
          kind: SourceKind.Trace,
          team: team._id,
          from: {
            databaseName: DEFAULT_DATABASE,
            tableName: DEFAULT_TRACES_TABLE,
          },
          timestampValueExpression: 'Timestamp',
          connection: connection._id,
          name: 'Traces Bad Log Link',
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
          logSourceId: '000000000000000000000000',
        });

        const TRACE_ID = 'aaaabbbbccccddddeeeeffffgggghhhh';
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: badLogTraceSource._id.toString(),
          traceId: TRACE_ID,
          includeLogs: true,
          startTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(Date.now() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.logsNote).toBeDefined();
        expect(output.logsNote).toContain('not found');
      });

      it('should note when logSourceId points to a non-log source', async () => {
        // Point logSourceId at the trace source itself (wrong kind)
        const wrongKindTraceSource = await Source.create({
          kind: SourceKind.Trace,
          team: team._id,
          from: {
            databaseName: DEFAULT_DATABASE,
            tableName: DEFAULT_TRACES_TABLE,
          },
          timestampValueExpression: 'Timestamp',
          connection: connection._id,
          name: 'Traces Wrong Kind Log',
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
          logSourceId: traceSource._id.toString(), // points to a trace source, not log
        });

        const TRACE_ID = 'aaaabbbbccccddddeeeeffffgggghhhh';
        const result = await callTool(client, 'hyperdx_trace_waterfall', {
          sourceId: wrongKindTraceSource._id.toString(),
          traceId: TRACE_ID,
          includeLogs: true,
          startTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          endTime: new Date(Date.now() + 60 * 1000).toISOString(),
        });

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.logsNote).toBeDefined();
        expect(output.logsNote).toContain('not "log"');
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
      // Use unique names to avoid collisions with other test suites —
      // otel_traces is NOT truncated between tests (see clearClickhouseTables).
      const TRACE_ID_1 = 'aaaa1111bbbb2222cccc3333dddd4444';
      const TRACE_ID_2 = 'eeee5555ffff6666aaaa7777bbbb8888';
      const PARENT_SVC = 'trc-test-api-gateway';
      const PARENT_OP = 'GET /trc-test/users';
      const CHILD_DB_SVC = 'trc-test-db-service';
      const CHILD_DB_OP = 'trc-test-SELECT-users';
      const CHILD_CACHE_SVC = 'trc-test-cache-service';
      const CHILD_CACHE_OP = 'trc-test-cache.get';
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
            SpanName: PARENT_OP,
            SpanKind: 'SPAN_KIND_SERVER',
            ServiceName: PARENT_SVC,
            Duration: 800_000_000, // 800ms in ns
            StatusCode: 'STATUS_CODE_OK',
          },
          // Child: slow DB call
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 10),
            TraceId: TRACE_ID_1,
            SpanId: 'child_db_0001',
            ParentSpanId: 'root_span_0001',
            SpanName: CHILD_DB_OP,
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: CHILD_DB_SVC,
            Duration: 600_000_000, // 600ms
            StatusCode: 'STATUS_CODE_OK',
          },
          // Child: fast cache call
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 20),
            TraceId: TRACE_ID_1,
            SpanId: 'child_cache_001',
            ParentSpanId: 'root_span_0001',
            SpanName: CHILD_CACHE_OP,
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: CHILD_CACHE_SVC,
            Duration: 10_000_000, // 10ms
            StatusCode: 'STATUS_CODE_OK',
          },
          // Trace 2: same parent pattern, different child durations
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 1000),
            TraceId: TRACE_ID_2,
            SpanId: 'root_span_0002',
            ParentSpanId: '',
            SpanName: PARENT_OP,
            SpanKind: 'SPAN_KIND_SERVER',
            ServiceName: PARENT_SVC,
            Duration: 900_000_000, // 900ms
            StatusCode: 'STATUS_CODE_OK',
          },
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 1010),
            TraceId: TRACE_ID_2,
            SpanId: 'child_db_0002',
            ParentSpanId: 'root_span_0002',
            SpanName: CHILD_DB_OP,
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: CHILD_DB_SVC,
            Duration: 700_000_000, // 700ms
            StatusCode: 'STATUS_CODE_OK',
          },
          {
            Timestamp: new Date(fiveMinAgo.getTime() + 1020),
            TraceId: TRACE_ID_2,
            SpanId: 'child_cache_002',
            ParentSpanId: 'root_span_0002',
            SpanName: CHILD_CACHE_OP,
            SpanKind: 'SPAN_KIND_CLIENT',
            ServiceName: CHILD_CACHE_SVC,
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
            parentFilter: `ServiceName = '${PARENT_SVC}' AND SpanName = '${PARENT_OP}'`,
            startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
            endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
          },
        );

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.operations.length).toBeGreaterThanOrEqual(2);

        // DB operations should be ranked first (higher total time)
        const dbOp = output.operations.find(
          (op: any) => op.operation === CHILD_DB_OP,
        );
        const cacheOp = output.operations.find(
          (op: any) => op.operation === CHILD_CACHE_OP,
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
            parentFilter: `ServiceName = '${PARENT_SVC}' AND SpanName = '${PARENT_OP}'`,
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
          (op: any) => op.operation === CHILD_DB_OP,
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
            parentFilter: `ServiceName = '${PARENT_SVC}' AND SpanName = '${PARENT_OP}'`,
            topN: 1,
            startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
            endTime: new Date(now.getTime() + 60 * 1000).toISOString(),
          },
        );

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.operations).toHaveLength(1);
        // The top operation should be the DB call (highest total time)
        expect(output.operations[0].operation).toBe(CHILD_DB_OP);
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
            parentFilter: `ServiceName = '${PARENT_SVC}' AND SpanName = '${PARENT_OP}'`,
            startTime,
            endTime,
          },
        );

        expect(result.isError).toBeFalsy();
        const output = JSON.parse(getFirstText(result));
        expect(output.summary).toBeDefined();
        expect(output.summary.parentFilter).toContain(PARENT_SVC);
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
