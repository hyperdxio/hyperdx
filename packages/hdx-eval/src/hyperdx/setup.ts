import { createEvalClient } from '@/clickhouse/client';
import { METRIC_SOURCE_TABLES, scenarioTables } from '@/clickhouse/schema';
import { QUERY_TIMEOUT_SECONDS } from '@/harness/mcpConfig';
import type { McpDefinition } from '@/harness/types';
import { SCENARIO_NAMES } from '@/scenarios';

import { HyperdxApiClient, type HyperdxSource } from './api';
import {
  configPath,
  type EvalConfig,
  readConfig as readEvalConfig,
  writeConfig,
} from './config';

const EVAL_CONNECTION_NAME = 'hdx-eval-clickhouse';
const NOMETRICS_CH_USER = 'hdx_eval_nometrics';
const NOMETRICS_CH_PASSWORD = 'hdx_eval_nometrics';
const NOMETRICS_CONNECTION_NAME = 'hdx-eval-clickhouse-nometrics';
const TRACE_DEFAULT_SELECT =
  'Timestamp, ServiceName, SpanName, Duration, StatusCode';
const LOG_DEFAULT_SELECT = 'Timestamp, ServiceName, SeverityText, Body';

/**
 * ClickHouse DDL for the restricted user backing the `hdx-nometrics` arm.
 *
 * Denying the metric MCP tools client-side is not enough: `clickstack_sql`
 * runs raw SQL with the team Connection's stored ClickHouse credentials, so
 * the no-metrics arm could still read `eval_*_otel_metrics_*` tables. This
 * user gets a wildcard SELECT grant on `default` with SELECT explicitly
 * revoked on every metric table — each scenario's `eval_*_otel_metrics_*`
 * set plus the base `otel_metrics_*` tables (partial revoke). Grants are
 * name-based, so the statements are idempotent and work before tables exist.
 */
export function nometricsGrantStatements(
  user: string = NOMETRICS_CH_USER,
  password: string = NOMETRICS_CH_PASSWORD,
): string[] {
  const statements = [
    `CREATE USER IF NOT EXISTS ${user} IDENTIFIED WITH plaintext_password BY '${password}'`,
    `GRANT SELECT ON default.* TO ${user}`,
  ];
  const metricTables = [
    ...METRIC_SOURCE_TABLES,
    ...SCENARIO_NAMES.flatMap(name => {
      const tables = scenarioTables(name);
      return [
        tables.metricsGauge,
        tables.metricsSum,
        tables.metricsHistogram,
        tables.metricsExponentialHistogram,
        tables.metricsSummary,
      ];
    }),
  ];
  for (const table of metricTables) {
    statements.push(`REVOKE SELECT ON default.${table} FROM ${user}`);
  }
  return statements;
}

export type SetupOptions = {
  apiUrl: string;
  email: string;
  password: string;
  clickhouse: {
    host: string;
    port: string;
    user: string;
    password: string;
  };
  resetSources?: boolean;
};

export type SetupResult = {
  configPath: string;
  config: EvalConfig;
  created: { connection: boolean; sources: string[] };
  /** Whether the optional `hdx-nometrics` arm was provisioned. */
  nometrics: { ready: boolean };
};

