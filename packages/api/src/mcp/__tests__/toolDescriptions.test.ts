import { McpContext } from '@/mcp/tools/types';

import { createTestClient } from './mcpTestUtils';

describe('MCP tool descriptions', () => {
  const context: McpContext = { teamId: 'team-id', userId: 'user-id' };

  // Claude Code truncates tool descriptions and server instructions past
  // this many UTF-8 bytes.
  const CLAUDE_CODE_METADATA_LIMIT = 2048;

  it('keeps tool descriptions and server instructions within the Claude Code limit', async () => {
    const client = await createTestClient(context);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    const texts = [
      ['instructions', client.getInstructions() ?? ''] as const,
      ...tools.map(tool => [tool.name, tool.description ?? ''] as const),
    ];

    expect(
      texts.filter(([, text]) => text.trim() === '').map(([name]) => name),
    ).toEqual([]);

    const oversized = texts
      .map(([name, text]) => [name, Buffer.byteLength(text, 'utf8')] as const)
      .filter(([, bytes]) => bytes > CLAUDE_CODE_METADATA_LIMIT);

    expect(oversized).toEqual([]);
  });
});
