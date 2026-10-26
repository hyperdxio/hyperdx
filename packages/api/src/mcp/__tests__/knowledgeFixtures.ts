import { SourceKind } from '@hyperdx/common-utils/dist/types';

import * as config from '@/config';
import {
  bulkInsertData,
  DEFAULT_DATABASE,
  DEFAULT_TRACES_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

import { createTestClient, getFirstText } from './mcpTestUtils';

export const now = Date.now();
export const startTime = new Date(now - 10 * 60_000).toISOString();
export const endTime = new Date(now + 60_000).toISOString();
const dbAttrs = { 'db.system': 'postgresql', 'server.address': 'orders-db' };

let n = 0;
const span = (
  service: string,
  kind: 'Server' | 'Client',
  o: {
    at?: number;
    parent?: string;
    id?: string;
    traceId?: string;
    error?: boolean;
    ms?: number;
    attrs?: Record<string, string>;
  } = {},
) => ({
  Timestamp: new Date(o.at ?? now),
  TraceId: o.traceId ?? `trace-mcp-kg-${n}`,
  SpanId: o.id ?? `k${n++}`,
  ParentSpanId: o.parent ?? '',
  SpanName: 'op',
  SpanKind: kind,
  ServiceName: service,
  Duration: (o.ms ?? 50) * 1_000_000,
  StatusCode: o.error ? 'Error' : 'Ok',
  StatusMessage: '',
  SpanAttributes: o.attrs ?? {},
  ResourceAttributes: {},
});
type Span = ReturnType<typeof span>;

// edge-gateway calls checkout, which calls orders-db; at shifts every span.
export const topologyTrace = (at = now) => {
  const traceId = `trace-mcp-topo-${at}`;
  return [
    span('edge-gateway', 'Server', { id: 't0', traceId, at }),
    span('edge-gateway', 'Client', { id: 't1', parent: 't0', traceId, at }),
    span('checkout', 'Server', { id: 't2', parent: 't1', traceId, at }),
    span('checkout', 'Client', {
      id: 't3',
      parent: 't2',
      traceId,
      at,
      attrs: dbAttrs,
    }),
  ];
};
export const baseline = (at = now - 15 * 60_000) =>
  Array.from({ length: 10 }, () =>
    span('checkout', 'Client', { at, attrs: dbAttrs }),
  );
export const failingDb = (at = now) =>
  Array.from({ length: 10 }, () =>
    span('checkout', 'Client', { at, error: true, ms: 900, attrs: dbAttrs }),
  );

export const json = (r: Parameters<typeof getFirstText>[0]) =>
  JSON.parse(getFirstText(r));

// A team with the flag on in the MCP context and zero, one or two trace sources.
export async function setupKnowledgeClient(
  server: ReturnType<typeof getServer>,
  spans: Span[],
  sources: 0 | 1 | 2 = 1,
) {
  const { team } = await getLoggedInAgent(server);
  if (sources > 0) {
    const connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    for (let i = 0; i < sources; i++)
      await Source.create({
        kind: SourceKind.Trace,
        team: team._id,
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_TRACES_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        connection: connection._id,
        name: `Traces ${i}`,
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
    if (spans.length > 0)
      await bulkInsertData(
        `${DEFAULT_DATABASE}.${DEFAULT_TRACES_TABLE}`,
        spans,
      );
  }
  // Flag passed in the MCP context; the Mongo flag is covered in app.test.ts.
  const client = await createTestClient({
    teamId: team._id.toString(),
    userId: 'user-id',
    isKnowledgeGraphEnabled: true,
  });
  return { client, team };
}
