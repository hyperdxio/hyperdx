import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

import { SCENARIO_NAMES } from '../scenarios';

export type ScenarioSourceIds = {
  tracesSourceId: string;
  logsSourceId: string;
};

export type EvalConfig = {
  hyperdx: {
    apiUrl: string;
    mcpUrl: string;
    accessKey: string;
    connectionId: string;
    scenarios: Record<string, ScenarioSourceIds>;
  };
  clickhouse: {
    host: string;
    port: string;
    user: string;
    password: string;
  };
};

export const CONFIG_FILENAME = 'eval.config.json';

export function configPath(): string {
  // Resolve relative to the package root regardless of cwd.
  // dist/cli.js → dist/ → packageRoot. src/cli.ts via tsx → src/ → packageRoot.
  return resolve(__dirname, '..', '..', CONFIG_FILENAME);
}

export function configExists(path: string = configPath()): boolean {
  return existsSync(path);
}

export function readConfig(path: string = configPath()): EvalConfig {
  if (!existsSync(path)) {
    throw new Error(
      `Eval config not found at ${path}. Run \`hdx-eval setup-hyperdx\` first.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return validateConfig(raw, path);
}

export function writeConfig(
  config: EvalConfig,
  path: string = configPath(),
): void {
  validateConfig(config, path);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function validateConfig(raw: unknown, path: string): EvalConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Eval config at ${path} is not an object.`);
  }
  const obj = raw as Record<string, unknown>;
  const hdx = obj.hyperdx as Record<string, unknown> | undefined;
  const ch = obj.clickhouse as Record<string, unknown> | undefined;
  if (!hdx) throw new Error(`Eval config missing 'hyperdx' section`);
  if (!ch) throw new Error(`Eval config missing 'clickhouse' section`);

  for (const f of ['apiUrl', 'mcpUrl', 'accessKey', 'connectionId'] as const) {
    if (typeof hdx[f] !== 'string' || !hdx[f]) {
      throw new Error(`Eval config 'hyperdx.${f}' must be a non-empty string`);
    }
  }
  const scenarios = hdx.scenarios as Record<string, ScenarioSourceIds>;
  if (!scenarios || typeof scenarios !== 'object') {
    throw new Error(`Eval config 'hyperdx.scenarios' must be an object`);
  }
  for (const name of SCENARIO_NAMES) {
    const s = scenarios[name];
    if (!s || !s.tracesSourceId || !s.logsSourceId) {
      throw new Error(
        `Eval config missing source IDs for scenario '${name}'. ` +
          `Re-run \`hdx-eval setup-hyperdx\`.`,
      );
    }
  }

  for (const f of ['host', 'port', 'user'] as const) {
    if (typeof ch[f] !== 'string') {
      throw new Error(`Eval config 'clickhouse.${f}' must be a string`);
    }
  }
  if (typeof ch.password !== 'string') {
    throw new Error(`Eval config 'clickhouse.password' must be a string`);
  }

  return raw as EvalConfig;
}

export function ensureConfigDir(path: string = configPath()): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    throw new Error(`Config directory does not exist: ${dir}`);
  }
}
