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
  deleteAnthropicAgent,
  getTeamAnthropicKey,
  provisionClickStackAgent,
  startAgentSession,
  verifyMcpReachable,
} from '@/services/anthropicAgents';
import logger from '@/utils/logger';

// Anthropic requires an HTTPS MCP URL; provisioning resolves it from this env.
const MCP_URL = 'https://mcp.example.test/api/mcp';

// The team's Anthropic key is resolved via the resolveAnthropicKey extension
// seam (OSS falls back to env, which is unset in tests). Registering this
// resolver is how a downstream distribution injects a per-team key; afterEach
// resets the registry.
const registerTestAnthropicKey = (apiKey = 'sk-ant-key') =>
  registerAgentRunExtension({
    name: 'test-key',
    resolveAnthropicKey: async () => ({ apiKey }),
  });

// Sequenced Anthropic responses keyed by URL substring.
const mockAnthropic = () =>
  jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
    const u = String(url);
    const body = (data: unknown) => new Response(JSON.stringify(data));
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
  const originalMcpUrl = process.env.HDX_MANAGED_AGENTS_MCP_URL;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    process.env.HDX_MANAGED_AGENTS_MCP_URL = MCP_URL;
    await server.start();
  });
  afterEach(async () => {
    fetchSpy?.mockRestore();
    resetAgentRunExtensionsForTests();
    await server.clearDBs();
  });
  afterAll(async () => {
    process.env.HDX_MANAGED_AGENTS_MCP_URL = originalMcpUrl;
    await server.stop();
  });

  it('getTeamAnthropicKey returns null when no key is configured (no env, no resolver)', async () => {
    const teamId = new mongoose.Types.ObjectId();
    expect(await getTeamAnthropicKey(teamId)).toBeNull();
  });

  it('getTeamAnthropicKey returns the key from a registered resolver extension', async () => {
    registerTestAnthropicKey('sk-ant-resolved');
    const teamId = new mongoose.Types.ObjectId();
    expect(await getTeamAnthropicKey(teamId)).toBe('sk-ant-resolved');
  });

  it('registers no extensions by default (OSS ships an empty registration point)', async () => {
    // Importing the service pulls in @/extensions as a side effect; the OSS
    // stub must leave the registry empty so behaviour is unchanged.
    expect(
      await runSessionStartExtensions({
        teamId: 't',
        agent: new ManagedAgent({ name: 'x' }),
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
      teamId,
      userId,
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
        String(calls.find(([u]) => String(u).includes(substr))![1].body),
      );
    const credBody = bodyOf('/credentials');
    const agentBody = bodyOf('/v1/agents');
    expect(credBody.auth.mcp_server_url).toBe(MCP_URL);
    expect(agentBody.mcp_servers[0].url).toBe(MCP_URL);
    expect(credBody.auth.token).toBe('user-access-key');

    // Only read tools are auto-approved. An unattended session can never
    // answer an approval prompt, so leaving the default at always_ask is what
    // stops the MCP server's save/delete/patch tools firing from an alert.
    const mcpToolset = agentBody.tools.find(
      (t: any) => t.type === 'mcp_toolset',
    );
    expect(mcpToolset.default_config.permission_policy.type).toBe('always_ask');

    const autoAllowed: string[] = mcpToolset.configs
      .filter((c: any) => c.permission_policy.type === 'always_allow')
      .map((c: any) => c.name);
    expect(autoAllowed).toContain('clickstack_search');
    expect(
      autoAllowed.filter((name: string) =>
        /^clickstack_(save|delete|patch)_/.test(name),
      ),
    ).toEqual([]);

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
        teamId,
        userId,
        userAccessKey: 'k',
        name: 'x',
        model: 'claude-opus-4-8',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('surfaces an Anthropic API failure as AnthropicApiError', async () => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('bad key', { status: 401 }));
    const teamId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    registerTestAnthropicKey('sk-ant-bad');
    await expect(
      provisionClickStackAgent({
        teamId,
        userId,
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
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('nf', { status: 404 }));
      const teamId = await seedKey();

      await expect(
        deleteAnthropicAgent(teamId, 'agent_gone'),
      ).resolves.toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    // The caller drops the local record on success, and that record is the
    // only pointer to these resources — so a failed teardown has to surface,
    // not warn quietly.
    it('throws, naming what is left on Anthropic, when a delete fails', async () => {
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any) =>
          String(url).includes('/v1/vaults/')
            ? new Response('boom', { status: 500 })
            : new Response('{}'),
        );
      const teamId = await seedKey();

      await expect(
        deleteAnthropicAgent(teamId, 'agent_x', {
          vaultId: 'vlt_1',
          environmentId: 'env_1',
        }),
      ).rejects.toThrow(/vault/);
      warn.mockRestore();
    });

    it('throws rather than pretending when no Anthropic key is configured', async () => {
      fetchSpy = jest.spyOn(global, 'fetch');
      const teamId = new mongoose.Types.ObjectId();

      await expect(
        deleteAnthropicAgent(teamId, 'agent_x', { vaultId: 'vlt_1' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    // Retrying after a partial failure must converge: the resources already
    // gone answer 404, which counts as deleted.
    it('resolves when every resource is already absent', async () => {
      // A fresh Response per call: a single instance's body can only be read
      // once, so the second delete would fail on a consumed body rather than
      // the 404 under test.
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async () => new Response('nf', { status: 404 }));
      const teamId = await seedKey();

      await expect(
        deleteAnthropicAgent(teamId, 'agent_x', {
          vaultId: 'vlt_1',
          environmentId: 'env_1',
        }),
      ).resolves.toBeUndefined();
    });

    it('also deletes the vault and environment so the ClickStack credential is not orphaned', async () => {
      const deleted: string[] = [];
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any, init: any) => {
          if (init?.method === 'DELETE') deleted.push(String(url));
          return new Response('{}');
        });
      const teamId = await seedKey();

      await deleteAnthropicAgent(teamId, 'agent_1', {
        vaultId: 'vlt_1',
        environmentId: 'env_1',
      });

      expect(deleted.some(u => u.endsWith('/v1/agents/agent_1'))).toBe(true);
      expect(deleted.some(u => u.endsWith('/v1/vaults/vlt_1'))).toBe(true);
      expect(deleted.some(u => u.endsWith('/v1/environments/env_1'))).toBe(
        true,
      );
    });
  });

  describe('verifyMcpReachable', () => {
    it('passes when the MCP server answers a non-401 response', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      await expect(
        verifyMcpReachable(MCP_URL, 'user-key'),
      ).resolves.toBeUndefined();
      // Exercises the agent's exact path: bearer auth on the MCP URL.
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(MCP_URL);
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer user-key',
      });
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
        .mockResolvedValue(new Response(null, { status: 401 }));
      await expect(verifyMcpReachable(MCP_URL, 'bad-key')).rejects.toThrow(
        /rejected the access key/,
      );
    });

    it('throws (400) when the URL is not the MCP endpoint (404)', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 404 }));
      await expect(
        verifyMcpReachable(MCP_URL, 'user-key'),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  it('provisioning fails fast (no Anthropic calls) when MCP is unreachable', async () => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 404 }));
    const teamId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    registerTestAnthropicKey();

    await expect(
      provisionClickStackAgent({
        teamId,
        userId,
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
        String(
          spy.mock.calls.find(([u]: any) =>
            String(u).endsWith('/v1/agents'),
          )![1].body,
        ),
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
          systemPrompt: `CUSTOM SYSTEM PROMPT (extends: ${ctx.defaultSystemPrompt.slice(0, 10)}...)`,
        }),
      });

      await provisionClickStackAgent({
        teamId,
        userId,
        userAccessKey: 'hdx_key',
        name: 'SRE Responder',
        model: 'claude-opus-4-8',
      });

      expect(agentBodyFrom(fetchSpy).system).toContain('CUSTOM SYSTEM PROMPT');
    });

    // A team brief is what makes a second agent worth having; it must reach
    // the Anthropic agent object, and must not displace the standing contract
    // that keeps the agent read-only.
    it('appends the team brief to the standing prompt', async () => {
      fetchSpy = mockAnthropic();
      const { teamId, userId } = await seedKeyForProvision();

      const agent = await provisionClickStackAgent({
        teamId,
        userId,
        userAccessKey: 'hdx_key',
        name: 'DB specialist',
        model: 'claude-opus-4-8',
        instructions: 'Check ClickHouse replication lag first.',
      });

      const sent = agentBodyFrom(fetchSpy).system;
      expect(sent).toContain('You are an SRE agent');
      expect(sent).toContain('Check ClickHouse replication lag first.');
      expect(sent).toContain('Do not make changes to production systems.');
      expect(agent.instructions).toBe(
        'Check ClickHouse replication lag first.',
      );
    });

    it('leaves the prompt untouched when no brief is given', async () => {
      fetchSpy = mockAnthropic();
      const { teamId, userId } = await seedKeyForProvision();

      const agent = await provisionClickStackAgent({
        teamId,
        userId,
        userAccessKey: 'hdx_key',
        name: 'Generalist',
        model: 'claude-opus-4-8',
        instructions: '   ',
      });

      expect(agentBodyFrom(fetchSpy).system).not.toContain('Team instructions');
      expect(agent.instructions).toBeUndefined();
    });

    it('provisions with the OSS default system prompt when no extension overrides it', async () => {
      fetchSpy = mockAnthropic();
      const { teamId, userId } = await seedKeyForProvision();

      await provisionClickStackAgent({
        teamId,
        userId,
        userAccessKey: 'hdx_key',
        name: 'SRE Responder',
        model: 'claude-opus-4-8',
      });

      expect(agentBodyFrom(fetchSpy).system).toContain('You are an SRE agent');
    });

    it('rolls back the created environment and vault when agent creation fails', async () => {
      const deleted: string[] = [];
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any, init: any) => {
          const u = String(url);
          const ok = (data: unknown) => new Response(JSON.stringify(data));
          if (u === MCP_URL) return ok({ ok: true });
          if (init?.method === 'DELETE') {
            deleted.push(u);
            return ok({});
          }
          if (u.endsWith('/v1/environments')) return ok({ id: 'env_1' });
          if (u.endsWith('/v1/vaults')) return ok({ id: 'vlt_1' });
          if (u.includes('/credentials')) return ok({ id: 'cred_1' });
          // Agent creation fails (e.g. invalid model) after env + vault exist.
          if (u.endsWith('/v1/agents'))
            return new Response('bad model', { status: 400 });
          throw new Error(`unexpected fetch to ${u}`);
        });
      const { teamId, userId } = await seedKeyForProvision();

      await expect(
        provisionClickStackAgent({
          teamId,
          userId,
          userAccessKey: 'hdx_key',
          name: 'SRE Responder',
          model: 'bad-model',
        }),
      ).rejects.toBeInstanceOf(AnthropicApiError);

      // The already-created vault and environment are best-effort deleted, and
      // no local ManagedAgent record is persisted.
      expect(deleted.some(u => u.endsWith('/v1/vaults/vlt_1'))).toBe(true);
      expect(deleted.some(u => u.endsWith('/v1/environments/env_1'))).toBe(
        true,
      );
      expect(await ManagedAgent.countDocuments({})).toBe(0);
    });
  });

  // Seeds a team with a key + provisioned agent so startAgentSession has
  // something to work with.
  const seedAgent = async () => {
    const teamId = new mongoose.Types.ObjectId();
    registerTestAnthropicKey();
    const agent = await ManagedAgent.create({
      team: teamId,
      name: 'prod SRE',
      model: 'claude-opus-4-8',
      anthropicAgentId: 'agent_1',
      vaultId: 'vlt_1',
      environmentId: 'env_1',
      mcpServerUrl: MCP_URL,
    });
    return { teamId, agentId: agent._id.toString() };
  };

  describe('startAgentSession', () => {
    const startArgs = (
      teamId: mongoose.Types.ObjectId,
      agentId: string,
      over = {},
    ) => ({
      agentId,
      teamId,
      alertId: 'alert_1',
      eventId: 'evt_1',
      title: 'CPU high',
      prompt: 'investigate',
      ...over,
    });

    const mockSessions = () =>
      jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const u = String(url);
        const body = (data: unknown) => new Response(JSON.stringify(data));
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
          const body = (data: unknown) => new Response(JSON.stringify(data));
          if (u.endsWith('/events')) {
            capturedEventsBody = JSON.parse(init.body);
            return body({});
          }
          if (u.endsWith('/v1/sessions')) return body({ id: 'sesn_test' });
          throw new Error(`unexpected fetch to ${u}`);
        });

    it('starts a session, injects the prompt, and persists a run', async () => {
      fetchSpy = mockSessions();
      const { teamId, agentId } = await seedAgent();

      const { run, deduped } = await startAgentSession(
        startArgs(teamId, agentId),
      );

      expect(deduped).toBe(false);
      expect(run).not.toBeNull();
      expect(run!.anthropicSessionId).toBe('sess_1');
      expect(run!.alertId).toBe('alert_1');
      // Per-event, per-cooldown-window key: eventId:<window bucket>.
      // Per-alert, per-agent, per-window key — deliberately group-agnostic so
      // a high-cardinality grouped alert cannot fan out one session per group.
      expect(run!.dedupeKey).toMatch(/^alert_1:[0-9a-f]{24}:\d+$/);

      const calls = fetchSpy.mock.calls.map(([u]) => String(u));
      expect(calls).toContain('https://api.anthropic.com/v1/sessions');
      expect(calls.some(u => u.endsWith('/sessions/sess_1/events'))).toBe(true);
    });

    it('is idempotent per firing — a re-fire reuses the run, no second session', async () => {
      fetchSpy = mockSessions();
      const { teamId, agentId } = await seedAgent();

      const first = await startAgentSession(startArgs(teamId, agentId));
      const sessionPosts = () =>
        fetchSpy.mock.calls.filter(([u]: any) =>
          String(u).endsWith('/v1/sessions'),
        ).length;
      expect(sessionPosts()).toBe(1);

      const second = await startAgentSession(startArgs(teamId, agentId));
      expect(second.deduped).toBe(true);
      expect(second.run!._id.toString()).toBe(first.run!._id.toString());
      expect(sessionPosts()).toBe(1); // no new session created
      expect(await AgentRun.countDocuments({})).toBe(1);
    });

    it('collapses different events (groups) of the same alert into one session per window', async () => {
      fetchSpy = mockSessions();
      const { teamId, agentId } = await seedAgent();

      const first = await startAgentSession(
        startArgs(teamId, agentId, { eventId: 'evt_group_a' }),
      );
      const second = await startAgentSession(
        startArgs(teamId, agentId, { eventId: 'evt_group_b' }),
      );

      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.run!._id.toString()).toBe(first.run!._id.toString());
      expect(await AgentRun.countDocuments({})).toBe(1);
    });

    it('does not dedupe across different agents on the same alert', async () => {
      fetchSpy = mockSessions();
      const { teamId, agentId } = await seedAgent();
      const other = await ManagedAgent.create({
        team: teamId,
        name: 'second SRE',
        model: 'claude-opus-4-8',
        anthropicAgentId: 'agent_2',
        vaultId: 'vlt_2',
        environmentId: 'env_2',
        mcpServerUrl: MCP_URL,
      });

      const first = await startAgentSession(startArgs(teamId, agentId));
      const second = await startAgentSession(
        startArgs(teamId, other._id.toString()),
      );

      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(false);
      expect(await AgentRun.countDocuments({})).toBe(2);
    });

    it('throws (no session call) when the agent does not exist', async () => {
      fetchSpy = mockSessions();
      const { teamId } = await seedAgent();
      const missingAgentId = new mongoose.Types.ObjectId().toString();

      await expect(
        startAgentSession(startArgs(teamId, missingAgentId)),
      ).rejects.toThrow(/Managed agent not found/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws (no session call) when the agent belongs to another team', async () => {
      fetchSpy = mockSessions();
      const { agentId } = await seedAgent();
      const otherTeamId = new mongoose.Types.ObjectId();

      await expect(
        startAgentSession(startArgs(otherTeamId, agentId)),
      ).rejects.toThrow(/Managed agent not found/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('applies session-start extensions: prompt suffix sent, metadata persisted', async () => {
      fetchSpy = mockSessionsCapturing();
      const { teamId, agentId } = await seedAgent();
      registerAgentRunExtension({
        name: 'fake-notebook',
        onSessionStart: async ctx => ({
          promptSuffix: `\nNOTEBOOK for ${ctx.anthropicSessionId}`,
          runMetadata: { notebookId: 'nb1' },
        }),
      });

      const { run } = await startAgentSession(
        startArgs(teamId, agentId, { eventId: 'e-ext-1', prompt: '{"p":1}' }),
      );

      expect(run).not.toBeNull();
      expect(run!.metadata).toEqual({ notebookId: 'nb1' });
      const kickoffText = capturedEventsBody.events[0].content[0].text;
      expect(kickoffText).toBe('{"p":1}\nNOTEBOOK for sesn_test');
    });

    it('lets an extension replace the kickoff prompt wholesale', async () => {
      fetchSpy = mockSessionsCapturing();
      const { teamId, agentId } = await seedAgent();
      registerAgentRunExtension({
        name: 'prompt-swap',
        onSessionStart: async () => ({ promptOverride: 'CUSTOM PROMPT' }),
      });

      const { run } = await startAgentSession(
        startArgs(teamId, agentId, { eventId: 'e-ext-3', prompt: '{"p":3}' }),
      );

      expect(run).not.toBeNull();
      const kickoffText = capturedEventsBody.events[0].content[0].text;
      expect(kickoffText).toBe('CUSTOM PROMPT');
    });

    it('starts the session unchanged when a session-start extension throws (fail-open)', async () => {
      fetchSpy = mockSessionsCapturing();
      const { teamId, agentId } = await seedAgent();
      registerAgentRunExtension({
        name: 'broken',
        onSessionStart: async () => {
          throw new Error('boom');
        },
      });

      const { run } = await startAgentSession(
        startArgs(teamId, agentId, { eventId: 'e-ext-2', prompt: '{"p":2}' }),
      );

      expect(run).not.toBeNull();
      expect(run!.metadata).toBeUndefined();
      const kickoffText = capturedEventsBody.events[0].content[0].text;
      expect(kickoffText).toBe('{"p":2}');
    });

    it('cleans up the session when the kickoff events POST fails', async () => {
      const deleted: string[] = [];
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any, init: any) => {
          const u = String(url);
          const body = (data: unknown) => new Response(JSON.stringify(data));
          if (init?.method === 'DELETE') {
            deleted.push(u);
            return body({});
          }
          if (u.endsWith('/events'))
            return new Response('boom', { status: 500 });
          if (u.endsWith('/v1/sessions')) return body({ id: 'sess_1' });
          throw new Error(`unexpected fetch to ${u}`);
        });
      const { teamId, agentId } = await seedAgent();

      await expect(
        startAgentSession(startArgs(teamId, agentId)),
      ).rejects.toBeInstanceOf(AnthropicApiError);
      expect(deleted.some(u => u.endsWith('/v1/sessions/sess_1'))).toBe(true);
      expect(await AgentRun.countDocuments({})).toBe(0);
    });
  });
});
