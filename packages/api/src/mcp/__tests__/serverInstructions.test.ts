import { buildServerInstructions } from '@/mcp/mcpServer';

describe('buildServerInstructions', () => {
  const base = { teamId: 't', userId: 'u' };

  it('leaves the instructions unchanged with the flag off', () => {
    expect(buildServerInstructions(base)).not.toMatch(/incident_context/);
  });

  it('adds the incident paragraph with the flag on', () => {
    const off = buildServerInstructions(base);
    const on = buildServerInstructions({
      ...base,
      isKnowledgeGraphEnabled: true,
    });
    expect(on.startsWith(off)).toBe(true);
    expect(on).toMatch(
      /Start an alert investigation with clickstack_incident_context/,
    );
  });
});
