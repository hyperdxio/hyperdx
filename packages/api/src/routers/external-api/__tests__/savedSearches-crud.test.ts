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

    it('should return 404 for another team saved search', async () => {
      const other = await createOtherTeamSavedSearch();
      await authRequest('put', `${BASE_URL}/${other._id}`)
        .send(savedSearchBody())
        .expect(404);
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
  });
});