export async function runSetup(opts: SetupOptions): Promise<SetupResult> {
  const api = new HyperdxApiClient(opts.apiUrl);

  // 1. Register (idempotent — accepts "already exists") then login.
  await api.register(opts.email, opts.password);
  await api.login(opts.email, opts.password);

  // 2. Fetch user accessKey for MCP Bearer auth.
  const me = await api.me();

  // 3. Ensure eval Connection exists pointing at the local ClickHouse.
  const connections = await api.listConnections();
  const chHost = `http://${opts.clickhouse.host}:${opts.clickhouse.port}`;
  let connection = connections.find(c => c.name === EVAL_CONNECTION_NAME);
  let createdConnection = false;
  if (!connection) {
    const { id } = await api.createConnection({
      name: EVAL_CONNECTION_NAME,
      host: chHost,
      username: opts.clickhouse.user,
      password: opts.clickhouse.password,
    });
    connection = {
      _id: id,
      name: EVAL_CONNECTION_NAME,
      host: chHost,
      username: opts.clickhouse.user,
    };
    createdConnection = true;
  }

  // 4. Ensure one Trace + Log + Metric Source per scenario.
  const { scenarioIds, created } = await ensureScenarioSources(
    api,
    connection._id,
    { resetSources: opts.resetSources ?? false },
  );

  const mcpUrl = `${opts.apiUrl.replace(/\/$/, '')}/mcp`;

  const hyperdxMcp: McpDefinition = {
    type: 'http',
    url: mcpUrl,
    headers: { Authorization: `Bearer ${me.accessKey}` },
    toolPattern: 'mcp__hyperdx__*',
    label: 'HyperDX',
    brandTerms: ['HyperDX', 'hyperdx'],
    deniedTools: deniedFor('hyperdx'),
  };

  // 5. Provision the `hdx-nometrics` arm: same team, same MCP, but the
  // harness routes it through a scoping proxy (`src/harness/scoping.ts`)
  // that hides metric sources and pins clickstack_sql to a Connection
  // backed by a restricted ClickHouse user that cannot SELECT the metric
  // tables (closes the raw-SQL loophole). Best-effort — base setup must
  // still succeed if this fails.
  let nometricsReady = false;
  let nometricsMcp: McpDefinition | undefined;
  try {
    // Restricted ClickHouse user. Idempotent DDL; requires access management
    // on the admin user (the dev ch-server container enables it).
    const chClient = createEvalClient({
      url: chHost,
      username: opts.clickhouse.user,
      password: opts.clickhouse.password,
    });
    try {
      for (const query of nometricsGrantStatements()) {
        await chClient.command({ query });
      }
    } finally {
      await chClient.close();
    }

    // Restricted-user Connection on the same team — the scoping proxy
    // rewrites every clickstack_sql call to run through it.
    let restricted = connections.find(
      c => c.name === NOMETRICS_CONNECTION_NAME,
    );
    if (!restricted) {
      const { id } = await api.createConnection({
        name: NOMETRICS_CONNECTION_NAME,
        host: chHost,
        username: NOMETRICS_CH_USER,
        password: NOMETRICS_CH_PASSWORD,
      });
      restricted = {
        _id: id,
        name: NOMETRICS_CONNECTION_NAME,
        host: chHost,
        username: NOMETRICS_CH_USER,
      };
    }

    nometricsMcp = {
      type: 'http',
      url: mcpUrl,
      headers: { Authorization: `Bearer ${me.accessKey}` },
      toolPattern: 'mcp__hdx-nometrics__*',
      label: 'HyperDX (no metrics)',
      brandTerms: ['HyperDX', 'hyperdx'],
      deniedTools: deniedFor('hdx-nometrics', METRIC_TOOLS),
      metricsAvailable: false,
      enabled: false,
      scoping: {
        hideSourceKinds: ['metric'],
        pinSqlConnectionId: restricted._id,
      },
    };
    nometricsReady = true;
  } catch (e) {
    console.warn(
      `WARN: could not provision the hdx-nometrics arm (${
        e instanceof Error ? e.message : e
      }). Ensure the dev ClickHouse container (ch-server) is running, ` +
        `then re-run setup-hyperdx.`,
    );
  }

  const clickhouseMcp: McpDefinition = {
    type: 'stdio',
    command: 'uv',
    args: [
      'run',
      '--with',
      'mcp-clickhouse==0.3.0',
      '--python',
      '3.10',
      'mcp-clickhouse',
    ],
    env: {
      CLICKHOUSE_HOST: opts.clickhouse.host,
      CLICKHOUSE_PORT: opts.clickhouse.port,
      CLICKHOUSE_USER: opts.clickhouse.user,
      CLICKHOUSE_PASSWORD: opts.clickhouse.password,
      CLICKHOUSE_SECURE: 'false',
      CLICKHOUSE_VERIFY: 'false',
      CLICKHOUSE_SEND_RECEIVE_TIMEOUT: String(QUERY_TIMEOUT_SECONDS),
    },
    toolPattern: 'mcp__clickhouse__*',
    label: 'ClickHouse MCP',
    brandTerms: ['ClickHouse MCP', 'clickhouse'],
  };

  const config: EvalConfig = {
    mcps: {
      hyperdx: hyperdxMcp,
      ...(nometricsMcp ? { 'hdx-nometrics': nometricsMcp } : {}),
      clickhouse: clickhouseMcp,
    },
    scenarios: scenarioIds,
    hyperdxApi: {
      apiUrl: opts.apiUrl,
      accessKey: me.accessKey,
      connectionId: connection._id,
    },
    clickhouse: opts.clickhouse,
  };
  writeConfig(config);

  return {
    configPath: configPath(),
    config,
    created: { connection: createdConnection, sources: created },
    nometrics: { ready: nometricsReady },
  };
}

