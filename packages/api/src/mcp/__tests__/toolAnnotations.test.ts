import { McpContext } from '@/mcp/tools/types';

import { createTestClient } from './mcpTestUtils';

describe('MCP tool annotations', () => {
  const context: McpContext = { teamId: 'team-id', userId: 'user-id' };

  it('declares every behavior hint as a boolean on every tool', async () => {
    const client = await createTestClient(context);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    const hints = [
      'readOnlyHint',
      'destructiveHint',
      'idempotentHint',
      'openWorldHint',
    ] as const;
    const missing = tools.flatMap(tool =>
      hints
        .filter(hint => typeof tool.annotations?.[hint] !== 'boolean')
        .map(hint => `${tool.name}.annotations.${hint}`),
    );

    expect(missing).toEqual([]);
  });
});
