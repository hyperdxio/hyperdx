import { ObjectId } from 'mongodb';
import request, { SuperAgentTest } from 'supertest';

import { getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';
import { ITeam } from '@/models/team';
import { IUser } from '@/models/user';

const CONNECTIONS_BASE_URL = '/api/v2/connections';

const MOCK_CONNECTION = {
  name: 'Test Connection',
  host: 'https://clickhouse.example.com:8443',
  username: 'default',
  password: 'test-password',
};

describe('External API v2 Connections', () => {
  const server = getServer();
  let agent: SuperAgentTest;
  let team: ITeam;
  let user: IUser;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  const authRequest = (
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
  ) => {
    return agent[method](url).set('Authorization', `Bearer ${user?.accessKey}`);
  };

  describe('GET /api/v2/connections', () => {
    it('should return an empty list when no connections exist', async () => {
      const response = await authRequest('get', CONNECTIONS_BASE_URL).expect(
        200,
      );

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toEqual({ data: [] });
    });

    it('should list connections without exposing passwords', async () => {
      await Connection.create({ ...MOCK_CONNECTION, team: team._id });

      const response = await authRequest('get', CONNECTIONS_BASE_URL).expect(
        200,
      );

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        id: expect.any(String),
        name: MOCK_CONNECTION.name,
        host: MOCK_CONNECTION.host,
        username: MOCK_CONNECTION.username,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(response.body.data[0]).not.toHaveProperty('password');
      expect(response.body.data[0]).not.toHaveProperty('team');
    });

    it('should not return connections belonging to another team', async () => {
      await Connection.create({ ...MOCK_CONNECTION, team: team._id });

      const otherTeamId = new ObjectId();
      await Connection.create({
        ...MOCK_CONNECTION,
        name: 'Other Team Connection',
        team: otherTeamId,
      });

      const response = await authRequest('get', CONNECTIONS_BASE_URL).expect(
        200,
      );

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe(MOCK_CONNECTION.name);
    });

    it('should require authentication', async () => {
      await request(server.getHttpServer())
        .get(CONNECTIONS_BASE_URL)
        .expect(401);
    });
  });

  describe('GET /api/v2/connections/:id', () => {
    it('should return a connection by id without the password', async () => {
      const connection = await Connection.create({
        ...MOCK_CONNECTION,
        team: team._id,
      });

      const response = await authRequest(
        'get',
        `${CONNECTIONS_BASE_URL}/${connection._id}`,
      ).expect(200);

      expect(response.body.data).toMatchObject({
        id: connection._id.toString(),
        name: MOCK_CONNECTION.name,
        host: MOCK_CONNECTION.host,
        username: MOCK_CONNECTION.username,
      });
      expect(response.body.data).not.toHaveProperty('password');
    });

    it('should return 404 for a non-existent connection', async () => {
      await authRequest(
        'get',
        `${CONNECTIONS_BASE_URL}/${new ObjectId()}`,
      ).expect(404);
    });

    it('should return 404 for a connection belonging to another team', async () => {
      const otherTeamConnection = await Connection.create({
        ...MOCK_CONNECTION,
        team: new ObjectId(),
      });

      await authRequest(
        'get',
        `${CONNECTIONS_BASE_URL}/${otherTeamConnection._id}`,
      ).expect(404);
    });

    it('should return 400 for an invalid connection id', async () => {
      await authRequest('get', `${CONNECTIONS_BASE_URL}/not-an-id`).expect(400);
    });

    it('should require authentication', async () => {
      await request(server.getHttpServer())
        .get(`${CONNECTIONS_BASE_URL}/${new ObjectId()}`)
        .expect(401);
    });
  });

  describe('POST /api/v2/connections', () => {
    it('should create a connection and return it without the password', async () => {
      const response = await authRequest('post', CONNECTIONS_BASE_URL)
        .send(MOCK_CONNECTION)
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: expect.any(String),
        name: MOCK_CONNECTION.name,
        host: MOCK_CONNECTION.host,
        username: MOCK_CONNECTION.username,
      });
      expect(response.body.data).not.toHaveProperty('password');

      const stored = await Connection.findById(response.body.data.id).select(
        '+password',
      );
      expect(stored).not.toBeNull();
      expect(stored?.password).toBe(MOCK_CONNECTION.password);
      expect(stored?.team.toString()).toBe(team._id.toString());
    });

    it('should create a connection without a password', async () => {
      const { password, ...connectionWithoutPassword } = MOCK_CONNECTION;

      const response = await authRequest('post', CONNECTIONS_BASE_URL)
        .send(connectionWithoutPassword)
        .expect(200);

      const stored = await Connection.findById(response.body.data.id).select(
        '+password',
      );
      expect(stored?.password).toBe('');
    });

    it('should create a connection with optional fields', async () => {
      const response = await authRequest('post', CONNECTIONS_BASE_URL)
        .send({
          ...MOCK_CONNECTION,
          hyperdxSettingPrefix: 'hyperdx_',
        })
        .expect(200);

      expect(response.body.data).toMatchObject({
        hyperdxSettingPrefix: 'hyperdx_',
      });
    });

    it('should reject a request with missing required fields', async () => {
      await authRequest('post', CONNECTIONS_BASE_URL)
        .send({ name: 'Missing host and username' })
        .expect(400);
    });

    it('should create a Prometheus-compatible connection', async () => {
      const response = await authRequest('post', CONNECTIONS_BASE_URL)
        .send({
          name: 'Thanos',
          host: 'http://thanos:10902',
          username: '',
          password: '',
          isPrometheusEndpoint: true,
        })
        .expect(200);

      expect(response.body.data).toMatchObject({
        name: 'Thanos',
        host: 'http://thanos:10902',
        isPrometheusEndpoint: true,
      });
    });

    it('should require authentication', async () => {
      await request(server.getHttpServer())
        .post(CONNECTIONS_BASE_URL)
        .send(MOCK_CONNECTION)
        .expect(401);
    });
  });

  describe('PUT /api/v2/connections/:id', () => {
    it('should update a connection', async () => {
      const connection = await Connection.create({
        ...MOCK_CONNECTION,
        team: team._id,
      });

      const response = await authRequest(
        'put',
        `${CONNECTIONS_BASE_URL}/${connection._id}`,
      )
        .send({
          name: 'Updated Connection',
          host: 'https://clickhouse-updated.example.com:8443',
          username: 'updated-user',
        })
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: connection._id.toString(),
        name: 'Updated Connection',
        host: 'https://clickhouse-updated.example.com:8443',
        username: 'updated-user',
      });
      expect(response.body.data).not.toHaveProperty('password');
    });

    it('should keep the existing password when omitted', async () => {
      const connection = await Connection.create({
        ...MOCK_CONNECTION,
        team: team._id,
      });

      await authRequest('put', `${CONNECTIONS_BASE_URL}/${connection._id}`)
        .send({
          name: 'Updated Connection',
          host: MOCK_CONNECTION.host,
          username: MOCK_CONNECTION.username,
        })
        .expect(200);

      const stored = await Connection.findById(connection._id).select(
        '+password',
      );
      expect(stored?.password).toBe(MOCK_CONNECTION.password);
    });

    it('should update the password when provided', async () => {
      const connection = await Connection.create({
        ...MOCK_CONNECTION,
        team: team._id,
      });

      await authRequest('put', `${CONNECTIONS_BASE_URL}/${connection._id}`)
        .send({ ...MOCK_CONNECTION, password: 'new-password' })
        .expect(200);

      const stored = await Connection.findById(connection._id).select(
        '+password',
      );
      expect(stored?.password).toBe('new-password');
    });

    it('should clear hyperdxSettingPrefix when set to an empty string', async () => {
      const connection = await Connection.create({
        ...MOCK_CONNECTION,
        hyperdxSettingPrefix: 'hyperdx_',
        team: team._id,
      });

      await authRequest('put', `${CONNECTIONS_BASE_URL}/${connection._id}`)
        .send({ ...MOCK_CONNECTION, hyperdxSettingPrefix: '' })
        .expect(200);

      const stored = await Connection.findById(connection._id);
      expect(stored?.hyperdxSettingPrefix).toBeUndefined();
    });

    it('should clear hyperdxSettingPrefix when set to null', async () => {
      const connection = await Connection.create({
        ...MOCK_CONNECTION,
        hyperdxSettingPrefix: 'hyperdx_',
        team: team._id,
      });

      await authRequest('put', `${CONNECTIONS_BASE_URL}/${connection._id}`)
        .send({ ...MOCK_CONNECTION, hyperdxSettingPrefix: null })
        .expect(200);

      const stored = await Connection.findById(connection._id);
      expect(stored?.hyperdxSettingPrefix).toBeUndefined();
    });

    it('should toggle isPrometheusEndpoint', async () => {
      const connection = await Connection.create({
        ...MOCK_CONNECTION,
        team: team._id,
      });

      await authRequest('put', `${CONNECTIONS_BASE_URL}/${connection._id}`)
        .send({
          ...MOCK_CONNECTION,
          host: 'http://thanos:10902',
          isPrometheusEndpoint: true,
        })
        .expect(200);

      const stored = await Connection.findById(connection._id);
      expect(stored?.host).toBe('http://thanos:10902');
      expect(stored?.isPrometheusEndpoint).toBe(true);
    });

    it('should keep hyperdxSettingPrefix unchanged when omitted', async () => {
      const connection = await Connection.create({
        ...MOCK_CONNECTION,
        hyperdxSettingPrefix: 'hyperdx_',
        team: team._id,
      });

      await authRequest('put', `${CONNECTIONS_BASE_URL}/${connection._id}`)
        .send({
          name: 'Updated Connection',
          host: MOCK_CONNECTION.host,
          username: MOCK_CONNECTION.username,
        })
        .expect(200);

      const stored = await Connection.findById(connection._id);
      expect(stored?.hyperdxSettingPrefix).toBe('hyperdx_');
    });

    it('should return 404 for a non-existent connection', async () => {
      await authRequest('put', `${CONNECTIONS_BASE_URL}/${new ObjectId()}`)
        .send(MOCK_CONNECTION)
        .expect(404);
    });

    it('should return 404 for a connection belonging to another team', async () => {
      const otherTeamConnection = await Connection.create({
        ...MOCK_CONNECTION,
        team: new ObjectId(),
      });

      await authRequest(
        'put',
        `${CONNECTIONS_BASE_URL}/${otherTeamConnection._id}`,
      )
        .send(MOCK_CONNECTION)
        .expect(404);
    });

    it('should reject a request with missing required fields', async () => {
      const connection = await Connection.create({
        ...MOCK_CONNECTION,
        team: team._id,
      });

      await authRequest('put', `${CONNECTIONS_BASE_URL}/${connection._id}`)
        .send({ name: 'Missing host and username' })
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(server.getHttpServer())
        .put(`${CONNECTIONS_BASE_URL}/${new ObjectId()}`)
        .send(MOCK_CONNECTION)
        .expect(401);
    });
  });

  describe('DELETE /api/v2/connections/:id', () => {
    it('should delete a connection', async () => {
      const connection = await Connection.create({
        ...MOCK_CONNECTION,
        team: team._id,
      });

      await authRequest(
        'delete',
        `${CONNECTIONS_BASE_URL}/${connection._id}`,
      ).expect(200);

      expect(await Connection.findById(connection._id)).toBeNull();
    });

    it('should return 404 for a non-existent connection', async () => {
      await authRequest(
        'delete',
        `${CONNECTIONS_BASE_URL}/${new ObjectId()}`,
      ).expect(404);
    });

    it('should not delete a connection belonging to another team', async () => {
      const otherTeamConnection = await Connection.create({
        ...MOCK_CONNECTION,
        team: new ObjectId(),
      });

      await authRequest(
        'delete',
        `${CONNECTIONS_BASE_URL}/${otherTeamConnection._id}`,
      ).expect(404);

      expect(await Connection.findById(otherTeamConnection._id)).not.toBeNull();
    });

    it('should require authentication', async () => {
      await request(server.getHttpServer())
        .delete(`${CONNECTIONS_BASE_URL}/${new ObjectId()}`)
        .expect(401);
    });
  });
});