// MCP tools denied for every HyperDX-flavored arm — dashboard/alert/saved
// search management is out of scope for investigation evals.
const BASE_DENIED_TOOLS = [
  'clickstack_delete_dashboard',
  'clickstack_get_dashboard',
  'clickstack_get_dashboard_tile',
  'clickstack_save_dashboard',
  'clickstack_patch_dashboard',
  'clickstack_search_dashboards',
  'clickstack_query_tile',
  'clickstack_get_saved_search',
  'clickstack_save_saved_search',
  'clickstack_get_alert',
  'clickstack_get_webhook',
  'clickstack_save_alert',
];
const METRIC_TOOLS = ['clickstack_list_metrics', 'clickstack_describe_metric'];

function deniedFor(key: string, extra: string[] = []): string[] {
  return [...BASE_DENIED_TOOLS, ...extra].map(t => `mcp__${key}__${t}`);
}

/**
 * Ensure the per-scenario Sources exist on the team behind `api`: a Trace,
 * Log, and Metric Source per scenario. With `resetSources`, deletes all
 * `eval-*` Sources first.
 */
async function ensureScenarioSources(
  api: HyperdxApiClient,
  connectionId: string,
  opts: { resetSources: boolean },
): Promise<{
  scenarioIds: Record<
    string,
    { tracesSourceId: string; logsSourceId: string; metricsSourceId: string }
  >;
  created: string[];
}> {
  let sources = await api.listSources();
  if (opts.resetSources) {
    const evalSources = sources.filter(s => s.name.startsWith('eval-'));
    for (const s of evalSources) {
      await api.deleteSource(sourceId(s));
    }
    sources = await api.listSources();
  }
  const sourcesByName = new Map(sources.map(s => [s.name, s]));
  const created: string[] = [];
  const scenarioIds: Record<
    string,
    { tracesSourceId: string; logsSourceId: string; metricsSourceId: string }
  > = {};

  for (const name of SCENARIO_NAMES) {
    const tables = scenarioTables(name);
    const traceName = `eval-${name}-traces`;
    const logName = `eval-${name}-logs`;
    const metricName = `eval-${name}-metrics`;

    let traceSource = sourcesByName.get(traceName);
    if (!traceSource) {
      traceSource = await api.createSource(
        buildTraceSourceBody(traceName, connectionId, tables.traces, {
          kvRollupTable: tables.tracesKvRollup,
          keyRollupTable: tables.tracesKeyRollup,
        }),
      );
      created.push(traceName);
    }

    let logSource = sourcesByName.get(logName);
    if (!logSource) {
      logSource = await api.createSource(
        buildLogSourceBody(logName, connectionId, tables.logs, {
          kvRollupTable: tables.logsKvRollup,
          keyRollupTable: tables.logsKeyRollup,
        }),
      );
      created.push(logName);
    }

    let metricSource = sourcesByName.get(metricName);
    if (!metricSource) {
      metricSource = await api.createSource(
        buildMetricSourceBody(
          metricName,
          connectionId,
          {
            gauge: tables.metricsGauge,
            sum: tables.metricsSum,
            histogram: tables.metricsHistogram,
            exponentialHistogram: tables.metricsExponentialHistogram,
            summary: tables.metricsSummary,
          },
          sourceId(logSource),
        ),
      );
      created.push(metricName);
    }

    scenarioIds[name] = {
      tracesSourceId: sourceId(traceSource),
      logsSourceId: sourceId(logSource),
      metricsSourceId: sourceId(metricSource),
    };
  }

  return { scenarioIds, created };
}

