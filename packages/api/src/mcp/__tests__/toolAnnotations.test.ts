import { McpContext } from '@/mcp/tools/types';

import { createTestClient } from './mcpTestUtils';

describe('MCP tool annotations', () => {
  const context: McpContext = { teamId: 'team-id', userId: 'user-id' };

  it('declares every behavior hint as a boolean on every tool', async () => {
    const client = await createTestClient(context);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    const missing = tools.flatMap(tool =>
      Object.entries({
        readOnlyHint: tool.annotations?.readOnlyHint,
        destructiveHint: tool.annotations?.destructiveHint,
        idempotentHint: tool.annotations?.idempotentHint,
        openWorldHint: tool.annotations?.openWorldHint,
      })
        .filter(([, value]) => typeof value !== 'boolean')
        .map(([hint]) => `${tool.name}.annotations.${hint}`),
    );

    expect(missing).toEqual([]);
  });
});
