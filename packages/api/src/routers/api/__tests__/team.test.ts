import _ from 'lodash';

import {
  clearDBCollections,
  closeDB,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';

describe('team router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await server.closeHttpServer();
    await closeDB();
  });

  it('GET /team', async () => {
    const { agent } = await getLoggedInAgent(server);

    const resp = await agent.get('/team').expect(200);

    expect(_.omit(resp.body, ['_id', 'apiKey'])).toMatchInlineSnapshot(`
Object {
  "allowedAuthMethods": Array [],
  "name": "fake@deploysentinel.com's Team",
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
});
