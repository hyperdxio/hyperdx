import { scenarioTables } from '../clickhouse/schema';
import { QUERY_TIMEOUT_SECONDS } from '../harness/mcpConfig';
import { SCENARIO_NAMES } from '../scenarios';
import { HyperdxApiClient, type HyperdxSource } from './api';
import {
  configPath,
  type EvalConfig,
  readConfig as readEvalConfig,
  writeConfig,
} from './config';

const EVAL_CONNECTION_NAME = 'hdx-eval-clickhouse';
const TRACE_DEFAULT_SELECT =
  'Timestamp, ServiceName, SpanName, Duration, StatusCode';
const LOG_DEFAULT_SELECT = 'Timestamp, ServiceName, SeverityText, Body';

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

  // 4. Ensure one Trace Source + one Log Source per scenario.
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
    { tracesSourceId: string; logsSourceId: string }
  > = {};

  for (const name of SCENARIO_NAMES) {
    const tables = scenarioTables(name);
    const traceName = `eval-${name}-traces`;
    const logName = `eval-${name}-logs`;

    let traceSource = sourcesByName.get(traceName);
    if (!traceSource) {
      traceSource = await api.createSource(
        buildTraceSourceBody(traceName, connection._id, tables.traces),
      );
      created.push(traceName);
    }

    let logSource = sourcesByName.get(logName);
    if (!logSource) {
      logSource = await api.createSource(
        buildLogSourceBody(logName, connection._id, tables.logs),
      );
      created.push(logName);
    }

    scenarioIds[name] = {
      tracesSourceId: sourceId(traceSource),
      logsSourceId: sourceId(logSource),
    };
  }

  const config: EvalConfig = {
    hyperdx: {
      apiUrl: opts.apiUrl,
      mcpUrl: `${opts.apiUrl.replace(/\/$/, '')}/mcp`,
      accessKey: me.accessKey,
      connectionId: connection._id,
      scenarios: scenarioIds,
    },
    clickhouse: opts.clickhouse,
  };
  writeConfig(config);

  return {
    configPath: configPath(),
    config,
    created: { connection: createdConnection, sources: created },
  };
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
  };
}

function buildLogSourceBody(
  name: string,
  connectionId: string,
  tableName: string,
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
    mcpReachable = await apiBearerCheck(
      cfg.hyperdx.mcpUrl,
      cfg.hyperdx.accessKey,
    );
    if (!mcpReachable) {
      errors.push(
        `HyperDX MCP at ${cfg.hyperdx.mcpUrl} did not respond as expected`,
      );
    }
    try {
      const chUrl = `http://${cfg.clickhouse.host}:${cfg.clickhouse.port}/ping`;
      const res = await fetch(chUrl);
      chReachable = res.ok;
      if (!chReachable) errors.push(`ClickHouse ping → ${res.status}`);
    } catch (e) {
      errors.push(
        `ClickHouse not reachable: ${e instanceof Error ? e.message : e}`,
      );
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
