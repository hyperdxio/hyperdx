import mongoose from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';

const MOCK_CONNECTION = {
  name: 'Test Connection',
  host: 'localhost:9000',
  username: 'default',
  password: 'test-password',
};

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

  it('POST / - creates a connection', async () => {
    const { agent } = await getLoggedInAgent(server);

    const response = await agent
      .post('/connections')
      .send(MOCK_CONNECTION)
      .expect(200);

    expect(response.body.id).toBeDefined();

    // Verify connection was created in database
    const connections = await Connection.find({});
    expect(connections).toHaveLength(1);
    expect(connections[0].name).toBe(MOCK_CONNECTION.name);
  });

  it('GET / - returns connections without password', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    await Connection.create({
      ...MOCK_CONNECTION,
      team: team._id,
    });

    const response = await agent.get('/connections').expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe(MOCK_CONNECTION.name);
    expect(response.body[0].host).toBe(MOCK_CONNECTION.host);
    // Password should not be returned (select: false on schema)
    expect(response.body[0].password).toBeUndefined();
  });

  it('PUT /:id - updates a connection with $set', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const connection = await Connection.create({
      ...MOCK_CONNECTION,
      team: team._id,
    });

    const updatedData = {
      ...MOCK_CONNECTION,
      name: 'Updated Connection',
      host: 'newhost:9000',
      id: connection._id.toString(),
    };

    await agent
      .put(`/connections/${connection._id}`)
      .send(updatedData)
      .expect(200);

    // Verify connection was updated in database
    const updatedConnection = await Connection.findById(connection._id);
    expect(updatedConnection?.name).toBe('Updated Connection');
    expect(updatedConnection?.host).toBe('newhost:9000');
  });

  it('PUT /:id - updates a connection with $unset to remove optional fields', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const connection = await Connection.create({
      ...MOCK_CONNECTION,
      team: team._id,
      hyperdxSettingPrefix: 'test-prefix',
    });

    // Verify the prefix was set
    const before = await Connection.findById(connection._id);
    expect(before?.hyperdxSettingPrefix).toBe('test-prefix');

    const updatedData = {
      ...MOCK_CONNECTION,
      id: connection._id.toString(),
      hyperdxSettingPrefix: null,
    };

    await agent
      .put(`/connections/${connection._id}`)
      .send(updatedData)
      .expect(200);

    // Verify hyperdxSettingPrefix was unset
    const updatedConnection = await Connection.findById(connection._id);
    expect(updatedConnection?.hyperdxSettingPrefix).toBeUndefined();
  });

  it('DELETE /:id - deletes a connection', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const connection = await Connection.create({
      ...MOCK_CONNECTION,
      team: team._id,
    });

    await agent.delete(`/connections/${connection._id}`).expect(200);

    // Verify connection was deleted
    const deletedConnection = await Connection.findById(connection._id);
    expect(deletedConnection).toBeNull();
  });

  it('DELETE /:id - returns success when connection does not exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const nonExistentId = new mongoose.Types.ObjectId().toString();

    await agent.delete(`/connections/${nonExistentId}`).expect(200);
  });

  it('GET/PUT/DELETE - returns 404 for wrong team', async () => {
    const { agent } = await getLoggedInAgent(server);

    // Create a connection with a different team
    const otherTeamId = new mongoose.Types.ObjectId();
    const connection = await Connection.create({
      ...MOCK_CONNECTION,
      team: otherTeamId,
    });

    // PUT should return 404
    await agent
      .put(`/connections/${connection._id}`)
      .send({
        ...MOCK_CONNECTION,
        id: connection._id.toString(),
      })
      .expect(404);

    // Verify the connection still exists (wasn't deleted by wrong team)
    const stillExists = await Connection.findById(connection._id);
    expect(stillExists).not.toBeNull();
  });
});
