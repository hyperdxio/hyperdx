import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { ClickhouseClient } from '@/clickhouse';
import * as config from '@/config';
import {
  bulkInsertData,
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import type { KnowledgeTarget } from '@/knowledge/target';
import { isAnomalous, measureNodeDeltas } from '@/knowledge/topology/anomaly';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

describe('measureNodeDeltas', () => {
  const server = getServer();
  const client = new ClickhouseClient({
    host: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
  });

  beforeAll(async () => {
    await server.start();
  });
  afterEach(async () => {
    await client.command({
      query: `TRUNCATE TABLE ${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`,
    });
    await server.clearDBs();
  });
  afterAll(async () => {
    await server.stop();
  });

  const end = new Date();
  const start = new Date(end.getTime() - 10 * 60_000);
  const inWindow = new Date(end.getTime() - 5 * 60_000);
  const inBaseline = new Date(start.getTime() - 5 * 60_000);

  let n = 0;
  const span = (
    service: string,
    at: Date,
    o: {
      kind?: 'Server' | 'Client';
      error?: boolean | string;
      ms?: number;
      attrs?: Record<string, string>;
    } = {},
  ) => ({
    Timestamp: at,
    TraceId: `trace-anomaly-${n}`,
    SpanId: `a${n++}`,
    ParentSpanId: '',
    SpanName: 'op',
    SpanKind: o.kind ?? 'Server',
    ServiceName: service,
    Duration: (o.ms ?? 50) * 1_000_000,
    StatusCode:
      typeof o.error === 'string' ? o.error : o.error ? 'Error' : 'Ok',
    StatusMessage: '',
    SpanAttributes: o.attrs ?? {},
    ResourceAttributes: {},
  });

  async function setup(spans: ReturnType<typeof span>[]) {
    const { team } = await getLoggedInAgent(server);
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
      eventAttributesExpression: 'SpanAttributes',
    });
    if (spans.length > 0) {
      await bulkInsertData(
        `${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`,
        spans,
      );
    }
    const target: KnowledgeTarget = {
      client,
      database: DEFAULT_DATABASE,
      traceSource: traceSource.toObject(),
      sourceId: traceSource._id.toString(),
      teamId: team._id.toString(),
    };
    return target;
  }

  it('flags a service whose errors and latency rose against the baseline', async () => {
    const target = await setup([
      ...Array.from({ length: 10 }, () => span('checkout', inBaseline)),
      ...Array.from({ length: 10 }, (_, i) =>
        span('checkout', inWindow, { error: i < 3, ms: 500 }),
      ),
      ...Array.from({ length: 10 }, () => span('quiet', inBaseline)),
      ...Array.from({ length: 10 }, () => span('quiet', inWindow)),
      span('', inWindow),
      ...Array.from({ length: 4 }, () =>
        span('checkout', inWindow, {
          kind: 'Client',
          attrs: { 'db.system': 'postgresql', 'server.address': 'orders-db' },
        }),
      ),
    ]);

    const deltas = await measureNodeDeltas(target, [start, end]);

    const checkout = deltas.get('service:checkout')!;
    expect(checkout.errorRate).toBeCloseTo(0.3);
    expect(checkout.baselineErrorRate).toBe(0);
    expect(checkout.baselineRequests).toBe(10);
    expect(isAnomalous(checkout)).toBe(true);
    const quiet = deltas.get('service:quiet')!;
    expect(isAnomalous(quiet)).toBe(false);
    expect(quiet.p95Ms).toBeCloseTo(50);
    expect(deltas.get('datastore:postgresql:orders-db')).toMatchObject({
      requests: 4,
      baselineRequests: 0,
      baselineP95Ms: null,
    });
    expect(deltas.has('service:')).toBe(false);
  });

  it('counts legacy STATUS_CODE_ERROR spans as errors', async () => {
    const target = await setup([
      ...Array.from({ length: 4 }, (_, i) =>
        span('legacy', inWindow, {
          error: i < 2 ? 'STATUS_CODE_ERROR' : false,
        }),
      ),
    ]);
    const deltas = await measureNodeDeltas(target, [start, end]);
    expect(deltas.get('service:legacy')?.errorRate).toBeCloseTo(0.5);
  });

  it('returns an empty map for an empty window', async () => {
    const target = await setup([]);
    expect((await measureNodeDeltas(target, [start, end])).size).toBe(0);
  });
});
