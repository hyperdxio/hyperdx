import { McpContext } from '@/mcp/tools/types';

import { createTestClient } from './mcpTestUtils';

describe('MCP server metadata', () => {
  const context: McpContext = { teamId: 'team-id', userId: 'user-id' };

  it('advertises a title, description, website, and scalable icon', async () => {
    const client = await createTestClient(context);
    const info = client.getServerVersion();

    expect(info).toMatchObject({
      name: 'clickstack',
      title: 'ClickStack',
      websiteUrl: expect.stringMatching(/^https:\/\//),
      description: expect.any(String),
    });
    expect(info?.icons).toEqual([
      expect.objectContaining({
        src: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
        mimeType: 'image/svg+xml',
        sizes: ['any'],
      }),
    ]);
  });
});
