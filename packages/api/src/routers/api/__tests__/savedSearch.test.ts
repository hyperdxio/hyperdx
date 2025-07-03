import {
  getLoggedInAgent,
  getServer,
  makeSavedSearchAlertInput,
} from '@/fixtures';
import Alert from '@/models/alert';

const MOCK_SAVED_SEARCH = {
  name: 'error',
  select: 'Timestamp, ServiceName, SeverityText, Body',
  where: 'SeverityText:error',
  whereLanguage: 'lucene',
  source: '679b12d6cf282580fc63aad4',
  orderBy: 'TimestampTime DESC',
  tags: [],
};

describe('savedSearch router', () => {
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

  it('can create a saved search', async () => {
    const { agent } = await getLoggedInAgent(server);
    const savedSearch = await agent
      .post('/saved-search')
      .send(MOCK_SAVED_SEARCH)
      .expect(200);
    expect(savedSearch.body.name).toBe(MOCK_SAVED_SEARCH.name);
    expect(savedSearch.body.source).toBe(MOCK_SAVED_SEARCH.source);
  });

  it('cannot create a saved search with empty name', async () => {
    const { agent } = await getLoggedInAgent(server);
    await agent
      .post('/saved-search')
      .send({ ...MOCK_SAVED_SEARCH, name: ' ' }) // Trimmed string will be empty and invalid
      .expect(400);
  });

  it('can update a saved search', async () => {
    const { agent } = await getLoggedInAgent(server);
    const savedSearch = await agent
      .post('/saved-search')
      .send(MOCK_SAVED_SEARCH)
      .expect(200);
    const updatedSavedSearch = await agent
      .patch(`/saved-search/${savedSearch.body._id}`)
      .send({ name: 'warning' })
      .expect(200);
    expect(updatedSavedSearch.body.name).toBe('warning');
  });

  it('cannot update a saved search with empty name', async () => {
    const { agent } = await getLoggedInAgent(server);
    const savedSearch = await agent
      .post('/saved-search')
      .send(MOCK_SAVED_SEARCH)
      .expect(200);
    await agent
      .patch(`/saved-search/${savedSearch.body._id}`)
      .send({ name: ' ' }) // Trimmed string will be empty and invalid
      .expect(400);
  });

  it('can update a saved search with undefined name', async () => {
    const { agent } = await getLoggedInAgent(server);
    const savedSearch = await agent
      .post('/saved-search')
      .send(MOCK_SAVED_SEARCH)
      .expect(200);
    const updatedSavedSearch = await agent
      .patch(`/saved-search/${savedSearch.body._id}`)
      .send({ name: undefined, select: 'SELECT 1' }) // Name is optional
      .expect(200);
    expect(updatedSavedSearch.body.select).toBe('SELECT 1');
  });

  it('can get saved searches', async () => {
    const { agent } = await getLoggedInAgent(server);
    await agent.post('/saved-search').send(MOCK_SAVED_SEARCH).expect(200);
    const savedSearches = await agent.get('/saved-search').expect(200);
    expect(savedSearches.body.length).toBe(1);
    expect(savedSearches.body[0].name).toBe(MOCK_SAVED_SEARCH.name);
  });

  it('can delete a saved search', async () => {
    const { agent } = await getLoggedInAgent(server);
    const savedSearch = await agent
      .post('/saved-search')
      .send(MOCK_SAVED_SEARCH)
      .expect(200);
    // add an alert
    const alert = await agent
      .post('/alerts')
      .send(
        makeSavedSearchAlertInput({
          savedSearchId: savedSearch.body._id,
        }),
      )
      .expect(200);
    await agent.delete(`/saved-search/${savedSearch.body._id}`).expect(204);
    const savedSearches = await agent.get('/saved-search').expect(200);
    expect(savedSearches.body.length).toBe(0);
    expect(await Alert.findById(alert.body.data._id)).toBeNull();
  });
});
