import mongoose from 'mongoose';

import { getServer } from '@/fixtures';
import AgentRun from '@/models/agentRun';
import ManagedAgent from '@/models/managedAgent';
import {
  registerAgentRunExtension,
  resetAgentRunExtensionsForTests,
  runSessionStartExtensions,
} from '@/services/agentRunExtensions';
import {
  AnthropicApiError,
  buildAgentSlackMessage,
  chunkForSlack,
  deleteAnthropicAgent,
  getTeamAnthropicKey,
  pollAndDeliverAgentSessions,
  provisionClickStackAgent,
  startAgentSession,
  verifyMcpReachable,
} from '@/services/anthropicAgents';
import logger from '@/utils/logger';
import * as slack from '@/utils/slack';

const SLACK_URL = 'https://hooks.slack.com/services/T0/B0/XXX';

const KEY = 'b'.repeat(64);
// Anthropic requires an HTTPS MCP URL; provisioning resolves it from this env.
const MCP_URL = 'https://mcp.example.test/api/mcp';

// The team's Anthropic key is resolved via the resolveAnthropicKey extension
// seam (OSS falls back to env, which is unset in tests). Registering this
// resolver is how EE injects a per-team key; afterEach resets the registry.
const registerTestAnthropicKey = (apiKey = 'sk-ant-key') =>
  registerAgentRunExtension({
    name: 'test-key',
    resolveAnthropicKey: async () => ({ apiKey }),
  });

// Sequenced Anthropic responses keyed by URL substring.
const mockAnthropic = () =>
  jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
    const u = String(url);
    const body = (data: unknown) =>
      ({ ok: true, text: async () => JSON.stringify(data) }) as any;
    // MCP reachability preflight (provisioning hits this before Anthropic).
    if (u === MCP_URL) return body({ ok: true });
    if (u.endsWith('/v1/environments')) return body({ id: 'env_1' });
    if (u.endsWith('/v1/vaults')) return body({ id: 'vlt_1' });
    if (u.includes('/credentials')) return body({ id: 'cred_1' });
    if (u.endsWith('/v1/agents')) return body({ id: 'agent_1' });
    throw new Error(`unexpected fetch to ${u}`);
  });

