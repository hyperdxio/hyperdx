import {
  registerAgentRunExtension,
  resetAgentRunExtensionsForTests,
  runDeliveryExtensions,
  runProvisionExtensions,
  runSessionStartExtensions,
} from '@/services/agentRunExtensions';

const sessionCtx = {
  teamId: 't1',
  agent: { name: 'SRE Responder' } as any,
  anthropicSessionId: 'sesn_1',
  title: 'CPU alert',
  prompt: '{"source":"clickstack"}',
};

const provisionCtx = {
  teamId: 't1',
  name: 'SRE Responder',
  model: 'claude-opus-4-8',
  mcpServerUrl: 'https://mcp.example.test/api/mcp',
  defaultSystemPrompt: 'You are an SRE agent.',
};

describe('agentRunExtensions', () => {
  afterEach(() => {
    resetAgentRunExtensionsForTests();
  });

  it('produces neutral results when nothing is registered', async () => {
    expect(await runSessionStartExtensions(sessionCtx)).toEqual({
      prompt: '{"source":"clickstack"}',
      runMetadata: undefined,
    });
    expect(await runProvisionExtensions(provisionCtx)).toEqual({
      systemPrompt: 'You are an SRE agent.',
    });
    expect(
      await runDeliveryExtensions({ run: {} as any, summary: 's' }),
    ).toEqual({ footerLinks: [] });
  });

  it('merges contributions across extensions in registration order', async () => {
    registerAgentRunExtension({
      name: 'a',
      onSessionStart: async () => ({
        promptSuffix: '\nA-instructions',
        runMetadata: { a: 1 },
      }),
      onBeforeDelivery: async () => ({
        footerLinks: [{ label: 'A', url: 'https://a.example' }],
      }),
    });
    registerAgentRunExtension({
      name: 'b',
      onSessionStart: async () => ({
        promptSuffix: '\nB-instructions',
        runMetadata: { b: 2 },
      }),
    });

    expect(await runSessionStartExtensions(sessionCtx)).toEqual({
      prompt: '{"source":"clickstack"}\nA-instructions\nB-instructions',
      runMetadata: { a: 1, b: 2 },
    });
    expect(
      (await runDeliveryExtensions({ run: {} as any, summary: 's' }))
        .footerLinks,
    ).toEqual([{ label: 'A', url: 'https://a.example' }]);
  });

  it('lets an extension replace the kickoff prompt wholesale; last override wins, suffixes still append', async () => {
    registerAgentRunExtension({
      name: 'override-1',
      onSessionStart: async () => ({ promptOverride: 'FIRST' }),
    });
    registerAgentRunExtension({
      name: 'override-2',
      onSessionStart: async ctx => ({
        // Overriders receive the OSS payload (ctx.prompt) so they can rebuild
        // or tweak it; here we just prove the context reaches the override.
        promptOverride: `SECOND (${ctx.title})`,
        promptSuffix: '\nplus-suffix',
      }),
    });

    expect((await runSessionStartExtensions(sessionCtx)).prompt).toBe(
      'SECOND (CPU alert)\nplus-suffix',
    );
  });

  it('lets an extension replace the provisioning system prompt; last defined wins', async () => {
    registerAgentRunExtension({
      name: 'sys-1',
      onProvisionAgent: async () => ({ systemPrompt: 'FIRST SYSTEM' }),
    });
    registerAgentRunExtension({
      name: 'sys-2',
      onProvisionAgent: async ctx => ({
        // ctx.defaultSystemPrompt is available for overriders that extend
        // rather than rewrite; here we prove the context reaches the hook.
        systemPrompt: `SECOND SYSTEM (for ${ctx.name})`,
      }),
    });

    expect((await runProvisionExtensions(provisionCtx)).systemPrompt).toBe(
      'SECOND SYSTEM (for SRE Responder)',
    );
  });

  it('isolates a throwing extension (fail-open) and keeps later ones', async () => {
    registerAgentRunExtension({
      name: 'boom',
      onProvisionAgent: async () => {
        throw new Error('boom');
      },
      onSessionStart: async () => {
        throw new Error('boom');
      },
      onBeforeDelivery: async () => {
        throw new Error('boom');
      },
    });
    registerAgentRunExtension({
      name: 'ok',
      onSessionStart: async () => ({ promptSuffix: 'OK' }),
    });

    expect((await runSessionStartExtensions(sessionCtx)).prompt).toBe(
      '{"source":"clickstack"}OK',
    );
    expect((await runProvisionExtensions(provisionCtx)).systemPrompt).toBe(
      'You are an SRE agent.',
    );
    expect(
      (await runDeliveryExtensions({ run: {} as any, summary: 's' }))
        .footerLinks,
    ).toEqual([]);
  });

  it('treats a void hook result as no contribution', async () => {
    registerAgentRunExtension({
      name: 'noop',
      onSessionStart: async () => undefined,
      onProvisionAgent: async () => undefined,
    });
    expect(await runSessionStartExtensions(sessionCtx)).toEqual({
      prompt: '{"source":"clickstack"}',
      runMetadata: undefined,
    });
    expect((await runProvisionExtensions(provisionCtx)).systemPrompt).toBe(
      'You are an SRE agent.',
    );
  });

  it('skips extensions that do not implement a hook', async () => {
    registerAgentRunExtension({ name: 'delivery-only' });
    expect((await runSessionStartExtensions(sessionCtx)).prompt).toBe(
      '{"source":"clickstack"}',
    );
  });
});
