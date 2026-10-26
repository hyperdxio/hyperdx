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
import { McpContext } from '@/mcp/tools/types';
import Connection from '@/models/connection';
import { Source, type SourceDocument } from '@/models/source';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

const TOOL = 'clickstack_service_health';
const HOUR = 60 * 60 * 1000;
// ClickHouse is shared across tests and files, so scope every query to this
// run's services.
const RUN = `sh${Date.now()}`;
const svc = (name: string) => `${RUN}-${name}`;

type Span = {
  ServiceName: string;
  SpanKind?: string;
  durationMs?: number;
  error?: string;
};

type ServiceReport = {
  service: string;
  status: string;
  flags: string[];
  current: {
    requests: number;
    errors: number;
    errorRate: number;
    p95Ms: number;
  };
  comparison?: { requests: number; errors: number } | null;
  topErrors: {
    group: Record<string, string>;
    count: number;
    comparisonCount?: number;
    status?: string;
  }[];
};

describe('MCP Service Health Tool', () => {
  const server = getServer();
  let client: Client;
  let traceSource: SourceDocument;
  let logSource: SourceDocument;
  const now = Date.now();

  async function insertSpans(windowStart: number, spans: Span[]) {
    await bulkInsertData(
      `${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`,
      spans.map((s, i) => ({
        // Spread across the first 50 minutes of the window.
        Timestamp: new Date(windowStart + ((i * 30_000) % (50 * 60_000))),
        TraceId: `trace-${windowStart}-${i}`,
        SpanId: `span-${windowStart}-${i}`,
        ParentSpanId: '',
        SpanName: 'GET /api',
        SpanKind: s.SpanKind ?? (i % 2 ? 'Server' : 'SPAN_KIND_SERVER'),
        ServiceName: s.ServiceName,
        Duration: (s.durationMs ?? 100) * 1e6,
        // Both error spellings must count.
        StatusCode: s.error ? (i % 2 ? 'Error' : 'STATUS_CODE_ERROR') : 'Ok',
        StatusMessage: s.error ?? '',
        SpanAttributes: {},
        ResourceAttributes: {},
      })),
    );
  }

  const repeat = (n: number, s: Span): Span[] =>
    Array.from({ length: n }, () => s);

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const { team, user } = await getLoggedInAgent(server);
    const connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    logSource = await Source.create({
      kind: SourceKind.Log,
      team: team._id,
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_LOGS_TABLE },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Logs',
    });
    traceSource = await Source.create({
      kind: SourceKind.Trace,
      team: team._id,
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_TRACES_TABLE },
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

  const call = (args: Record<string, unknown> = {}) =>
    callTool(client, TOOL, {
      sourceId: traceSource._id.toString(),
      startTime: new Date(now - HOUR).toISOString(),
      endTime: new Date(now).toISOString(),
      where: `startsWith(ServiceName, '${RUN}')`,
      whereLanguage: 'sql',
      ...args,
    });

  const parse = (result: Awaited<ReturnType<typeof call>>) => {
    expect(result.isError).toBeFalsy();
    const body: {
      summary: Record<string, unknown>;
      services: ServiceReport[];
    } = JSON.parse(getFirstText(result));
    return body;
  };

  it('is listed with its input schema', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === TOOL);
    expect(tool?.inputSchema.required).toEqual(['sourceId']);
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining([
        'comparison',
        'spanKind',
        'errorGroupBy',
        'topN',
      ]),
    );
  });

  it('rejects non-trace sources', async () => {
    const result = await call({ sourceId: logSource._id.toString() });
    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('kind="trace"');
  });

  it('points a table name passed as sourceId at the right source ID', async () => {
    const result = await call({ sourceId: DEFAULT_TRACES_TABLE });
    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain(
      `sourceId:"${traceSource._id.toString()}"`,
    );
  });

  it('rejects a window longer than the comparison shift', async () => {
    const result = await call({
      startTime: new Date(now - 30 * HOUR).toISOString(),
    });
    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toMatch(/overlap/);
  });

  describe('with data in both windows', () => {
    beforeAll(async () => {
      const currentStart = now - HOUR;
      const yesterdayStart = currentStart - 24 * HOUR;
      await insertSpans(currentStart, [
        ...repeat(99, { ServiceName: svc('steady') }),
        ...repeat(1, { ServiceName: svc('steady'), error: 'flaky' }),
        // Internal error spans must not count with the default spanKind.
        ...repeat(100, {
          ServiceName: svc('steady'),
          SpanKind: 'Internal',
          error: 'internal',
        }),
        ...repeat(80, { ServiceName: svc('erroring') }),
        ...repeat(15, { ServiceName: svc('erroring'), error: 'db timeout' }),
        ...repeat(5, { ServiceName: svc('erroring'), error: 'auth failed' }),
        ...repeat(100, { ServiceName: svc('slow'), durationMs: 600 }),
      ]);
      await insertSpans(yesterdayStart, [
        ...repeat(99, { ServiceName: svc('steady') }),
        ...repeat(1, { ServiceName: svc('steady'), error: 'flaky' }),
        ...repeat(99, { ServiceName: svc('erroring') }),
        ...repeat(1, { ServiceName: svc('erroring'), error: 'db timeout' }),
        ...repeat(100, { ServiceName: svc('slow'), durationMs: 100 }),
      ]);
    });

    it('ranks regressions first and leaves steady services healthy', async () => {
      const { summary, services } = parse(await call());
      expect(services.map(s => [s.service, s.status])).toEqual([
        [svc('erroring'), 'critical'],
        [svc('slow'), 'degraded'],
        [svc('steady'), 'healthy'],
      ]);
      expect(services[0].flags).toEqual(
        expect.arrayContaining(['error_rate_up', 'high_error_rate']),
      );
      expect(services[1].flags).toContain('latency_up');
      expect(services[1].current.p95Ms).toBeCloseTo(600, -1);
      expect(summary.statusCounts).toEqual({
        critical: 1,
        degraded: 1,
        healthy: 1,
      });
    });

    it('counts server spans only by default', async () => {
      const { services } = parse(await call());
      const steady = services.find(s => s.service === svc('steady'));
      expect(steady?.current.requests).toBe(100);
      expect(steady?.current.errors).toBe(1);

      const all = parse(await call({ spanKind: 'all' }));
      expect(
        all.services.find(s => s.service === svc('steady'))?.current.requests,
      ).toBe(200);
    });

    it('tags error groups as new or growing against the comparison', async () => {
      const { services } = parse(await call());
      expect(services[0].topErrors).toEqual([
        expect.objectContaining({
          group: { SpanName: 'GET /api', StatusMessage: 'db timeout' },
          count: 15,
          comparisonCount: 1,
          status: 'growing',
        }),
        expect.objectContaining({
          group: { SpanName: 'GET /api', StatusMessage: 'auth failed' },
          count: 5,
          comparisonCount: 0,
          status: 'new',
        }),
      ]);
      // Spans are spread over the first 50 minutes, so nothing is ongoing.
      const first = services[0].topErrors[0] as Record<string, unknown>;
      expect(Date.parse(String(first.firstSeen))).toBeLessThan(
        Date.parse(String(first.lastSeen)),
      );
      expect(first.ongoing).toBe(false);
    });

    it('accepts a custom errorGroupBy', async () => {
      const { services } = parse(await call({ errorGroupBy: 'StatusMessage' }));
      expect(services[0].topErrors[0].group).toEqual({
        StatusMessage: 'db timeout',
      });
    });

    it('omits comparisons with comparison:none', async () => {
      const { summary, services } = parse(await call({ comparison: 'none' }));
      expect(summary.comparisonWindow).toBeNull();
      expect(services[0].comparison).toBeUndefined();
      expect(services[0].topErrors[0].status).toBeUndefined();
    });

    it('filters to the requested services', async () => {
      const { services } = parse(await call({ services: [svc('slow')] }));
      expect(services.map(s => s.service)).toEqual([svc('slow')]);
    });
  });
});
