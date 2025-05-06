import { getLoggedInAgent, getServer } from '../../../fixtures';

describe('external api v2', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET /api/v2', async () => {
    const { agent, user } = await getLoggedInAgent(server);
    const resp = await agent
      .get(`/api/v2`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);
    expect(resp.body.version).toEqual('v2');
    expect(resp.body.user._id).toEqual(user?._id.toString());
  });
});
