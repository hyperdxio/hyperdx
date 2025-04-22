import * as clickhouse from '@/clickhouse';
import { getLoggedInAgent, getServer } from '@/fixtures';

describe.skip('external api v1', () => {
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

  it('GET /api/v1', async () => {
    const { agent, user } = await getLoggedInAgent(server);
    const resp = await agent
      .get(`/api/v1`)
      .set('Authorization', `Bearer ${user?.accessKey}`)
      .expect(200);
    expect(resp.body.version).toEqual('v1');
    expect(resp.body.user._id).toEqual(user?._id.toString());
  });
});
