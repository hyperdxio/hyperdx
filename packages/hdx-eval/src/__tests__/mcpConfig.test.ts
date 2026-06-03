import { allowedToolsPattern, buildMcpConfig } from '../harness/mcpConfig';
import {
  buildSettings,
  DENIED_BUILT_IN_TOOLS,
  deniedToolsFor,
} from '../harness/settingsFile';
import type { McpDefinition } from '../harness/types';
import {
  configMcpNames,
  enabledMcpNames,
  type EvalConfig,
} from '../hyperdx/config';

const hyperdxDef: McpDefinition = {
  type: 'http',
  url: 'http://localhost:30196/mcp',
  headers: { Authorization: 'Bearer test-access-key' },
  toolPattern: 'mcp__hyperdx__*',
  label: 'HyperDX',
  brandTerms: ['HyperDX', 'hyperdx'],
  deniedTools: [
    'mcp__hyperdx__hyperdx_delete_dashboard',
    'mcp__hyperdx__hyperdx_get_dashboard',
    'mcp__hyperdx__hyperdx_save_dashboard',
    'mcp__hyperdx__hyperdx_query_tile',
    'mcp__hyperdx__hyperdx_get_saved_search',
    'mcp__hyperdx__hyperdx_save_saved_search',
    'mcp__hyperdx__hyperdx_get_alert',
    'mcp__hyperdx__hyperdx_get_webhook',
    'mcp__hyperdx__hyperdx_save_alert',
  ],
};

const clickhouseDef: McpDefinition = {
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
    CLICKHOUSE_HOST: 'localhost',
    CLICKHOUSE_PORT: '30596',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
    CLICKHOUSE_SECURE: 'false',
    CLICKHOUSE_VERIFY: 'false',
    CLICKHOUSE_SEND_RECEIVE_TIMEOUT: '10',
  },
  toolPattern: 'mcp__clickhouse__*',
  label: 'ClickHouse MCP',
  brandTerms: ['ClickHouse MCP', 'clickhouse'],
};

describe('buildMcpConfig', () => {
  it('emits HyperDX HTTP transport with bearer token header', () => {
    const json = buildMcpConfig(hyperdxDef, 'hyperdx');
    expect(json).toEqual({
      mcpServers: {
        hyperdx: {
          type: 'http',
          url: 'http://localhost:30196/mcp',
          headers: { Authorization: 'Bearer test-access-key' },
        },
      },
    });
  });

  it('emits ClickHouse stdio transport via uv with pinned version + env', () => {
    const json = buildMcpConfig(clickhouseDef, 'clickhouse') as {
      mcpServers: {
        clickhouse: {
          command: string;
          args: string[];
          env: Record<string, string>;
        };
      };
    };
    expect(json.mcpServers.clickhouse.command).toBe('uv');
    expect(json.mcpServers.clickhouse.args).toEqual([
      'run',
      '--with',
      'mcp-clickhouse==0.3.0',
      '--python',
      '3.10',
      'mcp-clickhouse',
    ]);
    expect(json.mcpServers.clickhouse.env.CLICKHOUSE_HOST).toBe('localhost');
    expect(json.mcpServers.clickhouse.env.CLICKHOUSE_PORT).toBe('30596');
    expect(json.mcpServers.clickhouse.env.CLICKHOUSE_SECURE).toBe('false');
  });

  it('uses the MCP key name as the server key (supports arbitrary names)', () => {
    const json = buildMcpConfig(hyperdxDef, 'my-custom-mcp');
    expect(json).toHaveProperty('mcpServers.my-custom-mcp');
  });
});

describe('allowedToolsPattern', () => {
  it('returns the toolPattern from the definition', () => {
    expect(allowedToolsPattern(hyperdxDef)).toBe('mcp__hyperdx__*');
    expect(allowedToolsPattern(clickhouseDef)).toBe('mcp__clickhouse__*');
  });
});

describe('buildSettings', () => {
  it("allowlists only the run condition's MCP tools when no tempdir given", () => {
    expect(buildSettings(hyperdxDef)).toEqual({
      permissions: {
        allow: ['mcp__hyperdx__*'],
        deny: [...deniedToolsFor('baseline', hyperdxDef)],
      },
    });
    expect(buildSettings(clickhouseDef)).toEqual({
      permissions: {
        allow: ['mcp__clickhouse__*'],
        deny: [...DENIED_BUILT_IN_TOOLS],
      },
    });
  });

  it('adds a scoped Read allow rule when tempdir is provided', () => {
    const settings = buildSettings(
      hyperdxDef,
      'baseline',
      '/tmp/hdx-eval-abc',
    ) as {
      permissions: { allow: string[] };
    };
    expect(settings.permissions.allow).toEqual([
      'mcp__hyperdx__*',
      'Read(/tmp/hdx-eval-abc/*)',
    ]);
  });

  it('denies the built-in filesystem/shell tools so the agent cannot access the source tree', () => {
    const settings = buildSettings(hyperdxDef) as {
      permissions: { deny: string[] };
    };
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(['Bash', 'Glob', 'Grep', 'Write', 'Edit']),
    );
    // Read is NOT denied — it is allowed with a path scope via the allow list
    expect(settings.permissions.deny).not.toContain('Read');
  });

  it('includes per-MCP denied tools from the definition', () => {
    const settings = buildSettings(hyperdxDef) as {
      permissions: { deny: string[] };
    };
    expect(settings.permissions.deny).toContain(
      'mcp__hyperdx__hyperdx_delete_dashboard',
    );
  });

  it('does not include per-MCP denied tools for MCPs without deniedTools', () => {
    const settings = buildSettings(clickhouseDef) as {
      permissions: { deny: string[] };
    };
    // Should only have built-in tools denied, no MCP-specific ones
    expect(settings.permissions.deny).toEqual([...DENIED_BUILT_IN_TOOLS]);
  });
});

describe('enabledMcpNames', () => {
  const cfg: EvalConfig = {
    mcps: {
      alpha: { ...hyperdxDef, label: 'Alpha' },
      beta: { ...clickhouseDef, label: 'Beta', enabled: true },
      gamma: { ...hyperdxDef, label: 'Gamma', enabled: false },
    },
  };

  it('returns all MCP names from configMcpNames regardless of enabled', () => {
    expect(configMcpNames(cfg).sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('excludes MCPs where enabled is explicitly false', () => {
    expect(enabledMcpNames(cfg).sort()).toEqual(['alpha', 'beta']);
  });

  it('treats missing enabled field as true', () => {
    expect(enabledMcpNames(cfg)).toContain('alpha');
  });
});
