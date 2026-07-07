import { ObjectId } from 'mongodb';
import request, { SuperAgentTest } from 'supertest';

import { getLoggedInAgent, getServer } from '@/fixtures';
import Alert from '@/models/alert';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import { ITeam } from '@/models/team';
import { IUser } from '@/models/user';

const BASE_URL = '/api/v2/saved-searches';

describe('External API v2 Saved Searches', () => {
  const server = getServer();
  let agent: SuperAgentTest;
  let team: ITeam;
  let user: IUser;
  let sourceId: string;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;

    // Create a source to use in tests
    const source = await Source.create({
      team: team._id,
      name: 'Test Source',
      kind: 'log',
      connection: new ObjectId(),
      from: { databaseName: 'otel', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
    });
    sourceId = source._id.toString();
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

  const mockSavedSearch = () => ({
    name: 'Test Saved Search',
    sourceId,
    where: 'SeverityText:ERROR',
    whereLanguage: 'lucene' as const,
    select: 'Timestamp,Body,ServiceName',
    orderBy: 'Timestamp DESC',
    tags: ['errors', 'production'],
  });

  describe('GET /api/v2/saved-searches', () => {
    it('returns empty list when none exist', async () => {
      const res = await authRequest('get', BASE_URL).expect(200);
      expect(res.body).toEqual({ data: [] });
    });

    it('lists saved searches for the team', async () => {
      await SavedSearch.create({
        team: team._id,
        source: new ObjectId(sourceId),
        name: 'My Search',
        where: 'level:error',
      });

      const res = await authRequest('get', BASE_URL).expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        id: expect.any(String),
        name: 'My Search',
        where: 'level:error',
        teamId: team._id.toString(),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(res.body.data[0]).not.toHaveProperty('team');
      expect(res.body.data[0]).not.toHaveProperty('_id');
    });

    it('does not return saved searches from another team', async () => {
      await SavedSearch.create({
        team: team._id,
        source: new ObjectId(sourceId),
        name: 'My Search',
      });
      await SavedSearch.create({
        team: new ObjectId(),
        source: new ObjectId(),
        name: 'Other Team Search',
      });

      const res = await authRequest('get', BASE_URL).expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('My Search');
    });

    it('requires authentication', async () => {
      await request(server.getHttpServer()).get(BASE_URL).expect(401);
    });
  });

  describe('GET /api/v2/saved-searches/:id', () => {
    it('returns a saved search by id', async () => {
      const doc = await SavedSearch.create({
        team: team._id,
        source: new ObjectId(sourceId),
        name: 'My Search',
        where: 'level:error',
        whereLanguage: 'lucene',
      });

      const res = await authRequest('get', `${BASE_URL}/${doc._id}`).expect(
        200,
      );
      expect(res.body.data).toMatchObject({
        id: doc._id.toString(),
        name: 'My Search',
        where: 'level:error',
        whereLanguage: 'lucene',
      });
    });

    it('returns 404 for non-existent id', async () => {
      await authRequest('get', `${BASE_URL}/${new ObjectId()}`).expect(404);
    });

    it("returns 404 for another team's saved search", async () => {
      const doc = await SavedSearch.create({
        team: new ObjectId(),
        source: new ObjectId(),
        name: 'Other Team',
      });
      await authRequest('get', `${BASE_URL}/${doc._id}`).expect(404);
    });

    it('returns 400 for invalid id', async () => {
      await authRequest('get', `${BASE_URL}/not-an-id`).expect(400);
    });

    it('requires authentication', async () => {
      await request(server.getHttpServer())
        .get(`${BASE_URL}/${new ObjectId()}`)
        .expect(401);
    });
  });

  describe('POST /api/v2/saved-searches', () => {
    it('creates a saved search', async () => {
      const payload = mockSavedSearch();
      const res = await authRequest('post', BASE_URL).send(payload).expect(200);

      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        name: payload.name,
        where: payload.where,
        whereLanguage: payload.whereLanguage,
        select: payload.select,
        orderBy: payload.orderBy,
        tags: payload.tags,
        sourceId,
        teamId: team._id.toString(),
      });

      const stored = await SavedSearch.findById(res.body.data.id);
      expect(stored?.team.toString()).toBe(team._id.toString());
    });

    it('creates a minimal saved search (name + sourceId only)', async () => {
      const res = await authRequest('post', BASE_URL)
        .send({ name: 'Minimal', sourceId })
        .expect(200);
      expect(res.body.data.name).toBe('Minimal');
    });

    it('rejects missing required fields', async () => {
      await authRequest('post', BASE_URL)
        .send({ name: 'No source' })
        .expect(400);
      await authRequest('post', BASE_URL).send({ sourceId }).expect(400);
    });

    it('rejects a sourceId belonging to another team', async () => {
      const otherSource = await Source.create({
        team: new ObjectId(),
        name: 'Other Team Source',
        kind: 'log',
        connection: new ObjectId(),
        from: { databaseName: 'otel', tableName: 'otel_logs' },
        timestampValueExpression: 'Timestamp',
      });
      await authRequest('post', BASE_URL)
        .send({ name: 'Cross team', sourceId: otherSource._id.toString() })
        .expect(400);
    });

    it('rejects a non-existent sourceId', async () => {
      await authRequest('post', BASE_URL)
        .send({ name: 'Bad source', sourceId: new ObjectId().toString() })
        .expect(400);
    });

    it('rejects a name that exceeds the max length', async () => {
      await authRequest('post', BASE_URL)
        .send({ name: 'a'.repeat(1025), sourceId })
        .expect(400);
    });

    it('rejects a where clause that exceeds the max length', async () => {
      await authRequest('post', BASE_URL)
        .send({ name: 'Too long where', sourceId, where: 'a'.repeat(8193) })
        .expect(400);
    });

    it('rejects too many tags', async () => {
      await authRequest('post', BASE_URL)
        .send({
          name: 'Too many tags',
          sourceId,
          tags: Array.from({ length: 51 }, (_, i) => `tag-${i}`),
        })
        .expect(400);
    });

    it('rejects an invalid whereLanguage value', async () => {
      await authRequest('post', BASE_URL)
        .send({ name: 'Bad lang', sourceId, whereLanguage: 'regex' })
        .expect(400);
    });

    it('persists createdBy and updatedBy audit metadata', async () => {
      const res = await authRequest('post', BASE_URL)
        .send({ name: 'Audited', sourceId })
        .expect(200);

      const stored = await SavedSearch.findById(res.body.data.id);
      expect(stored?.createdBy?.toString()).toBe(user._id.toString());
      expect(stored?.updatedBy?.toString()).toBe(user._id.toString());
    });

    it('defaults omitted where/select/tags to empty values', async () => {
      const res = await authRequest('post', BASE_URL)
        .send({ name: 'Defaults', sourceId })
        .expect(200);

      const stored = await SavedSearch.findById(res.body.data.id);
      expect(stored?.where).toBe('');
      expect(stored?.select).toBe('');
      expect(stored?.tags).toEqual([]);
    });

    it('requires authentication', async () => {
      await request(server.getHttpServer())
        .post(BASE_URL)
        .send(mockSavedSearch())
        .expect(401);
    });
  });

  describe('PUT /api/v2/saved-searches/:id', () => {
    it('updates a saved search', async () => {
      const doc = await SavedSearch.create({
        team: team._id,
        source: new ObjectId(sourceId),
        name: 'Original',
        where: 'level:info',
      });

      const res = await authRequest('put', `${BASE_URL}/${doc._id}`)
        .send({ name: 'Updated', sourceId, where: 'level:error' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: doc._id.toString(),
        name: 'Updated',
        where: 'level:error',
      });
    });

    it('returns 404 for non-existent id', async () => {
      await authRequest('put', `${BASE_URL}/${new ObjectId()}`)
        .send(mockSavedSearch())
        .expect(404);
    });

    it("returns 404 for another team's saved search", async () => {
      const doc = await SavedSearch.create({
        team: new ObjectId(),
        source: new ObjectId(),
        name: 'Other',
      });
      await authRequest('put', `${BASE_URL}/${doc._id}`)
        .send(mockSavedSearch())
        .expect(404);
    });

    it('rejects missing required fields', async () => {
      const doc = await SavedSearch.create({
        team: team._id,
        source: new ObjectId(sourceId),
        name: 'My Search',
      });
      await authRequest('put', `${BASE_URL}/${doc._id}`)
        .send({ name: 'No source' })
        .expect(400);
    });

    it('rejects a sourceId belonging to another team', async () => {
      const doc = await SavedSearch.create({
        team: team._id,
        source: new ObjectId(sourceId),
        name: 'My Search',
      });
      const otherSource = await Source.create({
        team: new ObjectId(),
        name: 'Other Team Source',
        kind: 'log',
        connection: new ObjectId(),
        from: { databaseName: 'otel', tableName: 'otel_logs' },
        timestampValueExpression: 'Timestamp',
      });
      await authRequest('put', `${BASE_URL}/${doc._id}`)
        .send({ name: 'Updated', sourceId: otherSource._id.toString() })
        .expect(400);
    });

    it('returns 400 for an invalid id', async () => {
      await authRequest('put', `${BASE_URL}/not-an-id`)
        .send(mockSavedSearch())
        .expect(400);
    });

    it('clears previously-set optional fields when omitted (full replace)', async () => {
      const doc = await SavedSearch.create({
        team: team._id,
        source: new ObjectId(sourceId),
        name: 'Original',
        where: 'level:info',
        whereLanguage: 'lucene',
        orderBy: 'Timestamp DESC',
        select: 'Body',
        tags: ['keep-me'],
      });

      // Omit whereLanguage, orderBy, filters, where, select and tags. Only the
      // required name + sourceId are supplied.
      const res = await authRequest('put', `${BASE_URL}/${doc._id}`)
        .send({ name: 'Replaced', sourceId })
        .expect(200);

      expect(res.body.data).toMatchObject({ name: 'Replaced' });

      const stored = await SavedSearch.findById(doc._id);
      // Defaulted fields are reset to empty values.
      expect(stored?.where).toBe('');
      expect(stored?.select).toBe('');
      expect(stored?.tags).toEqual([]);
      // Optional fields are cleared (unset), not merged.
      expect(stored?.whereLanguage == null).toBe(true);
      expect(stored?.orderBy == null).toBe(true);
    });

    it('persists updatedBy audit metadata on update', async () => {
      const doc = await SavedSearch.create({
        team: team._id,
        source: new ObjectId(sourceId),
        name: 'Original',
      });

      await authRequest('put', `${BASE_URL}/${doc._id}`)
        .send({ name: 'Updated', sourceId })
        .expect(200);

      const stored = await SavedSearch.findById(doc._id);
      expect(stored?.updatedBy?.toString()).toBe(user._id.toString());
    });

    it('requires authentication', async () => {
      await request(server.getHttpServer())
        .put(`${BASE_URL}/${new ObjectId()}`)
        .send(mockSavedSearch())
        .expect(401);
    });
  });

  describe('DELETE /api/v2/saved-searches/:id', () => {
    it('deletes a saved search', async () => {
      const doc = await SavedSearch.create({
        team: team._id,
        source: new ObjectId(sourceId),
        name: 'To Delete',
      });

      const res = await authRequest('delete', `${BASE_URL}/${doc._id}`).expect(
        200,
      );
      expect(res.body).toEqual({});
      expect(await SavedSearch.findById(doc._id)).toBeNull();
    });

    it('cascade-deletes alerts that reference the saved search', async () => {
      const doc = await SavedSearch.create({
        team: team._id,
        source: new ObjectId(sourceId),
        name: 'With Alerts',
      });
      const alert = await Alert.create({
        team: team._id,
        savedSearch: doc._id,
        source: 'saved_search',
        interval: '5m',
        threshold: 1,
        thresholdType: 'above',
        state: 'OK',
        channel: { type: 'webhook', webhookId: new ObjectId().toString() },
      });

      await authRequest('delete', `${BASE_URL}/${doc._id}`).expect(200);

      expect(await SavedSearch.findById(doc._id)).toBeNull();
      expect(await Alert.findById(alert._id)).toBeNull();
    });

    it('returns 400 for an invalid id', async () => {
      await authRequest('delete', `${BASE_URL}/not-an-id`).expect(400);
    });

    it('returns 404 for non-existent id', async () => {
      await authRequest('delete', `${BASE_URL}/${new ObjectId()}`).expect(404);
    });

    it("does not delete another team's saved search", async () => {
      const doc = await SavedSearch.create({
        team: new ObjectId(),
        source: new ObjectId(),
        name: 'Other',
      });
      await authRequest('delete', `${BASE_URL}/${doc._id}`).expect(404);
      expect(await SavedSearch.findById(doc._id)).not.toBeNull();
    });

    it('requires authentication', async () => {
      await request(server.getHttpServer())
        .delete(`${BASE_URL}/${new ObjectId()}`)
        .expect(401);
    });
  });
});
