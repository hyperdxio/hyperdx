import { QUERY_TIMEOUT_SECONDS } from '@/harness/mcpConfig';
import type { McpDefinition } from '@/harness/types';
import { SCENARIO_NAMES } from '@/scenarios';
import { SMOKEHOUSE_PREFIX } from '@/scenarios/smokehouse/shared';

import { HyperdxApiClient } from './api';
import {
  configPath,
  type EvalConfig,
  readConfig as readEvalConfig,
  writeConfig,
} from './config';
import { ensureScenarioSources, sourceId } from './sources';

const EVAL_CONNECTION_NAME = 'hdx-eval-clickhouse';

/** Smokehouse runs create their own sources (pinScenario), so 80 scenarios do not add 240 sources here. */
export const SETUP_SCENARIO_NAMES = SCENARIO_NAMES.filter(
  n => !n.startsWith(SMOKEHOUSE_PREFIX),
);

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

  // 4. Ensure trace, log and metric Sources per scenario.
  let sources = await api.listSources();
  if (opts.resetSources) {
    const evalSources = sources.filter(s => s.name.startsWith('eval-'));
    for (const s of evalSources) {
      await api.deleteSource(sourceId(s));
    }
    sources = await api.listSources();
  }
  const created: string[] = [];
  const scenarioIds: NonNullable<EvalConfig['scenarios']> = {};
  for (const name of SETUP_SCENARIO_NAMES) {
    const r = await ensureScenarioSources(api, name, connection._id, sources);
    created.push(...r.created);
    scenarioIds[name] = r.ids;
  }

  const mcpUrl = `${opts.apiUrl.replace(/\/$/, '')}/mcp`;

  const hyperdxMcp: McpDefinition = {
    type: 'http',
    url: mcpUrl,
    headers: { Authorization: `Bearer ${me.accessKey}` },
    toolPattern: 'mcp__hyperdx__*',
    label: 'HyperDX',
    brandTerms: ['HyperDX', 'hyperdx'],
    deniedTools: [
      'mcp__hyperdx__clickstack_delete_dashboard',
      'mcp__hyperdx__clickstack_get_dashboard',
      'mcp__hyperdx__clickstack_get_dashboard_tile',
      'mcp__hyperdx__clickstack_save_dashboard',
      'mcp__hyperdx__clickstack_patch_dashboard',
      'mcp__hyperdx__clickstack_search_dashboards',
      'mcp__hyperdx__clickstack_query_tile',
      'mcp__hyperdx__clickstack_get_saved_search',
      'mcp__hyperdx__clickstack_save_saved_search',
      'mcp__hyperdx__clickstack_get_alert',
      'mcp__hyperdx__clickstack_get_webhook',
      'mcp__hyperdx__clickstack_save_alert',
      'mcp__hyperdx__clickstack_save_webhook',
      'mcp__hyperdx__clickstack_delete_webhook',
      'mcp__hyperdx__clickstack_save_source',
      'mcp__hyperdx__clickstack_delete_source',
    ],
  };

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
    // Check the HyperDX MCP if there's an http-type MCP in the config.
    const httpMcp = Object.values(cfg.mcps).find(m => m.type === 'http');
    if (httpMcp && httpMcp.type === 'http') {
      const accessKey =
        httpMcp.headers?.Authorization?.replace('Bearer ', '') ?? '';
      mcpReachable = await apiBearerCheck(httpMcp.url, accessKey);
      if (!mcpReachable) {
        errors.push(
          `HyperDX MCP at ${httpMcp.url} did not respond as expected`,
        );
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
