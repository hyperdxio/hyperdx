import {
  getLoggedInAgent,
  getServer,
  makeSavedSearchAlertInput,
} from '@/fixtures';
import Alert from '@/models/alert';
import { SavedSearch } from '@/models/savedSearch';
import User from '@/models/user';
import Webhook, { WebhookDocument, WebhookService } from '@/models/webhook';

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
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];
  let team: Awaited<ReturnType<typeof getLoggedInAgent>>['team'];
  let user: Awaited<ReturnType<typeof getLoggedInAgent>>['user'];
  let webhook: WebhookDocument;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;
    webhook = await Webhook.create({
      name: 'Test Webhook',
      service: WebhookService.Slack,
      url: 'https://hooks.slack.com/test',
      team: team._id,
    });
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('can create a saved search', async () => {
    const savedSearch = await agent
      .post('/saved-search')
      .send(MOCK_SAVED_SEARCH)
      .expect(200);
    expect(savedSearch.body.name).toBe(MOCK_SAVED_SEARCH.name);
    expect(savedSearch.body.source).toBe(MOCK_SAVED_SEARCH.source);
  });

  it('cannot create a saved search with empty name', async () => {
    await agent
      .post('/saved-search')
      .send({ ...MOCK_SAVED_SEARCH, name: ' ' }) // Trimmed string will be empty and invalid
      .expect(400);
  });

  it('can update a saved search', async () => {
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
    await agent.post('/saved-search').send(MOCK_SAVED_SEARCH).expect(200);
    const savedSearches = await agent.get('/saved-search').expect(200);
    expect(savedSearches.body.length).toBe(1);
    expect(savedSearches.body[0].name).toBe(MOCK_SAVED_SEARCH.name);
  });

  it('can delete a saved search', async () => {
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
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);
    await agent.delete(`/saved-search/${savedSearch.body._id}`).expect(204);
    const savedSearches = await agent.get('/saved-search').expect(200);
    expect(savedSearches.body.length).toBe(0);
    expect(await Alert.findById(alert.body.data._id)).toBeNull();
  });

  it('sets createdBy and updatedBy on create and populates them in GET', async () => {
    const created = await agent
      .post('/saved-search')
      .send(MOCK_SAVED_SEARCH)
      .expect(200);

    // GET all saved searches
    const savedSearches = await agent.get('/saved-search').expect(200);
    const savedSearch = savedSearches.body.find(
      s => s._id === created.body._id,
    );
    expect(savedSearch.createdBy).toMatchObject({ email: user.email });
    expect(savedSearch.updatedBy).toMatchObject({ email: user.email });
  });

  it('populates updatedBy with a different user after DB update', async () => {
    const created = await agent
      .post('/saved-search')
      .send(MOCK_SAVED_SEARCH)
      .expect(200);

    // Create a second user on the same team
    const secondUser = await User.create({
      email: 'second@test.com',
      name: 'Second User',
      team: team._id,
    });

    // Simulate a different user updating the saved search
    await SavedSearch.findByIdAndUpdate(created.body._id, {
      updatedBy: secondUser._id,
    });

    const savedSearches = await agent.get('/saved-search').expect(200);
    const savedSearch = savedSearches.body.find(
      s => s._id === created.body._id,
    );
    expect(savedSearch.createdBy).toMatchObject({ email: user.email });
    expect(savedSearch.updatedBy).toMatchObject({
      email: 'second@test.com',
    });
  });

  it('updates updatedBy when updating a saved search via API', async () => {
    const created = await agent
      .post('/saved-search')
      .send(MOCK_SAVED_SEARCH)
      .expect(200);

    await agent
      .patch(`/saved-search/${created.body._id}`)
      .send({ name: 'updated name' })
      .expect(200);

    // Verify updatedBy is still set in the DB
    const dbRecord = await SavedSearch.findById(created.body._id);
    expect(dbRecord?.updatedBy?.toString()).toBe(user._id.toString());
    expect(dbRecord?.createdBy?.toString()).toBe(user._id.toString());
  });

  it('sets createdBy on alerts created from a saved search and populates it in list', async () => {
    // Create a saved search
    const savedSearch = await agent
      .post('/saved-search')
      .send(MOCK_SAVED_SEARCH)
      .expect(200);

    // Create an alert associated to the saved search
    const alert = await agent
      .post('/alerts')
      .send(
        makeSavedSearchAlertInput({
          savedSearchId: savedSearch.body._id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);

    // Verify createdBy was set on the alert document
    const alertFromDb = await Alert.findById(alert.body.data._id);
    expect(alertFromDb).toBeDefined();
    expect(alertFromDb!.createdBy).toEqual(user._id);

    // Verify GET /saved-search returns alerts with createdBy populated
    const savedSearches = await agent.get('/saved-search').expect(200);
    expect(savedSearches.body.length).toBe(1);
    expect(savedSearches.body[0].alerts).toBeDefined();
    expect(savedSearches.body[0].alerts.length).toBe(1);
    expect(savedSearches.body[0].alerts[0].id).toBeDefined();
    expect(savedSearches.body[0].alerts[0].createdBy).toBeDefined();
    expect(savedSearches.body[0].alerts[0].createdBy.email).toBe(user.email);
  });
});
