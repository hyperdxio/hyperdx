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

  it('describes every input property', async () => {
    const client = await createTestClient(context);
    const { tools } = await client.listTools();

    const checked: string[] = [];
    const missing: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (node == null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${path}[${i}]`));
        return;
      }
      const properties = (node as { properties?: unknown }).properties;
      if (properties != null && typeof properties === 'object') {
        for (const [key, prop] of Object.entries(properties)) {
          // zod-to-json-schema dedupes a reused schema into a bare $ref
          // pointer; the description lives on the referenced definition.
          const isRefPointer =
            prop != null &&
            typeof prop === 'object' &&
            Object.keys(prop).length === 1 &&
            '$ref' in prop;
          if (isRefPointer) continue;
          checked.push(`${path}.${key}`);
          const description = (prop as { description?: unknown }).description;
          if (typeof description !== 'string' || description.trim() === '') {
            missing.push(`${path}.${key}`);
          }
        }
      }
      for (const [key, child] of Object.entries(node)) {
        walk(child, `${path}/${key}`);
      }
    };
    for (const tool of tools) walk(tool.inputSchema, tool.name);

    expect(checked.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
