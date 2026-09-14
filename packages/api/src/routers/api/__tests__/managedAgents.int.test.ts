import { getLoggedInAgent, getServer, randomMongoId } from '@/fixtures';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
import ManagedAgent from '@/models/managedAgent';
import { registerAgentRunExtension } from '@/services/agentRunExtensions';
import { resetAgentRunExtensionsForTests } from '@/services/agentRunExtensions';

describe('managed agents router', () => {
  const server = getServer();
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];
  let team: Awaited<ReturnType<typeof getLoggedInAgent>>['team'];
  let user: Awaited<ReturnType<typeof getLoggedInAgent>>['user'];
  let fetchSpy: jest.SpyInstance;
  const originalMcpUrl = process.env.HDX_MANAGED_AGENTS_MCP_URL;
  // Anthropic only accepts a public HTTPS MCP URL; the test FRONTEND_URL is
  // http, so importing would fail the URL check before reaching the API.
  const MCP_URL = 'https://mcp.example.test/api/mcp';

  beforeAll(async () => {
    process.env.HDX_MANAGED_AGENTS_MCP_URL = MCP_URL;
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;
    // OSS resolves the Anthropic key from the environment, which is unset in
    // tests; this is the seam a downstream distribution uses for a per-team key.
    registerAgentRunExtension({
      name: 'test-key',
      resolveAnthropicKey: async () => ({ apiKey: 'sk-ant-key' }),
    });
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

  const seedAgent = () =>
    ManagedAgent.create({
      team: team._id,
      name: 'SRE Responder',
      model: 'claude-opus-4-8',
      anthropicAgentId: 'agent_1',
      vaultId: 'vlt_1',
      environmentId: 'env_1',
      mcpServerUrl: 'https://mcp.example.test/api/mcp',
    });

  describe('GET /managed-agents', () => {
    it('names the creator, whose access key the agent carries', async () => {
      await ManagedAgent.create({
        team: team._id,
        name: 'SRE Responder',
        model: 'claude-opus-4-8',
        anthropicAgentId: 'agent_1',
        vaultId: 'vlt_1',
        environmentId: 'env_1',
        mcpServerUrl: 'https://mcp.example.test/api/mcp',
        createdBy: user._id,
      });

      const resp = await agent.get('/managed-agents').expect(200);

      // Resolved to something displayable, not the raw ObjectId the UI would
      // otherwise print.
      expect(resp.body.data[0].createdBy).toEqual({
        name: user.name,
        email: user.email,
      });
    });

    it('omits the creator rather than leaking an id when it cannot be resolved', async () => {
      await seedAgent();

      const resp = await agent.get('/managed-agents').expect(200);

      expect(resp.body.data[0].createdBy).toBeUndefined();
    });

    it('returns the stored brief so agents are tellable apart', async () => {
      await ManagedAgent.create({
        team: team._id,
        name: 'DB specialist',
        model: 'claude-opus-4-8',
        instructions: 'Check replication lag first.',
        anthropicAgentId: 'agent_2',
        vaultId: 'vlt_2',
        environmentId: 'env_2',
        mcpServerUrl: 'https://mcp.example.test/api/mcp',
      });

      const resp = await agent.get('/managed-agents').expect(200);

      expect(resp.body.data[0].instructions).toBe(
        'Check replication lag first.',
      );
    });
  });

  describe('POST /managed-agents/import', () => {
    const body = { anthropicAgentId: 'agent_ext' };

    // The MCP reachability probe that provisioning also runs, plus whatever
    // Anthropic calls the test cares about.
    const mockAnthropic = (
      handler: (url: string, init: any) => Response | null,
    ) =>
      jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any, init: any) => {
          const u = String(url);
          if (!u.startsWith('https://api.anthropic.com')) {
            return new Response('{}'); // the MCP initialize probe
          }
          const handled = handler(u, init);
          if (handled) return handled;
          // A correctly-configured agent points at this instance's MCP server;
          // import rejects one that doesn't, so the default has to.
          if (init?.method !== 'DELETE' && /\/v1\/agents\/[^/]+$/.test(u)) {
            return new Response(
              JSON.stringify({
                id: 'agent_remote',
                mcp_servers: [{ url: MCP_URL }],
              }),
            );
          }
          return new Response('{"id":"generated"}');
        });

    it('links the agent and provisions the vault and environment it needs', async () => {
      const calls: string[] = [];
      fetchSpy = mockAnthropic((url, init) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.endsWith('/v1/environments'))
          return new Response('{"id":"env_new"}');
        if (url.endsWith('/v1/vaults')) return new Response('{"id":"vlt_new"}');
        if (url.includes('/v1/agents/'))
          return new Response(
            JSON.stringify({
              id: 'agent_ext',
              name: 'Hand-rolled responder',
              model: 'claude-opus-4-8',
              mcp_servers: [{ url: MCP_URL }],
            }),
          );
        return new Response('{}');
      });

      const resp = await agent
        .post('/managed-agents/import')
        .send(body)
        .expect(200);

      expect(resp.body.verified).toBe(true);
      // The user's agent object is read, never created or modified.
      expect(calls).toContain(
        'GET https://api.anthropic.com/v1/agents/agent_ext',
      );
      expect(calls).not.toContain('POST https://api.anthropic.com/v1/agents');
      const stored = await ManagedAgent.findOne({
        anthropicAgentId: 'agent_ext',
      });
      expect(stored?.imported).toBe(true);
      expect(stored?.environmentId).toBe('env_new');
      expect(stored?.vaultId).toBe('vlt_new');
      // Name and model are read from the agent object, not retyped, so they
      // can't drift from what Anthropic will actually run.
      expect(stored?.name).toBe('Hand-rolled responder');
      expect(stored?.model).toBe('claude-opus-4-8');
    });

    it('falls back to the ID for a name when the agent cannot be read', async () => {
      fetchSpy = mockAnthropic(url =>
        url.includes('/v1/agents/')
          ? new Response('boom', { status: 500 })
          : null,
      );

      await agent.post('/managed-agents/import').send(body).expect(200);

      const stored = await ManagedAgent.findOne({});
      expect(stored?.name).toBe('agent_ext');
      expect(stored?.model).toBeUndefined();
    });

    it('prefers a name the user supplied', async () => {
      fetchSpy = mockAnthropic(url =>
        url.includes('/v1/agents/')
          ? new Response(
              JSON.stringify({
                name: 'Anthropic name',
                mcp_servers: [{ url: MCP_URL }],
              }),
            )
          : null,
      );

      await agent
        .post('/managed-agents/import')
        .send({ ...body, name: 'Payments responder' })
        .expect(200);

      expect((await ManagedAgent.findOne({}))?.name).toBe('Payments responder');
    });

    it('rejects an agent ID Anthropic does not know', async () => {
      fetchSpy = mockAnthropic(url =>
        url.includes('/v1/agents/')
          ? new Response('nf', { status: 404 })
          : null,
      );

      const resp = await agent
        .post('/managed-agents/import')
        .send(body)
        .expect(400);

      expect(resp.body.message).toMatch(/agent_ext/);
      expect(await ManagedAgent.countDocuments({})).toBe(0);
    });

    // A verification outage shouldn't block an import the user can confirm
    // themselves — the response says it went in unverified.
    it('imports unverified when the check fails for another reason', async () => {
      fetchSpy = mockAnthropic(url =>
        url.includes('/v1/agents/')
          ? new Response('boom', { status: 500 })
          : null,
      );

      const resp = await agent
        .post('/managed-agents/import')
        .send(body)
        .expect(200);

      expect(resp.body.verified).toBe(false);
      expect(await ManagedAgent.countDocuments({})).toBe(1);
    });

    it('refuses to import the same agent twice', async () => {
      fetchSpy = mockAnthropic(() => null);
      await agent.post('/managed-agents/import').send(body).expect(200);

      const resp = await agent
        .post('/managed-agents/import')
        .send(body)
        .expect(409);

      expect(resp.body.message).toMatch(/already in the list/);
      expect(await ManagedAgent.countDocuments({})).toBe(1);
    });

    // validateRequest validates without replacing req.body, so anything the
    // handler spreads from it outranks what the session established.
    it('ignores team, user and access key supplied in the request body', async () => {
      const victimTeam = randomMongoId();
      const credentials: string[] = [];
      fetchSpy = mockAnthropic((url, init) => {
        if (url.includes('/credentials')) {
          credentials.push(String(JSON.parse(String(init?.body)).auth.token));
          return new Response('{"id":"cred_1"}');
        }
        return null;
      });

      await agent
        .post('/managed-agents/import')
        .send({
          ...body,
          teamId: victimTeam,
          userAccessKey: 'attacker-chosen-token',
        })
        .expect(200);

      // Landed in the caller's own team, with the caller's own key.
      expect(await ManagedAgent.countDocuments({ team: victimTeam })).toBe(0);
      expect(await ManagedAgent.countDocuments({ team: team._id })).toBe(1);
      expect(credentials).not.toContain('attacker-chosen-token');
    });

    it('refuses an agent pointed at a different MCP server', async () => {
      fetchSpy = mockAnthropic(url => {
        if (url.includes('/v1/agents/')) {
          return new Response(
            JSON.stringify({
              id: 'agent_x',
              name: 'Elsewhere',
              mcp_servers: [{ url: 'https://other-instance.test/api/mcp' }],
            }),
          );
        }
        return null;
      });

      const resp = await agent
        .post('/managed-agents/import')
        .send(body)
        .expect(400);

      expect(resp.body.message).toMatch(/other-instance\.test/);
      expect(await ManagedAgent.countDocuments({})).toBe(0);
    });

    it('refuses a verified agent with no MCP server at all', async () => {
      fetchSpy = mockAnthropic(url => {
        if (url.includes('/v1/agents/')) {
          return new Response(JSON.stringify({ id: 'agent_x', name: 'Bare' }));
        }
        return null;
      });

      const resp = await agent
        .post('/managed-agents/import')
        .send(body)
        .expect(400);

      expect(resp.body.message).toMatch(/no MCP server/);
      expect(await ManagedAgent.countDocuments({})).toBe(0);
    });

    it('refuses a verified agent whose mcp_servers list is empty', async () => {
      fetchSpy = mockAnthropic(url =>
        url.includes('/v1/agents/')
          ? new Response(JSON.stringify({ id: 'agent_x', mcp_servers: [] }))
          : null,
      );

      const resp = await agent
        .post('/managed-agents/import')
        .send(body)
        .expect(400);

      expect(resp.body.message).toMatch(/no MCP server/);
      expect(await ManagedAgent.countDocuments({})).toBe(0);
    });

    it('rejects an agent id that is not a flat identifier', async () => {
      await agent
        .post('/managed-agents/import')
        .send({ ...body, anthropicAgentId: '../vaults/vlt_other' })
        .expect(400);
      expect(await ManagedAgent.countDocuments({})).toBe(0);
    });

    // The preflight check is check-then-act. Two imports of the same agent can
    // both pass it, and each provisions a vault holding a live ClickStack key
    // — only one of which stays reachable to tear down.
    it('lets only one of two concurrent imports of the same agent win', async () => {
      const deleted: string[] = [];
      fetchSpy = mockAnthropic((url, init) => {
        if (init?.method === 'DELETE') {
          deleted.push(url);
          return new Response('{}');
        }
        return null;
      });

      const [a, b] = await Promise.all([
        agent.post('/managed-agents/import').send(body),
        agent.post('/managed-agents/import').send(body),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await ManagedAgent.countDocuments({})).toBe(1);
      // The loser tore its own environment and vault down rather than leaving
      // a credential behind that nothing points at.
      expect(deleted.some(u => u.includes('/v1/vaults/'))).toBe(true);
      expect(deleted.some(u => u.includes('/v1/environments/'))).toBe(true);
    });

    it('rolls the vault back if the environment or credential fails', async () => {
      const deleted: string[] = [];
      fetchSpy = mockAnthropic((url, init) => {
        if (init?.method === 'DELETE') {
          deleted.push(url);
          return new Response('{}');
        }
        if (url.endsWith('/v1/vaults')) return new Response('{"id":"vlt_new"}');
        if (url.includes('/credentials'))
          return new Response('nope', { status: 500 });
        return null;
      });

      await agent.post('/managed-agents/import').send(body).expect(502);

      expect(deleted.some(u => u.endsWith('/v1/vaults/vlt_new'))).toBe(true);
      expect(await ManagedAgent.countDocuments({})).toBe(0);
    });
  });

  describe('DELETE /managed-agents/:id', () => {
    it('deletes the agent, vault and environment on Anthropic before dropping the record', async () => {
      const managedAgent = await seedAgent();
      const deleted: string[] = [];
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any, init: any) => {
          if (init?.method === 'DELETE') deleted.push(String(url));
          return new Response('{}');
        });

      await agent
        .delete(`/managed-agents/${managedAgent._id.toString()}`)
        .expect(200);

      expect(deleted.some(u => u.endsWith('/v1/agents/agent_1'))).toBe(true);
      expect(deleted.some(u => u.endsWith('/v1/vaults/vlt_1'))).toBe(true);
      expect(deleted.some(u => u.endsWith('/v1/environments/env_1'))).toBe(
        true,
      );
      expect(await ManagedAgent.countDocuments({})).toBe(0);
    });

    // The record is the only pointer to those Anthropic resources. Dropping it
    // after a failed teardown would strand a live vault holding the team's
    // ClickStack access key with nothing left to clean it up.
    it('keeps the record and reports the leftovers when Anthropic rejects the delete', async () => {
      const managedAgent = await seedAgent();
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any) =>
          String(url).includes('/v1/vaults/')
            ? new Response('nope', { status: 500 })
            : new Response('{}'),
        );

      const resp = await agent
        .delete(`/managed-agents/${managedAgent._id.toString()}`)
        .expect(502);

      expect(resp.body.message).toMatch(/vault/);
      expect(await ManagedAgent.countDocuments({})).toBe(1);
    });

    it('retrying after a partial failure finishes the job', async () => {
      const managedAgent = await seedAgent();
      // The vault is gone from the first attempt, so it now answers 404 —
      // which counts as deleted.
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any) =>
          String(url).includes('/v1/vaults/')
            ? new Response('nf', { status: 404 })
            : new Response('{}'),
        );

      await agent
        .delete(`/managed-agents/${managedAgent._id.toString()}`)
        .expect(200);

      expect(await ManagedAgent.countDocuments({})).toBe(0);
    });

    // The agent object is the user's work; only what HyperDX made goes.
    it('leaves an imported agent on Anthropic and removes what it provisioned', async () => {
      const managedAgent = await seedAgent();
      await ManagedAgent.updateOne(
        { _id: managedAgent._id },
        { imported: true },
      );
      const deleted: string[] = [];
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url: any, init: any) => {
          if (init?.method === 'DELETE') deleted.push(String(url));
          return new Response('{}');
        });

      await agent
        .delete(`/managed-agents/${managedAgent._id.toString()}`)
        .expect(200);

      expect(deleted.some(u => u.endsWith('/v1/agents/agent_1'))).toBe(false);
      expect(deleted.some(u => u.endsWith('/v1/vaults/vlt_1'))).toBe(true);
      expect(deleted.some(u => u.endsWith('/v1/environments/env_1'))).toBe(
        true,
      );
      expect(await ManagedAgent.countDocuments({})).toBe(0);
    });

    // The app's ky hook redirects to /login on any 401, so forwarding
    // Anthropic's would read as an expired HyperDX session and log the user out.
    it('does not forward an upstream 401, which would log the user out', async () => {
      const managedAgent = await seedAgent();
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(
          async () => new Response('bad key', { status: 401 }),
        );

      const resp = await agent
        .delete(`/managed-agents/${managedAgent._id.toString()}`)
        .expect(502);

      expect(resp.body.message).toBeTruthy();
      expect(await ManagedAgent.countDocuments({})).toBe(1);
    });

    it('refuses to delete an agent an alert still targets', async () => {
      const managedAgent = await seedAgent();
      await Alert.create({
        team: team._id,
        source: AlertSource.SAVED_SEARCH,
        savedSearch: randomMongoId(),
        channel: { type: 'agent', agentId: managedAgent._id.toString() },
        interval: '15m',
        threshold: 1,
        thresholdType: AlertThresholdType.ABOVE,
      });
      fetchSpy = jest.spyOn(global, 'fetch');

      const resp = await agent
        .delete(`/managed-agents/${managedAgent._id.toString()}`)
        .expect(409);

      expect(resp.body.message).toMatch(/1 alert/);
      // Nothing was torn down on Anthropic, and the record survives.
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await ManagedAgent.countDocuments({})).toBe(1);
    });

    it("refuses to delete another team's agent", async () => {
      const managedAgent = await seedAgent();
      await ManagedAgent.updateOne(
        { _id: managedAgent._id },
        { team: '000000000000000000000001' },
      );
      fetchSpy = jest.spyOn(global, 'fetch');

      await agent
        .delete(`/managed-agents/${managedAgent._id.toString()}`)
        .expect(404);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await ManagedAgent.countDocuments({})).toBe(1);
    });
  });
});
