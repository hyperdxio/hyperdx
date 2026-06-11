import { ObjectId } from 'mongodb';

import * as config from '@/config';
import { getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';

describe('connections router', () => {
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

  it('only returns connections belonging to the current team through GET /connections', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    await Connection.create({
      team: team._id,
      name: 'My Team Connection',
      host: config.CLICKHOUSE_HOST,
      username: 'default',
      password: '',
    });
    await Connection.create({
      team: new ObjectId(),
      name: 'Other Team Connection',
      host: config.CLICKHOUSE_HOST,
      username: 'default',
      password: '',
    });

    const res = await agent.get('/connections').expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('My Team Connection');
  });

  it('persists prometheusEndpoint through POST /connections', async () => {
    const { agent } = await getLoggedInAgent(server);

    const res = await agent
      .post('/connections')
      .send({
        name: 'Prom-enabled',
        host: config.CLICKHOUSE_HOST,
        username: 'default',
        password: '',
        prometheusEndpoint: 'http://prom.example.com',
      })
      .expect(200);

    const stored = await Connection.findById(res.body.id).select(
      '+prometheusEndpoint',
    );
    expect(stored?.prometheusEndpoint).toBe('http://prom.example.com');
  });

  it('rejects invalid prometheusEndpoint URLs with 400', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent
      .post('/connections')
      .send({
        name: 'Bad-URL',
        host: config.CLICKHOUSE_HOST,
        username: 'default',
        password: '',
        prometheusEndpoint: 'not-a-url',
      })
      .expect(400);
  });

  it('persists prometheusEndpoint through PUT /connections/:id', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const created = await Connection.create({
      team: team._id,
      name: 'No-prom',
      host: config.CLICKHOUSE_HOST,
      username: 'default',
      password: '',
    });

    await agent
      .put(`/connections/${created._id.toString()}`)
      .send({
        id: created._id.toString(),
        name: 'No-prom',
        host: config.CLICKHOUSE_HOST,
        username: 'default',
        password: '',
        prometheusEndpoint: 'http://prom-new.example.com',
      })
      .expect(200);

    const stored = await Connection.findById(created._id).select(
      '+prometheusEndpoint',
    );
    expect(stored?.prometheusEndpoint).toBe('http://prom-new.example.com');
  });
});
