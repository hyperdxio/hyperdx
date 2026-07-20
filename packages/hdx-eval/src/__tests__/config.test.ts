import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  configPluginNames,
  type EvalConfig,
  getPluginDefinition,
  readConfig,
} from '@/hyperdx/config';

const VALID_MCP = {
  type: 'http',
  url: 'http://localhost:30196/mcp',
  toolPattern: 'mcp__hyperdx__*',
  label: 'HyperDX',
};

const baseConfig: EvalConfig = {
  mcps: { hyperdx: VALID_MCP as EvalConfig['mcps'][string] },
  plugins: {
    urlplugin: { label: 'Url Plugin', url: 'https://example.com/p.zip' },
    dirplugin: { label: 'Dir Plugin', dir: '/abs/path/to/plugin' },
  },
};

describe('readConfig plugin validation', () => {
  const tmpRoot = join('/tmp', `hdx-eval-config-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeTmpConfig(name: string, config: unknown): string {
    const p = join(tmpRoot, `${name}.json`);
    writeFileSync(p, JSON.stringify(config, null, 2));
    return p;
  }

  it('accepts a config with valid url and dir plugins', () => {
    const p = writeTmpConfig('valid', baseConfig);
    const config = readConfig(p);
    expect(configPluginNames(config).sort()).toEqual([
      'dirplugin',
      'urlplugin',
    ]);
  });

  it('accepts a config with no plugins section', () => {
    const p = writeTmpConfig('no-plugins', { mcps: baseConfig.mcps });
    expect(configPluginNames(readConfig(p))).toEqual([]);
  });

  it('rejects a plugin without a label', () => {
    const p = writeTmpConfig('no-label', {
      mcps: baseConfig.mcps,
      plugins: { bad: { url: 'https://example.com/p.zip' } },
    });
    expect(() => readConfig(p)).toThrow(/plugins\.bad\.label/);
  });

  it('rejects a plugin that sets both url and dir', () => {
    const p = writeTmpConfig('both', {
      mcps: baseConfig.mcps,
      plugins: {
        bad: { label: 'Bad', url: 'https://example.com/p.zip', dir: '/x' },
      },
    });
    expect(() => readConfig(p)).toThrow(/exactly one of 'url' or 'dir'/);
  });

  it('rejects a plugin that sets neither url nor dir', () => {
    const p = writeTmpConfig('neither', {
      mcps: baseConfig.mcps,
      plugins: { bad: { label: 'Bad' } },
    });
    expect(() => readConfig(p)).toThrow(/exactly one of 'url' or 'dir'/);
  });

  it('rejects a plugin using the reserved name "none"', () => {
    const p = writeTmpConfig('reserved-none', {
      mcps: baseConfig.mcps,
      plugins: { none: { label: 'None', url: 'https://example.com/p.zip' } },
    });
    expect(() => readConfig(p)).toThrow(/reserved name "none"/);
  });

  it('rejects a non-object plugins section', () => {
    const p = writeTmpConfig('not-object', {
      mcps: baseConfig.mcps,
      plugins: 'nope',
    });
    expect(() => readConfig(p)).toThrow(/'plugins' must be an object/);
  });
});

describe('readConfig mcps.metricsAvailable validation', () => {
  const tmpRoot = join('/tmp', `hdx-eval-config-metrics-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeTmpConfig(name: string, config: unknown): string {
    const p = join(tmpRoot, `${name}.json`);
    writeFileSync(p, JSON.stringify(config, null, 2));
    return p;
  }

  it('accepts an MCP with metricsAvailable: false', () => {
    const p = writeTmpConfig('metrics-false', {
      mcps: { hyperdx: { ...VALID_MCP, metricsAvailable: false } },
    });
    expect(readConfig(p).mcps.hyperdx.metricsAvailable).toBe(false);
  });

  it('accepts an MCP without metricsAvailable', () => {
    const p = writeTmpConfig('metrics-absent', { mcps: baseConfig.mcps });
    expect(readConfig(p).mcps.hyperdx.metricsAvailable).toBeUndefined();
  });

  it('rejects a non-boolean metricsAvailable', () => {
    const p = writeTmpConfig('metrics-string', {
      mcps: { hyperdx: { ...VALID_MCP, metricsAvailable: 'yes' } },
    });
    expect(() => readConfig(p)).toThrow(
      `Eval config 'mcps.hyperdx.metricsAvailable' must be a boolean`,
    );
  });

  it('accepts an MCP with a valid scoping policy', () => {
    const p = writeTmpConfig('scoping-valid', {
      mcps: {
        hyperdx: {
          ...VALID_MCP,
          scoping: {
            hideSourceKinds: ['metric'],
            pinSqlConnectionId: 'abc123',
          },
        },
      },
    });
    expect(readConfig(p).mcps.hyperdx.scoping).toEqual({
      hideSourceKinds: ['metric'],
      pinSqlConnectionId: 'abc123',
    });
  });

  it('rejects scoping with a non-array hideSourceKinds', () => {
    const p = writeTmpConfig('scoping-bad-kinds', {
      mcps: {
        hyperdx: { ...VALID_MCP, scoping: { hideSourceKinds: 'metric' } },
      },
    });
    expect(() => readConfig(p)).toThrow(
      `Eval config 'mcps.hyperdx.scoping.hideSourceKinds' must be an array of strings`,
    );
  });

  it('rejects scoping on a stdio MCP', () => {
    const p = writeTmpConfig('scoping-stdio', {
      mcps: {
        ch: {
          type: 'stdio',
          command: 'uv',
          toolPattern: 'mcp__ch__*',
          label: 'CH',
          scoping: { hideSourceKinds: ['metric'] },
        },
      },
    });
    expect(() => readConfig(p)).toThrow(
      `Eval config 'mcps.ch.scoping' is only supported for http MCPs`,
    );
  });
});

describe('getPluginDefinition', () => {
  it('returns the definition for a known plugin', () => {
    expect(getPluginDefinition(baseConfig, 'urlplugin')).toEqual({
      label: 'Url Plugin',
      url: 'https://example.com/p.zip',
    });
    expect(getPluginDefinition(baseConfig, 'dirplugin')).toEqual({
      label: 'Dir Plugin',
      dir: '/abs/path/to/plugin',
    });
  });

  it('throws for an unknown plugin, listing available names', () => {
    expect(() => getPluginDefinition(baseConfig, 'missing')).toThrow(
      /Plugin "missing" not found.*urlplugin, dirplugin/,
    );
  });

  it('throws when no plugins are defined at all', () => {
    expect(() =>
      getPluginDefinition({ mcps: baseConfig.mcps }, 'missing'),
    ).toThrow(/\(none defined\)/);
  });

  it('throws for a definition with both url and dir set', () => {
    const config: EvalConfig = {
      mcps: baseConfig.mcps,
      plugins: { bad: { label: 'Bad', url: 'https://x/p.zip', dir: '/x' } },
    };
    expect(() => getPluginDefinition(config, 'bad')).toThrow(
      /exactly one of 'url' or 'dir'/,
    );
  });
});
