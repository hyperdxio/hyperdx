import mongoose from 'mongoose';

import {
  getLoggedInAgent,
  getServer,
  makeAlertInput,
  makeTile,
} from '@/fixtures';
import ManagedAgent from '@/models/managedAgent';

// The rest of the agent-channel suites run with the flag on (.env.test); this
// file mocks it off to pin the two flag-off behaviours: alert saves carrying an
// agent channel are rejected, and the managed-agents surface 404s.
jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  IS_MANAGED_AGENTS_ENABLED: false,
}));

const MOCK_TILES = [makeTile()];
const MOCK_DASHBOARD = {
  id: new mongoose.Types.ObjectId().toString(),
  name: 'Test Dashboard',
  tiles: MOCK_TILES,
  tags: ['test'],
};

describe('managed agents disabled', () => {
  const server = getServer();
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];
  let team: Awaited<ReturnType<typeof getLoggedInAgent>>['team'];

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('rejects saving an alert with an agent channel', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const managedAgent = await ManagedAgent.create({
      team: team._id,
      name: 'SRE Responder',
      model: 'claude-opus-4-8',
      anthropicAgentId: 'agent_1',
      vaultId: 'vlt_1',
      environmentId: 'env_1',
      mcpServerUrl: 'https://mcp.example.test/api/mcp',
    });

    const resp = await agent
      .post('/alerts')
      .send({
        ...makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
        }),
        channel: { type: 'agent', agentId: managedAgent._id.toString() },
      })
      .expect(400);
    expect(resp.text).toContain('not enabled');
  });

  it('404s the managed-agents surface', async () => {
    await agent.get('/managed-agents').expect(404);
  });
});
