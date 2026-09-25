import { getLoggedInAgent, getServer } from '@/fixtures';

jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  DIAGNOSTICS_ENABLED: false,
}));

describe('diagnostics router, when disabled', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('is not mounted', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent.get('/diagnostics/report').expect(404);
    await agent.post('/diagnostics/cpu-profile?seconds=1').expect(404);
  });
});
