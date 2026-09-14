import { getLoggedInAgent, getServer } from '@/fixtures';
import ManagedAgent from '@/models/managedAgent';

// Provisioning is gated separately from the feature itself, so a deployment can
// allow importing an agent without allowing one to be created. This pins that
// split: with the feature on and create off, POST / is refused while the rest
// of the surface still works.
jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  IS_MANAGED_AGENTS_ENABLED: true,
  IS_MANAGED_AGENT_CREATE_ENABLED: false,
}));

describe('managed agents with provisioning disabled', () => {
  const server = getServer();
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    ({ agent } = await getLoggedInAgent(server));
  });

  afterEach(async () => {
    fetchSpy?.mockRestore();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('refuses to provision an agent and never calls Anthropic', async () => {
    fetchSpy = jest.spyOn(global, 'fetch');

    const resp = await agent
      .post('/managed-agents')
      .send({ name: 'SRE Responder', model: 'claude-opus-4-8' })
      .expect(403);

    expect(resp.body.message).toMatch(/HDX_MANAGED_AGENTS_ALLOW_CREATE/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await ManagedAgent.countDocuments({})).toBe(0);
  });

  it('still lists agents, so the rest of the surface is unaffected', async () => {
    await agent.get('/managed-agents').expect(200);
  });
});
