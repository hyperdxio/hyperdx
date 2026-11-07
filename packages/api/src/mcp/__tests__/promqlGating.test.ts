import { createTestClient } from './mcpTestUtils';

/**
 * With PromQL disabled, nothing in the MCP surface mentions PromQL: the
 * clickstack_promql tool is not registered and the instructions and prompts
 * leave it out. The tools/list, instructions and query_guide prompt are built
 * from the registered definitions alone, so no database is needed here.
 */
describe('MCP PromQL gating', () => {
  const connect = (promqlEnabled: boolean) =>
    createTestClient({ teamId: 'team-id', userId: 'user-id', promqlEnabled });

  const queryGuide = async (client: Awaited<ReturnType<typeof connect>>) => {
    const { messages } = await client.getPrompt({ name: 'query_guide' });
    const content = messages[0].content;
    return content.type === 'text' ? content.text : '';
  };

  it('registers clickstack_promql and documents it while PromQL is enabled', async () => {
    const client = await connect(true);

    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toContain('clickstack_promql');
    expect(client.getInstructions()).toContain('clickstack_promql');
    expect(await queryGuide(client)).toContain('== PROMQL SOURCES ==');

    const { prompts } = await client.listPrompts();
    expect(
      prompts.find(prompt => prompt.name === 'query_guide')?.description,
    ).toContain('PromQL');
  });

  it('hides clickstack_promql and every mention of it while PromQL is disabled', async () => {
    const client = await connect(false);

    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).not.toContain('clickstack_promql');
    expect(client.getInstructions()).not.toContain('PromQL');
    const guide = await queryGuide(client);
    expect(guide).not.toContain('== PROMQL SOURCES ==');
    expect(guide).not.toContain('clickstack_promql');

    const { prompts } = await client.listPrompts();
    expect(
      prompts.find(prompt => prompt.name === 'query_guide')?.description,
    ).not.toContain('PromQL');
  });
});
