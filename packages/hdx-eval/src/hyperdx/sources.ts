import { publicScenarioName, scenarioTables } from '@/clickhouse/schema';
import { QUERY_TIMEOUT_SECONDS } from '@/harness/mcpConfig';

import type { HyperdxApiClient, HyperdxSource } from './api';

const TRACE_DEFAULT_SELECT =
  'Timestamp, ServiceName, SpanName, Duration, StatusCode';
const LOG_DEFAULT_SELECT = 'Timestamp, ServiceName, SeverityText, Body';

export type ScenarioSourceIds = {
  tracesSourceId: string;
  logsSourceId: string;
  metricsSourceId: string;
};

function sourceNames(scenario: string) {
  const n = publicScenarioName(scenario);
  return {
    traces: `eval-${n}-traces`,
    logs: `eval-${n}-logs`,
    metrics: `eval-${n}-metrics`,
  };
}

/** Creates whichever of the scenario's trace, log and metric sources are missing from `existing`. */
export async function ensureScenarioSources(
  api: { createSource(body: Record<string, unknown>): Promise<HyperdxSource> },
  scenario: string,
  connectionId: string,
  existing: HyperdxSource[],
): Promise<{ ids: ScenarioSourceIds; created: string[] }> {
  const tables = scenarioTables(scenario);
  const names = sourceNames(scenario);
  const created: string[] = [];
  const ensure = async (name: string, body: () => Record<string, unknown>) => {
    const found = existing.find(s => s.name === name);
    if (found) return found;
    created.push(name);
    return api.createSource(body());
  };

  const trace = await ensure(names.traces, () =>
    buildTraceSourceBody(names.traces, connectionId, tables.traces, {
      kvRollupTable: tables.tracesKvRollup,
      keyRollupTable: tables.tracesKeyRollup,
    }),
  );
  const log = await ensure(names.logs, () =>
    buildLogSourceBody(names.logs, connectionId, tables.logs, {
      kvRollupTable: tables.logsKvRollup,
      keyRollupTable: tables.logsKeyRollup,
    }),
  );
  const metric = await ensure(names.metrics, () =>
    buildMetricSourceBody(
      names.metrics,
      connectionId,
      {
        gauge: tables.metricsGauge,
        sum: tables.metricsSum,
        histogram: tables.metricsHistogram,
        exponentialHistogram: tables.metricsExponentialHistogram,
        summary: tables.metricsSummary,
      },
      sourceId(log),
    ),
  );
  return {
    ids: {
      tracesSourceId: sourceId(trace),
      logsSourceId: sourceId(log),
      metricsSourceId: sourceId(metric),
    },
    created,
  };
}

/**
 * Creates the scenario's sources and makes its trace source the team's knowledge graph source,
 * so knowledge tools and memory calls never depend on which other sources exist.
 */
export async function pinScenario(
  api: HyperdxApiClient,
  scenario: string,
  connectionId: string,
  includeUnconfirmed: boolean,
): Promise<void> {
  const { ids } = await ensureScenarioSources(
    { createSource: b => api.createSourceV2(b) },
    scenario,
    connectionId,
    await api.listSourcesV2(),
  );
  await api.putKnowledgeSettings({
    traceSourceId: ids.tracesSourceId,
    includeUnconfirmed,
  });
}

/** Undoes pinScenario. The metric source goes first because it references the log source. */
export async function unpinScenario(
  api: HyperdxApiClient,
  scenario: string,
): Promise<void> {
  await api.putKnowledgeSettings({
    traceSourceId: null,
    includeUnconfirmed: false,
  });
  const names = sourceNames(scenario);
  const sources = await api.listSourcesV2();
  for (const name of [names.metrics, names.logs, names.traces]) {
    const s = sources.find(x => x.name === name);
    if (s) await api.deleteSourceV2(sourceId(s));
  }
}

export function sourceId(source: HyperdxSource): string {
  return source.id ?? source._id;
}

// Apply a per-query max_execution_time to every Source so the HyperDX MCP
// faces the same query timeout as the ClickHouse MCP. Simulates a busy
// production cluster where queries that scan everything time out.
const EVAL_QUERY_SETTINGS = [
  { setting: 'max_execution_time', value: String(QUERY_TIMEOUT_SECONDS) },
];

function buildTraceSourceBody(
  name: string,
  connectionId: string,
  tableName: string,
  rollup: { kvRollupTable: string; keyRollupTable: string },
): Record<string, unknown> {
  return {
    name,
    kind: 'trace',
    connection: connectionId,
    from: { databaseName: 'default', tableName },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: TRACE_DEFAULT_SELECT,
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    statusCodeExpression: 'StatusCode',
    statusMessageExpression: 'StatusMessage',
    serviceNameExpression: 'ServiceName',
    resourceAttributesExpression: 'ResourceAttributes',
    eventAttributesExpression: 'SpanAttributes',
    implicitColumnExpression: 'SpanName',
    querySettings: EVAL_QUERY_SETTINGS,
    metadataMaterializedViews: {
      keyRollupTable: rollup.keyRollupTable,
      kvRollupTable: rollup.kvRollupTable,
      granularity: '15 minute',
    },
  };
}

function buildMetricSourceBody(
  name: string,
  connectionId: string,
  metricTables: {
    gauge: string;
    sum: string;
    histogram: string;
    exponentialHistogram: string;
    summary: string;
  },
  logSourceId: string,
): Record<string, unknown> {
  return {
    name,
    kind: 'metric',
    connection: connectionId,
    from: { databaseName: 'default', tableName: '' },
    timestampValueExpression: 'TimeUnix',
    serviceNameExpression: 'ServiceName',
    resourceAttributesExpression: 'ResourceAttributes',
    metricTables: {
      gauge: metricTables.gauge,
      sum: metricTables.sum,
      histogram: metricTables.histogram,
      'exponential histogram': metricTables.exponentialHistogram,
      summary: metricTables.summary,
    },
    logSourceId,
    querySettings: EVAL_QUERY_SETTINGS,
  };
}

function buildLogSourceBody(
  name: string,
  connectionId: string,
  tableName: string,
  rollup: { kvRollupTable: string; keyRollupTable: string },
): Record<string, unknown> {
  return {
    name,
    kind: 'log',
    connection: connectionId,
    from: { databaseName: 'default', tableName },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: LOG_DEFAULT_SELECT,
    serviceNameExpression: 'ServiceName',
    severityTextExpression: 'SeverityText',
    bodyExpression: 'Body',
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    resourceAttributesExpression: 'ResourceAttributes',
    eventAttributesExpression: 'LogAttributes',
    implicitColumnExpression: 'Body',
    querySettings: EVAL_QUERY_SETTINGS,
    metadataMaterializedViews: {
      keyRollupTable: rollup.keyRollupTable,
      kvRollupTable: rollup.kvRollupTable,
      granularity: '15 minute',
    },
  };
}
