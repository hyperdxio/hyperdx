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

  it('persists isPrometheusEndpoint through POST /connections', async () => {
    const { agent } = await getLoggedInAgent(server);

    const res = await agent
      .post('/connections')
      .send({
        name: 'Prom-enabled',
        host: 'http://thanos:10902',
        username: '',
        password: '',
        isPrometheusEndpoint: true,
      })
      .expect(200);

    const stored = await Connection.findById(res.body.id);
    expect(stored?.host).toBe('http://thanos:10902');
    expect(stored?.isPrometheusEndpoint).toBe(true);
  });

  it('persists isPrometheusEndpoint through PUT /connections/:id', async () => {
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
        host: 'http://thanos:10902',
        username: '',
        password: '',
        isPrometheusEndpoint: true,
      })
      .expect(200);

    const stored = await Connection.findById(created._id);
    expect(stored?.host).toBe('http://thanos:10902');
    expect(stored?.isPrometheusEndpoint).toBe(true);
  });

  it('toggles isPrometheusEndpoint back to false through PUT', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const created = await Connection.create({
      team: team._id,
      name: 'Prom',
      host: 'http://thanos:10902',
      username: '',
      password: '',
      isPrometheusEndpoint: true,
    });

    await agent
      .put(`/connections/${created._id.toString()}`)
      .send({
        id: created._id.toString(),
        name: 'Prom',
        host: config.CLICKHOUSE_HOST,
        username: 'default',
        password: '',
        isPrometheusEndpoint: false,
      })
      .expect(200);

    const stored = await Connection.findById(created._id);
    expect(stored?.host).toBe(config.CLICKHOUSE_HOST);
    expect(stored?.isPrometheusEndpoint).toBe(false);
  });
});
