import {
  allowedToolsPattern,
  buildMcpConfig,
  MCP_CLICKHOUSE_VERSION,
} from '../harness/mcpConfig';
import {
  buildSettings,
  DENIED_BUILT_IN_TOOLS,
  deniedToolsFor,
} from '../harness/settingsFile';
import type { EvalConfig } from '../hyperdx/config';

const cfg: EvalConfig = {
  hyperdx: {
    apiUrl: 'http://localhost:30196',
    mcpUrl: 'http://localhost:30196/mcp',
    accessKey: 'test-access-key',
    connectionId: 'conn-id-1',
    scenarios: {
      'error-root-cause': { tracesSourceId: 't1', logsSourceId: 'l1' },
      'latency-spike': { tracesSourceId: 't2', logsSourceId: 'l2' },
      'noisy-signals': { tracesSourceId: 't3', logsSourceId: 'l3' },
    },
  },
  clickhouse: {
    host: 'localhost',
    port: '30596',
    user: 'default',
    password: '',
  },
};

describe('buildMcpConfig', () => {
  it('emits HyperDX HTTP transport with bearer token header', () => {
    const json = buildMcpConfig(cfg, 'hyperdx');
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
    const json = buildMcpConfig(cfg, 'clickhouse') as {
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
      `mcp-clickhouse==${MCP_CLICKHOUSE_VERSION}`,
      '--python',
      '3.10',
      'mcp-clickhouse',
    ]);
    expect(json.mcpServers.clickhouse.env.CLICKHOUSE_HOST).toBe('localhost');
    expect(json.mcpServers.clickhouse.env.CLICKHOUSE_PORT).toBe('30596');
    expect(json.mcpServers.clickhouse.env.CLICKHOUSE_SECURE).toBe('false');
  });
});

describe('allowedToolsPattern', () => {
  it('restricts to the right MCP namespace', () => {
    expect(allowedToolsPattern('hyperdx')).toBe('mcp__hyperdx__*');
    expect(allowedToolsPattern('clickhouse')).toBe('mcp__clickhouse__*');
  });
});

describe('buildSettings', () => {
  it("allowlists only the run condition's MCP tools when no tempdir given", () => {
    expect(buildSettings('hyperdx')).toEqual({
      permissions: {
        allow: ['mcp__hyperdx__*'],
        deny: [...deniedToolsFor('baseline', 'hyperdx')],
      },
    });
    expect(buildSettings('clickhouse')).toEqual({
      permissions: {
        allow: ['mcp__clickhouse__*'],
        deny: [...DENIED_BUILT_IN_TOOLS],
      },
    });
  });

  it('adds a scoped Read allow rule when tempdir is provided', () => {
    const settings = buildSettings(
      'hyperdx',
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
    const settings = buildSettings('hyperdx') as {
      permissions: { deny: string[] };
    };
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(['Bash', 'Glob', 'Grep', 'Write', 'Edit']),
    );
    // Read is NOT denied — it is allowed with a path scope via the allow list
    expect(settings.permissions.deny).not.toContain('Read');
  });
});
