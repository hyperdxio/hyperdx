import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import type { McpDefinition, McpKind } from '@/harness/types';

type ScenarioSourceIds = {
  tracesSourceId: string;
  logsSourceId: string;
};

/**
 * Configuration for the HyperDX API — only needed by the `setup-hyperdx`
 * command to create Connections and Sources. Not required for running evals.
 */
type HyperdxApiConfig = {
  apiUrl: string;
  accessKey: string;
  connectionId: string;
};

export type EvalConfig = {
  /** Registry of MCP definitions keyed by a free-form name. */
  mcps: Record<McpKind, McpDefinition>;
  /** Per-scenario HyperDX Source IDs (only needed when an MCP points at
   *  HyperDX and the Sources must exist). */
  scenarios?: Record<string, ScenarioSourceIds>;
  /** HyperDX API config — only needed for `setup-hyperdx`. */
  hyperdxApi?: HyperdxApiConfig;
  /** ClickHouse connection details — used by seed/drop/instrument commands
   *  and as the default for stdio MCP env vars. */
  clickhouse?: {
    host: string;
    port: string;
    user: string;
    password: string;
  };
  /**
   * Fixed "now" anchor (ISO 8601) for both seed and agent system prompt.
   * Defaults to the current time on first run and is persisted so subsequent
   * runs reuse the same anchor. Override with `--anchor-time` on the CLI, or
   * pass `--live` to ignore the saved value and use wall-clock time.
   */
  anchorTime?: string;
};

const CONFIG_FILENAME = 'eval.config.json';

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

/** Return all MCP names defined in the config. */
export function configMcpNames(config: EvalConfig): McpKind[] {
  return Object.keys(config.mcps);
}

/** Return only the enabled MCP names (where `enabled` is not `false`). */
export function enabledMcpNames(config: EvalConfig): McpKind[] {
  return Object.entries(config.mcps)
    .filter(([, def]) => def.enabled !== false)
    .map(([name]) => name);
}

/** Get a single MCP definition by name, or throw. */
export function getMcpDefinition(
  config: EvalConfig,
  name: McpKind,
): McpDefinition {
  const def = config.mcps[name];
  if (!def) {
    const available = configMcpNames(config).join(', ');
    throw new Error(
      `MCP "${name}" not found in config. Available: ${available}`,
    );
  }
  return def;
}

/**
 * Return the config's saved `anchorTime`, creating and persisting a default
 * (current wall-clock time) when none exists yet.  This makes anchor-time
 * "sticky" — the first `run` freezes the anchor, and later runs reuse it
 * automatically.
 *
 * Pass `overrideIso` to force a specific value (e.g. from `--anchor-time`).
 * The override is saved back to the config file.
 */
export function ensureAnchorTime(
  config: EvalConfig,
  overrideIso?: string,
): { anchorTimeIso: string; anchorMs: number } {
  let iso = overrideIso ?? config.anchorTime;
  if (!iso) {
    iso = new Date().toISOString();
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid anchorTime value: ${iso}`);
  }
  // Normalise and persist if it changed.
  const normalised = new Date(ms).toISOString();
  if (config.anchorTime !== normalised) {
    config.anchorTime = normalised;
    writeConfig(config);
  }
  return { anchorTimeIso: normalised, anchorMs: ms };
}

function validateConfig(raw: unknown, path: string): EvalConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Eval config at ${path} is not an object.`);
  }
  const obj = raw as Record<string, unknown>;

  // Require the `mcps` section.
  const mcps = obj.mcps as Record<string, unknown> | undefined;
  if (!mcps || typeof mcps !== 'object') {
    throw new Error(
      `Eval config at ${path} missing 'mcps' section. ` +
        `Re-run \`hdx-eval setup-hyperdx\` to generate a new config.`,
    );
  }

  // Validate each MCP definition.
  for (const [name, def] of Object.entries(mcps)) {
    if (!def || typeof def !== 'object') {
      throw new Error(`Eval config 'mcps.${name}' must be an object`);
    }
    const d = def as Record<string, unknown>;
    if (d.type !== 'http' && d.type !== 'stdio') {
      throw new Error(
        `Eval config 'mcps.${name}.type' must be "http" or "stdio"`,
      );
    }
    if (d.type === 'http') {
      if (typeof d.url !== 'string' || !d.url) {
        throw new Error(
          `Eval config 'mcps.${name}.url' must be a non-empty string`,
        );
      }
    } else {
      if (typeof d.command !== 'string' || !d.command) {
        throw new Error(
          `Eval config 'mcps.${name}.command' must be a non-empty string`,
        );
      }
    }
    if (typeof d.toolPattern !== 'string' || !d.toolPattern) {
      throw new Error(
        `Eval config 'mcps.${name}.toolPattern' must be a non-empty string`,
      );
    }
    if (typeof d.label !== 'string' || !d.label) {
      throw new Error(
        `Eval config 'mcps.${name}.label' must be a non-empty string`,
      );
    }
  }

  return raw as EvalConfig;
}
