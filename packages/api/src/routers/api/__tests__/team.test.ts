import _ from 'lodash';

import { getLoggedInAgent, getServer } from '@/fixtures';

describe('team router', () => {
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

  it('GET /team', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent.get('/team').expect(200);

    expect(_.omit(resp.body, ['_id', 'apiKey'])).toMatchInlineSnapshot(`
Object {
  "allowedAuthMethods": Array [],
  "name": "fake@deploysentinel.com's Team",
  "sentryDSN": "",
  "teamInvites": Array [],
  "users": Array [
    Object {
      "email": "fake@deploysentinel.com",
      "hasPasswordAuth": true,
      "isCurrentUser": true,
      "name": "fake@deploysentinel.com",
    },
  ],
}
`);
  });

  it('GET /team/tags - no tags', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent.get('/team/tags').expect(200);

    expect(resp.body.data).toMatchInlineSnapshot(`Array []`);
  });

  it('GET /team/tags', async () => {
    const { agent } = await getLoggedInAgent(server);
    await agent
      .post('/dashboards')
      .send({
        name: 'Test',
        charts: [],
        query: '',
        tags: ['test', 'test'], // make sure we dedupe
      })
      .expect(200);
    await agent
      .post('/log-views')
      .send({
        name: 'Test',
        query: '',
        tags: ['test2'],
      })
      .expect(200);
    const resp = await agent.get('/team/tags').expect(200);
    expect(resp.body.data).toStrictEqual(['test', 'test2']);
  });
});