function sourceId(source: HyperdxSource): string {
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

export type CheckResult = {
  configOk: boolean;
  mcpReachable: boolean;
  clickhouseReachable: boolean;
  uvAvailable: boolean;
  errors: string[];
};

export async function runCheck(
  apiBearerCheck: (
    mcpUrl: string,
    accessKey: string,
  ) => Promise<boolean> = defaultMcpCheck,
  uvCheck: () => Promise<boolean> = defaultUvCheck,
): Promise<CheckResult> {
  const errors: string[] = [];
  let configOk = false;
  let cfg: EvalConfig | null = null;
  try {
    cfg = readEvalConfig();
    configOk = true;
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  let mcpReachable = false;
  let chReachable = false;
  if (cfg) {
    // Probe every http-type MCP (e.g. both the `hyperdx` and
    // `hdx-nometrics` arms) so --check validates each access key.
    const httpMcps = Object.entries(cfg.mcps).filter(
      (entry): entry is [string, Extract<McpDefinition, { type: 'http' }>] =>
        entry[1].type === 'http',
    );
    mcpReachable = httpMcps.length > 0;
    for (const [name, def] of httpMcps) {
      const authHeader = def.headers?.Authorization;
      if (!authHeader) {
        mcpReachable = false;
        errors.push(`mcps.${name}: missing Authorization header`);
        continue;
      }
      const accessKey = authHeader.replace('Bearer ', '');
      const ok = await apiBearerCheck(def.url, accessKey);
      if (!ok) {
        mcpReachable = false;
        errors.push(`mcps.${name}: MCP unreachable at ${def.url}`);
      }
    }
    if (cfg.clickhouse) {
      try {
        const chUrl = `http://${cfg.clickhouse.host}:${cfg.clickhouse.port}/ping`;
        const res = await fetch(chUrl, {
          signal: AbortSignal.timeout(10_000),
        });
        chReachable = res.ok;
        if (!chReachable) errors.push(`ClickHouse ping → ${res.status}`);
      } catch (e) {
        errors.push(
          `ClickHouse not reachable: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }

  const uvAvailable = await uvCheck();
  if (!uvAvailable) {
    errors.push(
      `\`uv\` not found on PATH. Install via \`brew install uv\` or follow https://docs.astral.sh/uv/`,
    );
  }

  return {
    configOk,
    mcpReachable,
    clickhouseReachable: chReachable,
    uvAvailable,
    errors,
  };
}

async function defaultMcpCheck(
  mcpUrl: string,
  accessKey: string,
): Promise<boolean> {
  try {
    // The MCP HTTP transport responds to a GET with 405 (method not allowed)
    // when not given a JSON-RPC body, but it must accept the bearer token.
    // POST a minimal initialize message instead.
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'hdx-eval-check', version: '0.1.0' },
        },
      }),
    });
    return res.ok || res.status === 200 || res.status === 202;
  } catch {
    return false;
  }
}

async function defaultUvCheck(): Promise<boolean> {
  const { spawn } = await import('child_process');
  return new Promise(resolve => {
    const proc = spawn('uv', ['--version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('exit', code => resolve(code === 0));
  });
}