describe('anthropicAgents service', () => {
  const server = getServer();
  const originalKey = process.env.HDX_ENCRYPTION_KEY;
  const originalMcpUrl = process.env.HDX_MANAGED_AGENTS_MCP_URL;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    process.env.HDX_ENCRYPTION_KEY = KEY;
    process.env.HDX_MANAGED_AGENTS_MCP_URL = MCP_URL;
    await server.start();
  });
  afterEach(async () => {
    fetchSpy?.mockRestore();
    resetAgentRunExtensionsForTests();
    await server.clearDBs();
  });
  afterAll(async () => {
    process.env.HDX_ENCRYPTION_KEY = originalKey;
    process.env.HDX_MANAGED_AGENTS_MCP_URL = originalMcpUrl;
    await server.stop();
  });

  it('getTeamAnthropicKey returns null when no key is configured (no env, no resolver)', async () => {
    const teamId = new mongoose.Types.ObjectId();
    expect(await getTeamAnthropicKey(teamId as any)).toBeNull();
  });

  it('getTeamAnthropicKey returns the key from a registered resolver extension', async () => {
    registerTestAnthropicKey('sk-ant-resolved');
    const teamId = new mongoose.Types.ObjectId();
    expect(await getTeamAnthropicKey(teamId as any)).toBe('sk-ant-resolved');
  });

  it('registers no extensions by default (OSS ships an empty registration point)', async () => {
    // Importing the service pulls in @/extensions as a side effect; the OSS
    // stub must leave the registry empty so behaviour is unchanged.
    expect(
      await runSessionStartExtensions({
        teamId: 't',
        agent: { name: 'x' } as any,
        anthropicSessionId: 's',
        title: 't',
        prompt: 'p',
      }),
    ).toEqual({ prompt: 'p', runMetadata: undefined });
  });

  it('provisions env + vault + credential + agent and persists the record', async () => {
    fetchSpy = mockAnthropic();
    const teamId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    registerTestAnthropicKey();

    const agent = await provisionClickStackAgent({
      teamId: teamId as any,
      userId: userId as any,
      userAccessKey: 'user-access-key',
      name: 'prod SRE',
      model: 'claude-opus-4-8',
    });

    // Persisted record carries the Anthropic IDs.
    expect(agent.anthropicAgentId).toBe('agent_1');
    expect(agent.vaultId).toBe('vlt_1');
    expect(agent.environmentId).toBe('env_1');
    const stored = await ManagedAgent.findById(agent._id);
    expect(stored).not.toBeNull();

    // The MCP URL must be byte-identical in the vault credential and the agent.
    const calls = fetchSpy.mock.calls;
    const bodyOf = (substr: string) =>
      JSON.parse(
        calls.find(([u]) => String(u).includes(substr))![1].body as string,
      );
    const credBody = bodyOf('/credentials');
    const agentBody = bodyOf('/v1/agents');
    expect(credBody.auth.mcp_server_url).toBe(MCP_URL);
    expect(agentBody.mcp_servers[0].url).toBe(MCP_URL);
    expect(credBody.auth.token).toBe('user-access-key');

    // The ClickStack MCP toolset auto-allows its (read-only) tools so the
    // unattended session doesn't idle waiting for human approval.
    const mcpToolset = agentBody.tools.find(
      (t: any) => t.type === 'mcp_toolset',
    );
    expect(mcpToolset.default_config.permission_policy.type).toBe(
      'always_allow',
    );

    // Beta header is sent.
    const agentHeaders = calls.find(([u]) =>
      String(u).endsWith('/v1/agents'),
    )![1].headers;
    expect(agentHeaders['anthropic-beta']).toBe('managed-agents-2026-04-01');
  });

  it('throws AnthropicApiError (400) when no key is configured', async () => {
    const teamId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    await expect(
      provisionClickStackAgent({
        teamId: teamId as any,
        userId: userId as any,
        userAccessKey: 'k',
        name: 'x',
        model: 'claude-opus-4-8',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('surfaces an Anthropic API failure as AnthropicApiError', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad key',
    } as any);
    const teamId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    registerTestAnthropicKey('sk-ant-bad');
    await expect(
      provisionClickStackAgent({
        teamId: teamId as any,
        userId: userId as any,
        userAccessKey: 'k',
        name: 'x',
        model: 'claude-opus-4-8',
      }),
    ).rejects.toBeInstanceOf(AnthropicApiError);
  });

  describe('deleteAnthropicAgent', () => {
    const seedKey = async () => {
      const teamId = new mongoose.Types.ObjectId();
      registerTestAnthropicKey();
      return teamId;
    };

    it('treats a 404 as success without logging a failure (idempotent)', async () => {
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'nf',
      } as any);
      const teamId = await seedKey();

      await expect(
        deleteAnthropicAgent(teamId as any, 'agent_gone'),
      ).resolves.toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('logs a warning but still does not throw on other errors', async () => {
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'boom',
      } as any);
      const teamId = await seedKey();

      await expect(
        deleteAnthropicAgent(teamId as any, 'agent_x'),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('chunkForSlack', () => {
    it('keeps short text as a single chunk', () => {
      expect(chunkForSlack('short summary')).toEqual(['short summary']);
    });

    it('splits long text into chunks all within the Slack section limit', () => {
      // ~10k chars across many lines, well over the 2900 section cap.
      const text = Array.from(
        { length: 200 },
        (_, i) => `line ${i} ${'x'.repeat(40)}`,
      ).join('\n');
      const chunks = chunkForSlack(text);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2900);
      // Rejoining recovers the original (line boundaries preserved).
      expect(chunks.join('\n')).toBe(text);
    });

    it('hard-splits a single over-long line', () => {
      const chunks = chunkForSlack('x'.repeat(7000));
      expect(chunks.length).toBe(3);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2900);
      expect(chunks.join('').length).toBe(7000);
    });
  });

  describe('buildAgentSlackMessage', () => {
    it('spreads a large summary across multiple valid section blocks', () => {
      const summary = 'A'.repeat(5827); // a real-world RCA length
      const msg = buildAgentSlackMessage('Alert title', summary, 'sesn_1');
      const sections = msg.blocks.filter((b: any) => b.type === 'section');
      // Title header + at least 2 summary sections (5827 / 2900).
      expect(sections.length).toBeGreaterThanOrEqual(3);
      for (const s of sections) {
        expect((s as any).text.text.length).toBeLessThanOrEqual(3000);
      }
      // Footer links back to the session.
      const ctx = msg.blocks.find((b: any) => b.type === 'context') as any;
      expect(ctx.elements[0].text).toContain('sesn_1');
    });

    it('shows a placeholder (not a blank message) when the summary is empty', () => {
      const msg = buildAgentSlackMessage('Alert title', '', 'sesn_1');
      expect(JSON.stringify(msg)).toContain('no summary text');
    });

    it('renders footer links before the session line', () => {
      const msg = buildAgentSlackMessage('title', 'summary', 'sesn_1', [
        {
          label: 'Investigation notebook',
          url: 'https://hdx.example/notebook/n1',
        },
      ]);
      const footer = (msg.blocks.at(-1) as any).elements[0].text;
      expect(footer).toContain(
        '<https://hdx.example/notebook/n1|Investigation notebook>',
      );
      expect(footer.indexOf('Investigation notebook')).toBeLessThan(
        footer.indexOf('Continue in the live agent session'),
      );
    });

    it('is unchanged when no footer links are given', () => {
      const msg = buildAgentSlackMessage('title', 'summary', 'sesn_1');
      const footer = (msg.blocks.at(-1) as any).elements[0].text;
      expect(footer).toBe('Continue in the live agent session: sesn_1');
    });
  });

  describe('verifyMcpReachable', () => {
    it('passes when the MCP server answers a non-401 response', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true, status: 200 } as any);
      await expect(
        verifyMcpReachable(MCP_URL, 'user-key'),
      ).resolves.toBeUndefined();
      // Exercises the agent's exact path: bearer auth on the MCP URL.
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(MCP_URL);
      expect((init as any).headers.authorization).toBe('Bearer user-key');
    });

    it('throws (400) when the tunnel is unreachable', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(
        verifyMcpReachable(MCP_URL, 'user-key'),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('throws (400) with an auth-specific message on 401', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: false, status: 401 } as any);
      await expect(verifyMcpReachable(MCP_URL, 'bad-key')).rejects.toThrow(
        /rejected the access key/,
      );
    });

    it('throws (400) when the URL is not the MCP endpoint (404)', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: false, status: 404 } as any);
      await expect(
        verifyMcpReachable(MCP_URL, 'user-key'),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  it('provisioning fails fast (no Anthropic calls) when MCP is unreachable', async () => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 404 } as any);
    const teamId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    registerTestAnthropicKey();

    await expect(
      provisionClickStackAgent({
        teamId: teamId as any,
        userId: userId as any,
        userAccessKey: 'user-access-key',
        name: 'x',
        model: 'claude-opus-4-8',
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Only the MCP preflight ran — no environment/vault/agent was created.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(MCP_URL);
    expect(await ManagedAgent.countDocuments({})).toBe(0);
  });

  describe('provisionClickStackAgent system-prompt seam', () => {
    const agentBodyFrom = (spy: jest.SpyInstance) =>
      JSON.parse(
        spy.mock.calls.find(([u]: any) => String(u).endsWith('/v1/agents'))![1]
          .body as string,
      );

    const seedKeyForProvision = async () => {
      const teamId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      registerTestAnthropicKey();
      return { teamId, userId };
    };

    it('provisions with the extension-resolved system prompt when one is registered', async () => {
      fetchSpy = mockAnthropic();
      const { teamId, userId } = await seedKeyForProvision();
      registerAgentRunExtension({
        name: 'sys-swap',
        onProvisionAgent: async ctx => ({
          systemPrompt: `EE SYSTEM PROMPT (extends: ${ctx.defaultSystemPrompt.slice(0, 10)}...)`,
        }),
      });

      await provisionClickStackAgent({
        teamId: teamId as any,
        userId: userId as any,
        userAccessKey: 'hdx_key',
        name: 'SRE Responder',
        model: 'claude-opus-4-8',
      });

      expect(agentBodyFrom(fetchSpy).system).toContain('EE SYSTEM PROMPT');
    });

    it('provisions with the OSS default system prompt when no extension overrides it', async () => {
      fetchSpy = mockAnthropic();
      const { teamId, userId } = await seedKeyForProvision();

      await provisionClickStackAgent({
        teamId: teamId as any,
        userId: userId as any,
        userAccessKey: 'hdx_key',
        name: 'SRE Responder',
        model: 'claude-opus-4-8',
      });

      expect(agentBodyFrom(fetchSpy).system).toContain('You are an SRE agent');
    });
  });

  // Seeds a team with a key + provisioned agent so startAgentSession has
  // something to work with.
  const seedAgent = async () => {
    const teamId = new mongoose.Types.ObjectId();
    registerTestAnthropicKey();
    await ManagedAgent.create({
      team: teamId,
      name: 'prod SRE',
      model: 'claude-opus-4-8',
      anthropicAgentId: 'agent_1',
      vaultId: 'vlt_1',
      environmentId: 'env_1',
      mcpServerUrl: MCP_URL,
    });
    return teamId;
  };

  const startArgs = (teamId: mongoose.Types.ObjectId, over = {}) => ({
    teamId: teamId as any,
    alertId: 'alert_1',
    eventId: 'evt_1',
    title: 'CPU high',
    prompt: 'investigate',
    deliverToUrl: SLACK_URL,
    ...over,
  });

  describe('startAgentSession', () => {
    const mockSessions = () =>
      jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const u = String(url);
        const body = (data: unknown) =>
          ({ ok: true, text: async () => JSON.stringify(data) }) as any;
        if (u.endsWith('/events')) return body({});
        if (u.endsWith('/v1/sessions')) return body({ id: 'sess_1' });
        throw new Error(`unexpected fetch to ${u}`);
      });

    // Like mockSessions but captures the kickoff events body and returns a
    // fixed session id, so the extension seam's resolved prompt is observable.
    let capturedEventsBody: any;
    const mockSessionsCapturing = () =>
      jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any, init: any) => {
          const u = String(url);
          const body = (data: unknown) =>
            ({ ok: true, text: async () => JSON.stringify(data) }) as any;
          if (u.endsWith('/events')) {
            capturedEventsBody = JSON.parse(init.body);
            return body({});
          }
          if (u.endsWith('/v1/sessions')) return body({ id: 'sesn_test' });
          throw new Error(`unexpected fetch to ${u}`);
        });

    it('starts a session, injects the prompt, and persists a running run', async () => {
      fetchSpy = mockSessions();
      const teamId = await seedAgent();

      const run = await startAgentSession(startArgs(teamId));

      expect(run).not.toBeNull();
      expect(run!.anthropicSessionId).toBe('sess_1');
      expect(run!.status).toBe('running');
      expect(run!.deliverToUrl).toBe(SLACK_URL);
      // Per-alert, per-cooldown-window key: alertId:eventId:<window bucket>.
      expect(run!.dedupeKey).toMatch(/^alert_1:evt_1:\d+$/);

      const calls = fetchSpy.mock.calls.map(([u]) => String(u));
      expect(calls).toContain('https://api.anthropic.com/v1/sessions');
      expect(calls.some(u => u.endsWith('/sessions/sess_1/events'))).toBe(true);
    });

    it('is idempotent per firing — a re-fire reuses the run, no second session', async () => {
      fetchSpy = mockSessions();
      const teamId = await seedAgent();

      const first = await startAgentSession(startArgs(teamId));
      const sessionPosts = () =>
        fetchSpy.mock.calls.filter(([u]: any) =>
          String(u).endsWith('/v1/sessions'),
        ).length;
      expect(sessionPosts()).toBe(1);

      const second = await startAgentSession(startArgs(teamId));
      expect(second!._id.toString()).toBe(first!._id.toString());
      expect(sessionPosts()).toBe(1); // no new session created
      expect(await AgentRun.countDocuments({})).toBe(1);
    });

    it('returns null (no API call) when the team has no provisioned agent', async () => {
      fetchSpy = mockSessions();
      const teamId = new mongoose.Types.ObjectId();

      const run = await startAgentSession(startArgs(teamId));
      expect(run).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects a non-Slack delivery URL before any API call', async () => {
      fetchSpy = mockSessions();
      const teamId = await seedAgent();
      await expect(
        startAgentSession(
          startArgs(teamId, { deliverToUrl: 'https://evil.example.com/x' }),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('applies session-start extensions: prompt suffix sent, metadata persisted', async () => {
      fetchSpy = mockSessionsCapturing();
      const teamId = await seedAgent();
      registerAgentRunExtension({
        name: 'fake-notebook',
        onSessionStart: async ctx => ({
          promptSuffix: `\nNOTEBOOK for ${ctx.anthropicSessionId}`,
          runMetadata: { notebookId: 'nb1' },
        }),
      });

      const run = await startAgentSession(
        startArgs(teamId, { eventId: 'e-ext-1', prompt: '{"p":1}' }),
      );

      expect(run).not.toBeNull();
      expect(run!.metadata).toEqual({ notebookId: 'nb1' });
      const kickoffText = capturedEventsBody.events[0].content[0].text;
      expect(kickoffText).toBe('{"p":1}\nNOTEBOOK for sesn_test');
    });

    it('lets an extension replace the kickoff prompt wholesale', async () => {
      fetchSpy = mockSessionsCapturing();
      const teamId = await seedAgent();
      registerAgentRunExtension({
        name: 'prompt-swap',
        onSessionStart: async () => ({ promptOverride: 'CUSTOM EE PROMPT' }),
      });

      const run = await startAgentSession(
        startArgs(teamId, { eventId: 'e-ext-3', prompt: '{"p":3}' }),
      );

      expect(run).not.toBeNull();
      const kickoffText = capturedEventsBody.events[0].content[0].text;
      expect(kickoffText).toBe('CUSTOM EE PROMPT');
    });

    it('starts the session unchanged when a session-start extension throws (fail-open)', async () => {
      fetchSpy = mockSessionsCapturing();
      const teamId = await seedAgent();
      registerAgentRunExtension({
        name: 'broken',
        onSessionStart: async () => {
          throw new Error('boom');
        },
      });

      const run = await startAgentSession(
        startArgs(teamId, { eventId: 'e-ext-2', prompt: '{"p":2}' }),
      );

      expect(run).not.toBeNull();
      expect(run!.status).toBe('running');
      expect(run!.metadata).toBeUndefined();
      const kickoffText = capturedEventsBody.events[0].content[0].text;
      expect(kickoffText).toBe('{"p":2}');
    });
  });

  describe('pollAndDeliverAgentSessions', () => {
    let slackSpy: jest.SpyInstance;
    beforeEach(() => {
      slackSpy = jest
        .spyOn(slack, 'postMessageToWebhook')
        .mockResolvedValue(undefined as any);
    });
    afterEach(() => slackSpy.mockRestore());

    const seedRun = async (over = {}) => {
      const teamId = new mongoose.Types.ObjectId();
      registerTestAnthropicKey();
      const agent = await ManagedAgent.create({
        team: teamId,
        name: 'a',
        model: 'm',
        anthropicAgentId: 'agent_1',
        vaultId: 'vlt_1',
        environmentId: 'env_1',
        mcpServerUrl: MCP_URL,
      });
      return AgentRun.create({
        team: teamId,
        managedAgent: agent._id,
        anthropicSessionId: 'sess_1',
        alertId: 'alert_1',
        status: 'running',
        deliverToUrl: SLACK_URL,
        dedupeKey: 'alert_1:evt_1',
        title: 'CPU high',
        ...over,
      });
    };

    it('delivers the summary to Slack and marks delivered when the session idled', async () => {
      await seedRun();
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any) => {
          const u = String(url);
          const body = (data: unknown) =>
            ({ ok: true, text: async () => JSON.stringify(data) }) as any;
          if (u.endsWith('/events'))
            return body({
              events: [
                {
                  type: 'agent.message',
                  content: [{ type: 'text', text: 'root cause: OOM' }],
                },
              ],
            });
          if (u.endsWith('/sessions/sess_1')) return body({ status: 'idle' });
          throw new Error(`unexpected fetch to ${u}`);
        });

      await pollAndDeliverAgentSessions();

      expect(slackSpy).toHaveBeenCalledTimes(1);
      const [url, payload] = slackSpy.mock.calls[0];
      expect(url).toBe(SLACK_URL);
      expect(JSON.stringify(payload)).toContain('root cause: OOM');
      const run = await AgentRun.findOne({});
      expect(run!.status).toBe('delivered');
      expect(run!.deliveredAt).toBeInstanceOf(Date);
    });

    it('leaves a still-running session untouched', async () => {
      await seedRun();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ status: 'running' }),
      } as any);

      await pollAndDeliverAgentSessions();

      expect(slackSpy).not.toHaveBeenCalled();
      const run = await AgentRun.findOne({});
      expect(run!.status).toBe('running');
    });

    it('does not re-process an already delivered run', async () => {
      await seedRun({ status: 'delivered' });
      fetchSpy = jest.spyOn(global, 'fetch');

      await pollAndDeliverAgentSessions();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(slackSpy).not.toHaveBeenCalled();
    });

    it('abandons a session that never idles past the max age', async () => {
      const run = await seedRun();
      // Backdate creation well past the 30m ceiling, bypassing timestamps.
      await AgentRun.collection.updateOne(
        { _id: run._id },
        { $set: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } },
      );
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ status: 'running' }),
      } as any);

      await pollAndDeliverAgentSessions();

      const fresh = await AgentRun.findById(run._id);
      expect(fresh!.status).toBe('failed');
      expect(slackSpy).not.toHaveBeenCalled();
    });

    // Mocks the session-status GET and the events GET for sess_1.
    const mockSession = (status: string, eventsData: unknown) =>
      jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const u = String(url);
        const body = (d: unknown) =>
          ({ ok: true, text: async () => JSON.stringify(d) }) as any;
        if (u.endsWith('/events')) return body(eventsData);
        if (u.endsWith('/sessions/sess_1')) return body({ status });
        throw new Error(`unexpected fetch to ${u}`);
      });

    const msg = (text: string) => ({
      events: [{ type: 'agent.message', content: [{ type: 'text', text }] }],
    });

    it('retries (stays running) when an idled session has no readable summary yet', async () => {
      await seedRun();
      fetchSpy = mockSession('idle', { events: [] });

      await pollAndDeliverAgentSessions();

      expect(slackSpy).not.toHaveBeenCalled();
      const run = await AgentRun.findOne({});
      expect(run!.status).toBe('running');
      expect(run!.attempts).toBe(1);
    });

    it('delivers a placeholder once the empty-summary attempt cap is reached', async () => {
      await seedRun({ attempts: 4 }); // claim bumps to 5 = MAX_DELIVERY_ATTEMPTS
      fetchSpy = mockSession('idle', { events: [] });

      await pollAndDeliverAgentSessions();

      expect(slackSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(slackSpy.mock.calls[0][1])).toContain(
        'no summary text',
      );
      expect((await AgentRun.findOne({}))!.status).toBe('delivered');
    });

    it('concatenates the text blocks of only the final agent message', async () => {
      await seedRun();
      fetchSpy = mockSession('idle', {
        data: [
          { type: 'agent.message', content: [{ type: 'text', text: 'first' }] },
          {
            type: 'agent.message',
            content: [
              { type: 'tool_use' },
              { type: 'text', text: 'part A' },
              { type: 'text', text: 'part B' },
            ],
          },
        ],
      });

      await pollAndDeliverAgentSessions();

      const payload = JSON.stringify(slackSpy.mock.calls[0][1]);
      expect(payload).toContain('part A');
      expect(payload).toContain('part B');
      expect(payload).not.toContain('first'); // only the last message is used
    });

    it('releases the run for retry when Slack delivery fails below the cap', async () => {
      await seedRun();
      slackSpy.mockRejectedValue(new Error('slack 404'));
      fetchSpy = mockSession('idle', msg('rca'));

      await pollAndDeliverAgentSessions();

      const run = await AgentRun.findOne({});
      expect(run!.status).toBe('running');
      expect(run!.attempts).toBe(1);
    });

    it('fails with the real Slack error after the delivery cap', async () => {
      await seedRun({ attempts: 4 });
      slackSpy.mockRejectedValue(new Error('slack 404'));
      fetchSpy = mockSession('idle', msg('rca'));

      await pollAndDeliverAgentSessions();

      const run = await AgentRun.findOne({});
      expect(run!.status).toBe('failed');
      expect(run!.error).toContain('Slack delivery failed');
    });

    it('abandons a run whose session GET keeps failing once too old', async () => {
      const run = await seedRun();
      await AgentRun.collection.updateOne(
        { _id: run._id },
        { $set: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } },
      );
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('anthropic 500'));

      await pollAndDeliverAgentSessions();

      const fresh = await AgentRun.findById(run._id);
      expect(fresh!.status).toBe('failed');
      expect(fresh!.error).toContain('Session polling kept failing');
    });

    it('reclaims a stale delivering run and redelivers it', async () => {
      const run = await seedRun({ status: 'delivering' });
      // Backdate updatedAt past the reclaim window so it is picked up.
      await AgentRun.collection.updateOne(
        { _id: run._id },
        { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } },
      );
      fetchSpy = mockSession('idle', msg('rca'));

      await pollAndDeliverAgentSessions();

      expect(slackSpy).toHaveBeenCalledTimes(1);
      expect((await AgentRun.findById(run._id))!.status).toBe('delivered');
    });

    it('passes the run and summary to delivery extensions and renders their links', async () => {
      const run = await seedRun({ metadata: { notebookId: 'n1' } });
      const seen: any[] = [];
      registerAgentRunExtension({
        name: 'fake-notebook',
        onBeforeDelivery: async ctx => {
          seen.push({ metadata: ctx.run.metadata, summary: ctx.summary });
          return {
            footerLinks: [
              { label: 'Notebook', url: 'https://hdx.example/notebook/n1' },
            ],
          };
        },
      });
      fetchSpy = mockSession('idle', msg('rca'));

      await pollAndDeliverAgentSessions();

      expect(seen).toHaveLength(1);
      expect(seen[0].metadata).toEqual({ notebookId: 'n1' });
      expect(seen[0].summary).toBeTruthy();
      const slackBody = slackSpy.mock.calls[0][1] as any;
      const footer = slackBody.blocks.at(-1).elements[0].text;
      expect(footer).toContain('<https://hdx.example/notebook/n1|Notebook>');
      expect((await AgentRun.findById(run._id))!.status).toBe('delivered');
    });

    it('delivers even when a delivery extension throws (fail-open)', async () => {
      const run = await seedRun();
      registerAgentRunExtension({
        name: 'broken',
        onBeforeDelivery: async () => {
          throw new Error('boom');
        },
      });
      fetchSpy = mockSession('idle', msg('rca'));

      await pollAndDeliverAgentSessions();

      expect(slackSpy).toHaveBeenCalledTimes(1);
      expect((await AgentRun.findById(run._id))!.status).toBe('delivered');
    });
  });
});
