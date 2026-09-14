import {
  AGENT_TOOLSET,
  AUTO_ALLOWED_MCP_TOOLS,
} from '@hyperdx/common-utils/dist/managedAgents';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import alertsTools from '@/mcp/tools/alerts/index';
import dashboardsTools from '@/mcp/tools/dashboards/index';
import queryTools from '@/mcp/tools/query/index';
import savedSearchesTools from '@/mcp/tools/savedSearches/index';
import sourcesTools from '@/mcp/tools/sources/index';
import traceTools from '@/mcp/tools/trace/index';
import type { ToolRegistrar } from '@/mcp/tools/types';

// Registration only touches registrar.registerTool, so a capturing stub reads
// the real registry without standing up a transport or a ClickHouse connection.
const registeredTools = () => {
  const tools = new Map<string, { destructive: boolean }>();
  const registrar: ToolRegistrar = {
    server: new McpServer({ name: 'test', version: '0' }),
    context: { teamId: 'team', userId: 'user' },
    registerTool: (name, config) => {
      tools.set(name, {
        destructive: config.annotations?.destructiveHint === true,
      });
    },
  };

  for (const register of [
    sourcesTools,
    alertsTools,
    dashboardsTools,
    queryTools,
    savedSearchesTools,
    traceTools,
  ]) {
    register(registrar);
  }
  return tools;
};

describe('AUTO_ALLOWED_MCP_TOOLS', () => {
  const tools = registeredTools();

  it('names only tools the MCP server actually registers', () => {
    const unknown = AUTO_ALLOWED_MCP_TOOLS.filter(name => !tools.has(name));
    expect(unknown).toEqual([]);
  });

  // The allowlist is what an unattended alert investigation may call without
  // an approval prompt, and no one is there to answer one. Keyed off the
  // registry's own destructiveHint rather than a name pattern, so a mutating
  // tool named with a new verb cannot slip in unnoticed.
  it('auto-approves no tool the registry marks destructive', () => {
    const destructive = AUTO_ALLOWED_MCP_TOOLS.filter(
      name => tools.get(name)?.destructive,
    );
    expect(destructive).toEqual([]);
  });

  it('covers every non-destructive tool, so new read tools are a deliberate choice', () => {
    const missing = [...tools.entries()]
      .filter(
        ([name, t]) => !t.destructive && !AUTO_ALLOWED_MCP_TOOLS.includes(name),
      )
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});

// See the AGENT_TOOLSET docblock for why each value is what it is. The whole
// surface is pinned rather than spot-checked: a tool dropped from configs
// inherits the toolset default, which is the failure this policy exists to
// prevent, and a spot-check would not see it.
describe('AGENT_TOOLSET', () => {
  it('fails closed by default', () => {
    expect(AGENT_TOOLSET.default_config.permission_policy.type).toBe(
      'always_ask',
    );
  });

  it('pins every tool to its intended policy', () => {
    const surface = AGENT_TOOLSET.configs.map(c => [
      c.name,
      c.enabled ?? true,
      c.permission_policy?.type ??
        AGENT_TOOLSET.default_config.permission_policy.type,
    ]);
    expect(surface).toEqual([
      ['read', true, 'always_allow'],
      ['write', true, 'always_allow'],
      ['edit', true, 'always_allow'],
      ['glob', true, 'always_allow'],
      ['grep', true, 'always_allow'],
      // Gated, not open: the agent is told to follow a runbook link.
      ['web_fetch', true, 'auto'],
      ['web_search', false, 'always_ask'],
      // No unattended shell — see the docblock.
      ['bash', false, 'always_ask'],
    ]);
  });

  it('is frozen, so a consumer cannot widen it at runtime', () => {
    expect(Object.isFrozen(AGENT_TOOLSET.configs)).toBe(true);
    expect(() => {
      // @ts-expect-error -- readonly at compile time; this asserts runtime too
      AGENT_TOOLSET.configs[0].enabled = false;
    }).toThrow();
  });
});
