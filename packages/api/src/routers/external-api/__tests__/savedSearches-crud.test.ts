import { SourceKind } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import request, { SuperAgentTest } from 'supertest';

import * as config from '@/config';
import {
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Alert, { AlertSource, AlertState } from '@/models/alert';
import Connection from '@/models/connection';
import { SavedSearch } from '@/models/savedSearch';
import { LogSource } from '@/models/source';
import { ITeam } from '@/models/team';
import { IUser } from '@/models/user';

const BASE_URL = '/api/v2/saved-searches';

describe('External API v2 Saved Searches CRUD', () => {
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

    const connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const source = await LogSource.create({
      kind: SourceKind.Log,
      team: team._id,
      name: 'Logs',
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_LOGS_TABLE },
      timestampValueExpression: 'Timestamp',
      defaultTableSelectExpression: 'Timestamp, Body',
      connection: connection._id,
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
  ) => agent[method](url).set('Authorization', `Bearer ${user?.accessKey}`);

  const savedSearchBody = () => ({
    name: 'Production Errors',
    sourceId,
    select: 'Timestamp, Body',
    where: 'SeverityText:ERROR',
    whereLanguage: 'lucene' as const,
    orderBy: 'Timestamp DESC',
    tags: ['prod'],
  });

  const createOtherTeamSavedSearch = () =>
    SavedSearch.create({
      team: new mongoose.Types.ObjectId(),
      name: 'Other Team Search',
      source: new mongoose.Types.ObjectId(),
      whereLanguage: 'lucene',
    });

  describe('auth', () => {
    it('should require authentication on list', async () => {
      await request(server.getHttpServer()).get(BASE_URL).expect(401);
    });
  });

  describe('POST /api/v2/saved-searches', () => {
    it('should create a saved search and return the external shape', async () => {
      const response = await authRequest('post', BASE_URL)
        .send(savedSearchBody())
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: expect.any(String),
        name: 'Production Errors',
        sourceId,
        select: 'Timestamp, Body',
        where: 'SeverityText:ERROR',
        whereLanguage: 'lucene',
        orderBy: 'Timestamp DESC',
        tags: ['prod'],
        teamId: team._id.toString(),
      });
      // never leak the internal source field
      expect(response.body.data).not.toHaveProperty('source');
    });

    it('should reject a sourceId that does not belong to the team', async () => {
      const otherSourceId = new mongoose.Types.ObjectId().toString();
      const response = await authRequest('post', BASE_URL)
        .send({ ...savedSearchBody(), sourceId: otherSourceId })
        .expect(400);
      expect(response.body.message).toMatch(/existing source/i);
    });

    it('should reject a real source owned by another team (cross-team)', async () => {
      // A source that genuinely exists but belongs to a different team must be
      // rejected the same as a non-existent one — requireValidSourceId scopes
      // the lookup to the caller's team, preventing cross-team references.
      const otherTeamSource = await LogSource.create({
        kind: SourceKind.Log,
        team: new mongoose.Types.ObjectId(),
        name: 'Other Team Logs',
        from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_LOGS_TABLE },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Timestamp, Body',
        connection: new mongoose.Types.ObjectId(),
      });
      const response = await authRequest('post', BASE_URL)
        .send({
          ...savedSearchBody(),
          sourceId: otherTeamSource._id.toString(),
        })
        .expect(400);
      expect(response.body.message).toMatch(/existing source/i);
    });

    it('should reject a malformed sourceId', async () => {
      await authRequest('post', BASE_URL)
        .send({ ...savedSearchBody(), sourceId: 'not-an-id' })
        .expect(400);
    });

    it('should reject a missing name', async () => {
      const { name, ...rest } = savedSearchBody();
      await authRequest('post', BASE_URL).send(rest).expect(400);
    });
  });

  describe('GET /api/v2/saved-searches', () => {
    it('should list only the team saved searches', async () => {
      await authRequest('post', BASE_URL).send(savedSearchBody()).expect(200);
      await createOtherTeamSavedSearch();

      const response = await authRequest('get', BASE_URL).expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Production Errors');
    });

    it('should cap the number of results with the limit param', async () => {
      await authRequest('post', BASE_URL)
        .send({ ...savedSearchBody(), name: 'First' })
        .expect(200);
      await authRequest('post', BASE_URL)
        .send({ ...savedSearchBody(), name: 'Second' })
        .expect(200);

      const response = await authRequest('get', `${BASE_URL}?limit=1`).expect(
        200,
      );
      expect(response.body.data).toHaveLength(1);
    });

    it('should reject an out-of-range or non-integer limit or offset', async () => {
      await authRequest('get', `${BASE_URL}?limit=0`).expect(400);
      await authRequest('get', `${BASE_URL}?limit=5000`).expect(400);
      await authRequest('get', `${BASE_URL}?offset=-1`).expect(400);
      await authRequest('get', `${BASE_URL}?limit=abc`).expect(400);
      await authRequest('get', `${BASE_URL}?limit=1.5`).expect(400);
    });

    it('should paginate with limit and offset and report the total', async () => {
      await authRequest('post', BASE_URL)
        .send({ ...savedSearchBody(), name: 'First' })
        .expect(200);
      await authRequest('post', BASE_URL)
        .send({ ...savedSearchBody(), name: 'Second' })
        .expect(200);
      await authRequest('post', BASE_URL)
        .send({ ...savedSearchBody(), name: 'Third' })
        .expect(200);

      const page1 = await authRequest(
        'get',
        `${BASE_URL}?limit=2&offset=0`,
      ).expect(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.meta).toEqual({ total: 3, limit: 2, offset: 0 });

      const page2 = await authRequest(
        'get',
        `${BASE_URL}?limit=2&offset=2`,
      ).expect(200);
      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.meta).toEqual({ total: 3, limit: 2, offset: 2 });

      // Pages must be disjoint and together cover every record (stable order).
      const pagedIds = [...page1.body.data, ...page2.body.data].map(s => s.id);
      expect(new Set(pagedIds).size).toBe(3);
    });

    it('should return an empty page with the correct total past the end', async () => {
      await authRequest('post', BASE_URL).send(savedSearchBody()).expect(200);

      const response = await authRequest(
        'get',
        `${BASE_URL}?offset=100`,
      ).expect(200);
      expect(response.body.data).toHaveLength(0);
      expect(response.body.meta).toEqual({
        total: 1,
        limit: 1000,
        offset: 100,
      });
    });

    it('should get a saved search by id', async () => {
      const created = await authRequest('post', BASE_URL)
        .send(savedSearchBody())
        .expect(200);

      const response = await authRequest(
        'get',
        `${BASE_URL}/${created.body.data.id}`,
      ).expect(200);
      expect(response.body.data.id).toBe(created.body.data.id);
    });

    it('should return 404 for another team saved search', async () => {
      const other = await createOtherTeamSavedSearch();
      await authRequest('get', `${BASE_URL}/${other._id}`).expect(404);
    });
  });

  describe('PUT /api/v2/saved-searches/:id', () => {
    it('should update a saved search', async () => {
      const created = await authRequest('post', BASE_URL)
        .send(savedSearchBody())
        .expect(200);

      const response = await authRequest(
        'put',
        `${BASE_URL}/${created.body.data.id}`,
      )
        .send({ ...savedSearchBody(), name: 'Renamed', where: 'Body:timeout' })
        .expect(200);

      expect(response.body.data.name).toBe('Renamed');
      expect(response.body.data.where).toBe('Body:timeout');
    });

    it('should reset every omitted optional field to its default (uniform full-replace)', async () => {
      // PUT is a full replace: omitting any optional field resets it, uniformly
      // — orderBy and filters must not be silently preserved while
      // select/where/whereLanguage/tags reset.
      const created = await authRequest('post', BASE_URL)
        .send({ ...savedSearchBody(), whereLanguage: 'sql', where: 'x = 1' })
        .expect(200);
      expect(created.body.data.orderBy).toBe('Timestamp DESC');
      expect(created.body.data.tags).toEqual(['prod']);

      // Send only the required fields; every optional field is omitted.
      const response = await authRequest(
        'put',
        `${BASE_URL}/${created.body.data.id}`,
      )
        .send({ name: 'Minimal', sourceId })
        .expect(200);

      expect(response.body.data.name).toBe('Minimal');
      expect(response.body.data.select).toBe('');
      expect(response.body.data.where).toBe('');
      expect(response.body.data.whereLanguage).toBe('lucene');
      // Previously-preserved fields must now reset too.
      expect(response.body.data.orderBy).toBe('');
      expect(response.body.data.tags).toEqual([]);
      expect(response.body.data.filters).toEqual([]);
    });

    it('should return 404 for another team saved search', async () => {
      const other = await createOtherTeamSavedSearch();
      await authRequest('put', `${BASE_URL}/${other._id}`)
        .send(savedSearchBody())
        .expect(404);
    });

    it('should reject a sourceId that does not belong to the team', async () => {
      const created = await authRequest('post', BASE_URL)
        .send(savedSearchBody())
        .expect(200);

      const otherSourceId = new mongoose.Types.ObjectId().toString();
      const response = await authRequest(
        'put',
        `${BASE_URL}/${created.body.data.id}`,
      )
        .send({ ...savedSearchBody(), sourceId: otherSourceId })
        .expect(400);
      expect(response.body.message).toMatch(/existing source/i);
    });
  });

  describe('DELETE /api/v2/saved-searches/:id', () => {
    it('should delete a saved search', async () => {
      const created = await authRequest('post', BASE_URL)
        .send(savedSearchBody())
        .expect(200);

      await authRequest('delete', `${BASE_URL}/${created.body.data.id}`).expect(
        200,
      );

      expect(await SavedSearch.findById(created.body.data.id)).toBeNull();
    });

    it('should return 404 for another team saved search', async () => {
      const other = await createOtherTeamSavedSearch();
      await authRequest('delete', `${BASE_URL}/${other._id}`).expect(404);
      expect(await SavedSearch.findById(other._id)).not.toBeNull();
    });

    it('should delete alerts attached to the saved search', async () => {
      const created = await authRequest('post', BASE_URL)
        .send(savedSearchBody())
        .expect(200);
      const savedSearchId = created.body.data.id;

      await Alert.create({
        team: team._id,
        savedSearch: savedSearchId,
        source: AlertSource.SAVED_SEARCH,
        threshold: 1,
        interval: '5m',
        state: AlertState.OK,
        channel: { type: null },
      });

      await authRequest('delete', `${BASE_URL}/${savedSearchId}`).expect(200);

      expect(await SavedSearch.findById(savedSearchId)).toBeNull();
      // Dependent alerts must not be orphaned.
      expect(await Alert.countDocuments({ savedSearch: savedSearchId })).toBe(
        0,
      );
    });
  });
});
