import mongoose from 'mongoose';

import { getServer } from '@/fixtures';
import AnthropicIntegration from '@/models/anthropicIntegration';
import ManagedAgent from '@/models/managedAgent';
import {
  AnthropicApiError,
  getTeamAnthropicKey,
  provisionClickStackAgent,
} from '@/services/anthropicAgents';
import { encrypt } from '@/utils/encryption';

const KEY = 'b'.repeat(64);
// Anthropic requires an HTTPS MCP URL; provisioning resolves it from this env.
const MCP_URL = 'https://mcp.example.test/api/mcp';

// Sequenced Anthropic responses keyed by URL substring.
const mockAnthropic = () =>
  jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
    const u = String(url);
    const body = (data: unknown) =>
      ({ ok: true, text: async () => JSON.stringify(data) }) as any;
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
    await server.clearDBs();
  });
  afterAll(async () => {
    process.env.HDX_ENCRYPTION_KEY = originalKey;
    process.env.HDX_MANAGED_AGENTS_MCP_URL = originalMcpUrl;
    await server.stop();
  });

  it('getTeamAnthropicKey returns null when no integration exists', async () => {
    const teamId = new mongoose.Types.ObjectId();
    expect(await getTeamAnthropicKey(teamId as any)).toBeNull();
  });

  it('getTeamAnthropicKey decrypts the stored key', async () => {
    const teamId = new mongoose.Types.ObjectId();
    await AnthropicIntegration.create({
      team: teamId,
      encryptedApiKey: encrypt('sk-ant-stored'),
      keyHint: 'ored',
    });
    expect(await getTeamAnthropicKey(teamId as any)).toBe('sk-ant-stored');
  });

  it('provisions env + vault + credential + agent and persists the record', async () => {
    fetchSpy = mockAnthropic();
    const teamId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    await AnthropicIntegration.create({
      team: teamId,
      encryptedApiKey: encrypt('sk-ant-key'),
      keyHint: 'key0',
    });

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
    await AnthropicIntegration.create({
      team: teamId,
      encryptedApiKey: encrypt('sk-ant-bad'),
      keyHint: 'bad0',
    });
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
});
