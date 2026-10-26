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
import { ensureKnowledgeTables, KG_TABLES } from '@/knowledge/tables';
import type { KnowledgeTarget } from '@/knowledge/target';
import {
  refreshTopology,
  refreshTopologyIfStale,
  topologyAgeMs,
} from '@/knowledge/topology/refresh';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

describe('refreshTopology', () => {
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

  const span = (
    n: number,
    service: string,
    kind: 'Server' | 'Client',
    parent: string,
    attrs: Record<string, string> = {},
    traceId = 'trace-topology-1',
    status = 'Ok',
  ) => ({
    Timestamp: new Date(),
    TraceId: traceId,
    SpanId: `s${n}`,
    ParentSpanId: parent,
    SpanName: 'op',
    SpanKind: kind,
    ServiceName: service,
    Duration: 5_000_000,
    StatusCode: status,
    StatusMessage: '',
    SpanAttributes: attrs,
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
    await bulkInsertData(`${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`, spans);
    await ensureKnowledgeTables(client, DEFAULT_DATABASE);
    const teamId = team._id.toString();
    const target: KnowledgeTarget = {
      client,
      database: DEFAULT_DATABASE,
      traceSource: traceSource.toObject(),
      sourceId: traceSource._id.toString(),
      teamId,
    };
    return target;
  }

  async function readEdges(target: KnowledgeTarget) {
    const res = await client.query({
      query: `SELECT src, dst, request_count, error_count, source_id FROM ${DEFAULT_DATABASE}.${KG_TABLES.edges} FINAL WHERE team_id = {t:String}`,
      query_params: { t: target.teamId },
      format: 'JSON',
    });
    return (
      await res.json<{
        src: string;
        dst: string;
        request_count: string;
        error_count: string;
        source_id: string;
      }>()
    ).data;
  }

  it('writes service and datastore edges, including quoted names', async () => {
    const target = await setup([
      span(1, 'edge-gateway', 'Client', ''),
      span(2, 'checkout', 'Server', 's1'),
      span(3, "o'reilly-svc", 'Client', ''),
      span(4, 'checkout', 'Server', 's3'),
      span(5, 'checkout', 'Client', 's2', {
        'db.system': 'postgresql',
        'server.address': 'orders-db',
      }),
    ]);

    await refreshTopology(target);

    const edges = await readEdges(target);
    const has = (src: string, dst: string) =>
      edges.some(e => e.src === src && e.dst === dst && +e.request_count >= 1);
    expect(has('service:edge-gateway', 'service:checkout')).toBe(true);
    expect(has('service:checkout', 'datastore:postgresql:orders-db')).toBe(
      true,
    );
    expect(has("service:o'reilly-svc", 'service:checkout')).toBe(true);
    expect(edges.every(e => e.source_id === target.sourceId)).toBe(true);
    expect(await topologyAgeMs(target)).toBeLessThan(60_000);
    expect(await topologyAgeMs({ ...target, sourceId: 'other' })).toBeNull();
  });

  it('counts legacy STATUS_CODE_ERROR spans as errors', async () => {
    const t = 'trace-topology-3';
    const target = await setup([
      span(1, 'edge-gateway', 'Client', '', {}, t),
      span(2, 'checkout', 'Server', 's1', {}, t, 'STATUS_CODE_ERROR'),
      span(3, 'checkout', 'Client', 's2', { 'db.system': 'redis' }, t, 'Error'),
    ]);

    await refreshTopology(target);

    const errors = Object.fromEntries(
      (await readEdges(target)).map(e => [`${e.src}>${e.dst}`, +e.error_count]),
    );
    expect(errors).toEqual({
      'service:edge-gateway>service:checkout': 1,
      'service:checkout>datastore:redis:unknown': 1,
    });
  });

  it('skips same-service and unnamed pairs, and does not re-query after an empty refresh', async () => {
    const target = await setup([
      span(1, 'checkout', 'Client', '', {}, 'trace-topology-2'),
      span(2, 'checkout', 'Server', 's1', {}, 'trace-topology-2'),
      span(3, '', 'Client', '', {}, 'trace-topology-2'),
      span(4, 'checkout', 'Server', 's3', {}, 'trace-topology-2'),
    ]);

    expect(await refreshTopology(target)).toEqual({ nodes: 0, edges: 0 });
    expect(await readEdges(target)).toEqual([]);

    const spy = jest.spyOn(client, 'query');
    await refreshTopologyIfStale(target);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
