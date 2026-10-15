import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ObjectId } from 'mongodb';

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
import { Source } from '@/models/source';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

type HeatmapBody = {
  heatmap: {
    scale: string;
    numberFormat?: { output: string; factor: number };
    times: string[];
    valueEdges: number[];
    counts: number[][];
  } | null;
  hints: string[];
};

describe('MCP Heatmap Tool', () => {
  const server = getServer();
  let client: Client;
  let traceSourceId: string;
  let logSourceId: string;
  // otel_traces is not truncated between tests, so each test filters to its own spans.
  let where: string;
  const now = Date.now();

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
    const traceSource = await Source.create({
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
    const logSource = await Source.create({
      kind: SourceKind.Log,
      team: team._id,
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_LOGS_TABLE },
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Logs',
    });
    traceSourceId = traceSource._id.toString();
    logSourceId = logSource._id.toString();

    const service = `heatmap-${new ObjectId().toString()}`;
    where = `ServiceName:"${service}"`;

    // A fast mode (~1ms) and a slow tail (~1s), so the heatmap is bimodal.
    const durations = [
      ...Array.from({ length: 50 }, (_, i) => 1e6 + i * 1e3),
      ...Array.from({ length: 5 }, (_, i) => 1e9 + i * 1e6),
    ];
    await bulkInsertData(
      `${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`,
      durations.map((Duration, i) => ({
        Timestamp: new Date(now - (i % 5) * 60_000 - 30_000),
        TraceId: `trace-${i}`,
        SpanId: `span-${i}`,
        ParentSpanId: '',
        SpanName: 'GET /api',
        SpanKind: 'Server',
        ServiceName: service,
        Duration,
        StatusCode: 'Ok',
        StatusMessage: '',
        SpanAttributes: {},
        ResourceAttributes: {},
      })),
    );

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

  it('returns counts per time bucket and value range', async () => {
    const result = await callTool(client, 'clickstack_heatmap', {
      sourceId: traceSourceId,
      valueExpression: 'Duration',
      where,
      startTime: new Date(now - 10 * 60_000).toISOString(),
      endTime: new Date(now).toISOString(),
      granularity: '1 minute',
    });

    expect(result.isError).toBeFalsy();
    const body: HeatmapBody = JSON.parse(getFirstText(result));
    const heatmap = body.heatmap!;
    expect(heatmap.scale).toBe('log');
    expect(heatmap.numberFormat).toEqual({ output: 'duration', factor: 1e-9 });
    expect(heatmap.counts).toHaveLength(heatmap.times.length);
    // One count per bucket plus an under- and overflow count.
    for (const column of heatmap.counts) {
      expect(column).toHaveLength(heatmap.valueEdges.length + 1);
    }
    expect(heatmap.counts.flat().reduce((a, b) => a + b, 0)).toBe(55);

    // The slow tail lands in a higher value range than the fast mode.
    const rowTotals = heatmap.counts.reduce((totals, column) =>
      totals.map((total, r) => total + (column.at(r) ?? 0)),
    );
    const populated = rowTotals.flatMap((n, r) => (n > 0 ? [r] : []));
    // Row r counts [valueEdges[r - 1], valueEdges[r]).
    expect(heatmap.valueEdges[populated.at(-1)! - 1]).toBeGreaterThan(1e8);
    expect(heatmap.valueEdges[populated[0]]).toBeLessThan(1e7);
  });

  it('rejects a granularity the time buckets cannot step by', async () => {
    const result = await callTool(client, 'clickstack_heatmap', {
      sourceId: traceSourceId,
      valueExpression: 'Duration',
      granularity: '1 week',
    });
    expect(result.isError).toBe(true);
  });

  it('coarsens a granularity that would flood the grid, and says so', async () => {
    const result = await callTool(client, 'clickstack_heatmap', {
      sourceId: traceSourceId,
      valueExpression: 'Duration',
      where,
      startTime: new Date(now - 24 * 60 * 60_000).toISOString(),
      endTime: new Date(now).toISOString(),
      granularity: '1 second',
    });
    const body: HeatmapBody = JSON.parse(getFirstText(result));
    expect(body.heatmap!.times.length).toBeLessThanOrEqual(48 * 4);
    expect(body.hints.join(' ')).toContain('Granularity "1 second" would make');
  });

  it('answers clickstack_query_tile for a saved distribution heatmap tile', async () => {
    const saved = await callTool(client, 'clickstack_save_dashboard', {
      name: 'Latency',
      tiles: [
        {
          name: 'Span latency',
          config: {
            displayType: 'heatmap',
            sourceId: traceSourceId,
            select: [{ valueExpression: 'Duration' }],
            where,
          },
        },
      ],
    });
    expect(saved.isError).toBeFalsy();
    const dashboard = JSON.parse(getFirstText(saved));

    const result = await callTool(client, 'clickstack_query_tile', {
      dashboardId: dashboard.id,
      tileId: dashboard.tiles[0].id,
      startTime: new Date(now - 10 * 60_000).toISOString(),
      endTime: new Date(now).toISOString(),
    });
    expect(result.isError).toBeFalsy();
    const body: HeatmapBody = JSON.parse(getFirstText(result));
    expect(body.heatmap!.counts.flat().reduce((a, b) => a + b, 0)).toBe(55);
  });

  it('rejects a non-trace source', async () => {
    const result = await callTool(client, 'clickstack_heatmap', {
      sourceId: logSourceId,
      valueExpression: 'Duration',
    });
    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toContain('need a trace source');
  });
});
