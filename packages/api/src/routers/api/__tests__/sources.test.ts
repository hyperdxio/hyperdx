import { SourceKind } from '@berg/common-utils/dist/types';
import { Types } from 'mongoose';

import { getLoggedInAgent, getServer } from '@/fixtures';
import { ISourceInput, Source } from '@/models/source';

const MOCK_SOURCE: Omit<ISourceInput, 'id' | 'team'> = {
  kind: SourceKind.Table,
  name: 'Test Source',
  catalog: 'AwsDataCatalog',
  database: 'test_db',
  table: 'test_table',
  displayName: 'Test Source',
};

describe('sources router', () => {
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

  it('GET / - returns all sources for a team', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    await Source.create({
      ...MOCK_SOURCE,
      team: team._id,
    });

    const response = await agent.get('/sources').expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].kind).toBe(SourceKind.Table);
    expect(response.body[0].displayName).toBe('Test Source');
  });

  it('GET / - returns empty array when no sources exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const response = await agent.get('/sources').expect(200);

    expect(response.body).toEqual([]);
  });

  it('POST / - creates a new source', async () => {
    const { agent } = await getLoggedInAgent(server);

    const response = await agent.post('/sources').send(MOCK_SOURCE).expect(200);

    expect(response.body.kind).toBe(SourceKind.Table);
    expect(response.body.displayName).toBe('Test Source');
  });

  it('PUT /:id - updates an existing source', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const source = await Source.create({
      ...MOCK_SOURCE,
      team: team._id,
    });

    const updatedSource = {
      ...MOCK_SOURCE,
      id: source._id.toString(),
      displayName: 'Updated Display Name',
    };

    await agent.put(`/sources/${source._id}`).send(updatedSource).expect(200);

    const updatedSourceFromDB = await Source.findById(source._id);
    expect(updatedSourceFromDB?.displayName).toBe('Updated Display Name');
  });

  it('PUT /:id - returns 404 when source does not exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const nonExistentId = new Types.ObjectId().toString();

    await agent
      .put(`/sources/${nonExistentId}`)
      .send({
        ...MOCK_SOURCE,
        id: nonExistentId,
      })
      .expect(404);
  });

  it('DELETE /:id - deletes a source', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const source = await Source.create({
      ...MOCK_SOURCE,
      team: team._id,
    });

    await agent.delete(`/sources/${source._id}`).expect(200);

    const deletedSource = await Source.findById(source._id);
    expect(deletedSource).toBeNull();
  });

  it('DELETE /:id - returns 200 when source does not exist', async () => {
    const { agent } = await getLoggedInAgent(server);

    const nonExistentId = new Types.ObjectId().toString();

    await agent.delete(`/sources/${nonExistentId}`).expect(200);
  });
});
