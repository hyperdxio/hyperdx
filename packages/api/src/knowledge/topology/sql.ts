import type { ChSql } from '@hyperdx/common-utils/dist/clickhouse';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  SourceKind,
  type TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import SqlString from 'sqlstring';

import type { KnowledgeTarget } from '@/knowledge/target';

const SERVER_KINDS = `('Server', 'Consumer', 'SPAN_KIND_SERVER', 'SPAN_KIND_CONSUMER')`;
const CLIENT_KINDS = `('Client', 'Producer', 'SPAN_KIND_CLIENT', 'SPAN_KIND_PRODUCER')`;

export const TOPOLOGY_WINDOW_MS = 6 * 60 * 60 * 1000;

const attrKeys = ['db.system', 'server.address', 'net.peer.name', 'db.name'];

export function traceSourceOf(target: KnowledgeTarget): TTraceSource {
  const source = target.traceSource;
  if (source.kind !== SourceKind.Trace) {
    throw new Error('Knowledge target source is not a trace source');
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed by kind above; ISource only widens team and connection
  return source as unknown as TTraceSource;
}

// p95 in ms of a duration column; precision 9 is ns, unset means ms. Optional cond restricts the rows.
export const p95MsSql = (source: TTraceSource, col: string, cond?: string) =>
  source.durationExpression
    ? `${cond ? `quantileIf(0.95)(${col}, ${cond})` : `quantile(0.95)(${col})`} * ${10 ** (3 - (source.durationPrecision ?? 3))}`
    : '0';

// Datastore attribute columns read from ClientSpans, aliased a0..a3, and the
// filter keeping client spans that carry db.system.
export function datastoreColumns(source: TTraceSource) {
  const cols = attrKeys.map(k =>
    source.eventAttributesExpression
      ? `toString(ClientSpans.attrs[${SqlString.escape(k)}])`
      : `''`,
  );
  return {
    select: cols.map((c, i) => `${c} AS a${i}`).join(', '),
    empty: attrKeys.map((_, i) => `'' AS a${i}`).join(', '),
    filter: source.eventAttributesExpression ? `${cols[0]} != ''` : '0',
  };
}

// Server and client span CTE bodies with the source's configured columns.
export async function renderSpanCtes(
  target: KnowledgeTarget,
  dateRange: [Date, Date],
  opts: { withTimestamp?: boolean } = {},
): Promise<[ChSql, ChSql]> {
  const source = traceSourceOf(target);
  const metadata = getMetadata(target.client);
  const attrs = source.eventAttributesExpression;
  const base = {
    from: source.from,
    connection: source.connection,
    dateRange,
    timestampValueExpression: source.timestampValueExpression,
    ...(source.implicitColumnExpression != null
      ? { implicitColumnExpression: source.implicitColumnExpression }
      : {}),
    where: '',
    whereLanguage: 'lucene' as const,
    select: [
      {
        valueExpression: source.traceIdExpression ?? 'TraceId',
        alias: 'traceId',
      },
      { valueExpression: source.spanIdExpression ?? 'SpanId', alias: 'spanId' },
      {
        valueExpression: source.serviceNameExpression ?? 'ServiceName',
        alias: 'serviceName',
      },
      {
        valueExpression: source.parentSpanIdExpression ?? 'ParentSpanId',
        alias: 'parentSpanId',
      },
      {
        valueExpression: source.statusCodeExpression ?? 'StatusCode',
        alias: 'statusCode',
      },
      ...(source.durationExpression
        ? [{ valueExpression: source.durationExpression, alias: 'duration' }]
        : []),
      ...(attrs ? [{ valueExpression: attrs, alias: 'attrs' }] : []),
      ...(opts.withTimestamp
        ? [{ valueExpression: source.timestampValueExpression, alias: 'ts' }]
        : []),
    ],
  };
  const withKind = (kinds: string) => ({
    ...base,
    filters: [
      {
        type: 'sql' as const,
        condition: `${source.spanKindExpression} IN ${kinds}`,
      },
    ],
  });
  return Promise.all([
    renderChartConfig(withKind(SERVER_KINDS), metadata, source.querySettings),
    renderChartConfig(withKind(CLIENT_KINDS), metadata, source.querySettings),
  ]);
}
