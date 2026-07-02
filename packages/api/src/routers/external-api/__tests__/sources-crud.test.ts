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
import Connection, { IConnection } from '@/models/connection';
import { LogSource, Source, TraceSource } from '@/models/source';
import { ITeam } from '@/models/team';
import { IUser } from '@/models/user';

describe('External API v2 Sources CRUD', () => {
  const server = getServer();
  let agent: SuperAgentTest;
  let team: ITeam;
  let user: IUser;
  let connection: IConnection;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;

    connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // Helper for authenticated requests
  const authRequest = (
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
  ) => {
    return agent[method](url).set('Authorization', `Bearer ${user?.accessKey}`);
  };

  const BASE_URL = '/api/v2/sources';

  const logSourceBody = () => ({
    kind: SourceKind.Log,
    name: 'Created Log Source',
    from: {
      databaseName: DEFAULT_DATABASE,
      tableName: DEFAULT_LOGS_TABLE,
    },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp, Body',
    connection: connection._id.toString(),
  });

  const traceSourceBody = () => ({
    kind: SourceKind.Trace,
    name: 'Created Trace Source',
    defaultTableSelectExpression: 'Timestamp, SpanName',
    from: {
      databaseName: DEFAULT_DATABASE,
      tableName: 'otel_traces',
    },
    timestampValueExpression: 'Timestamp',
    durationExpression: 'Duration',
    durationPrecision: 3,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    connection: connection._id.toString(),
  });

  const createOtherTeamConnection = (otherTeamId: mongoose.Types.ObjectId) =>
    Connection.create({
      team: otherTeamId,
      name: 'Other Team Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

  const createOtherTeamSource = async () => {
    const otherTeamId = new mongoose.Types.ObjectId();
    const otherConnection = await createOtherTeamConnection(otherTeamId);
    return LogSource.create({
      kind: SourceKind.Log,
      team: otherTeamId,
      name: 'Other Team Source',
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_LOGS_TABLE,
      },
      timestampValueExpression: 'Timestamp',
      defaultTableSelectExpression: '*',
      connection: otherConnection._id,
    });
  };

  describe('GET /api/v2/sources/:id', () => {
    it('should return 401 when user is not authenticated', async () => {
      await request(server.getHttpServer())
        .get(`${BASE_URL}/${new mongoose.Types.ObjectId()}`)
        .expect(401);
    });

    it('should return a source by id', async () => {
      const logSource = await LogSource.create({
        ...logSourceBody(),
        team: team._id,
      });

      const response = await authRequest(
        'get',
        `${BASE_URL}/${logSource._id}`,
      ).expect(200);

      expect(response.body.data).toMatchObject({
        id: logSource._id.toString(),
        name: 'Created Log Source',
        kind: SourceKind.Log,
      });
    });

    it('should return 404 for a non-existent source', async () => {
      await authRequest(
        'get',
        `${BASE_URL}/${new mongoose.Types.ObjectId()}`,
      ).expect(404);
    });

    it("should return 404 for another team's source", async () => {
      const otherTeamSource = await createOtherTeamSource();
      await authRequest('get', `${BASE_URL}/${otherTeamSource._id}`).expect(
        404,
      );
    });

    it('should return 400 for an invalid id', async () => {
      await authRequest('get', `${BASE_URL}/not-an-object-id`).expect(400);
    });
  });

  describe('POST /api/v2/sources', () => {
    it('should return 401 when user is not authenticated', async () => {
      await request(server.getHttpServer())
        .post(BASE_URL)
        .send(logSourceBody())
        .expect(401);
    });

    it('should create a log source', async () => {
      const response = await authRequest('post', BASE_URL)
        .send(logSourceBody())
        .expect(200);

      expect(response.body.data).toMatchObject({
        name: 'Created Log Source',
        kind: SourceKind.Log,
        connection: connection._id.toString(),
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Timestamp, Body',
      });
      expect(typeof response.body.data.id).toBe('string');

      const persisted = await Source.findById(response.body.data.id);
      expect(persisted).not.toBeNull();
      expect(persisted!.team.toString()).toBe(team._id.toString());
    });

    it('should accept external short-form granularities and store internal format', async () => {
      const response = await authRequest('post', BASE_URL)
        .send({
          ...traceSourceBody(),
          materializedViews: [
            {
              databaseName: DEFAULT_DATABASE,
              tableName: 'traces_mv',
              dimensionColumns: 'ServiceName',
              minGranularity: '5m',
              timestampColumn: 'Timestamp',
              aggregatedColumns: [{ mvColumn: 'count', aggFn: 'count' }],
            },
          ],
        })
        .expect(200);

      // Response echoes the external format
      expect(response.body.data.materializedViews[0].minGranularity).toBe('5m');

      // The database stores the internal SQL interval format
      const persisted = await TraceSource.findById(response.body.data.id);
      expect(persisted!.materializedViews![0].minGranularity).toBe('5 minute');
    });

    it('should map metadataMaterializedViews granularity to internal format', async () => {
      const response = await authRequest('post', BASE_URL)
        .send({
          ...logSourceBody(),
          metadataMaterializedViews: {
            keyRollupTable: 'otel_logs_key_rollup_15m',
            kvRollupTable: 'otel_logs_kv_rollup_15m',
            granularity: '15m',
          },
        })
        .expect(200);

      // Response echoes the external format
      expect(response.body.data.metadataMaterializedViews.granularity).toBe(
        '15m',
      );

      // The database stores the internal SQL interval format
      const persisted = await LogSource.findById(response.body.data.id);
      expect(persisted!.metadataMaterializedViews!.granularity).toBe(
        '15 minute',
      );
    });

    it('should create a promql source', async () => {
      const response = await authRequest('post', BASE_URL)
        .send({
          kind: SourceKind.Promql,
          name: 'Prometheus Metrics',
          // Required by the API for all source kinds; unused for promql
          from: { databaseName: 'default', tableName: 'default' },
          timestampValueExpression: 'timestamp',
          connection: connection._id.toString(),
        })
        .expect(200);

      expect(response.body.data).toMatchObject({
        kind: SourceKind.Promql,
        name: 'Prometheus Metrics',
      });

      const persisted = await Source.findById(response.body.data.id);
      expect(persisted!.kind).toBe(SourceKind.Promql);
    });

    it('should return 400 when connection is not a valid id', async () => {
      await authRequest('post', BASE_URL)
        .send({ ...logSourceBody(), connection: 'my-connection-name' })
        .expect(400);
    });

    it('should return 400 when connection belongs to another team', async () => {
      const otherConnection = await createOtherTeamConnection(
        new mongoose.Types.ObjectId(),
      );

      await authRequest('post', BASE_URL)
        .send({
          ...logSourceBody(),
          connection: otherConnection._id.toString(),
        })
        .expect(400);

      expect(await Source.findOne({ team: team._id })).toBeNull();
    });

    it('should return 400 for an invalid body', async () => {
      await authRequest('post', BASE_URL)
        .send({ kind: SourceKind.Log, name: 'Missing required fields' })
        .expect(400);
    });
  });

  describe('PUT /api/v2/sources/:id', () => {
    it('should return 401 when user is not authenticated', async () => {
      await request(server.getHttpServer())
        .put(`${BASE_URL}/${new mongoose.Types.ObjectId()}`)
        .send(logSourceBody())
        .expect(401);
    });

    it('should update a source', async () => {
      const logSource = await LogSource.create({
        ...logSourceBody(),
        team: team._id,
      });

      const response = await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({ ...logSourceBody(), name: 'Updated Log Source' })
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: logSource._id.toString(),
        name: 'Updated Log Source',
      });

      const persisted = await Source.findById(logSource._id);
      expect(persisted!.name).toBe('Updated Log Source');
    });

    it('should return 404 for a non-existent source', async () => {
      await authRequest('put', `${BASE_URL}/${new mongoose.Types.ObjectId()}`)
        .send(logSourceBody())
        .expect(404);
    });

    it("should return 404 for another team's source", async () => {
      const otherTeamSource = await createOtherTeamSource();

      await authRequest('put', `${BASE_URL}/${otherTeamSource._id}`)
        .send({ ...logSourceBody(), name: 'Hijacked' })
        .expect(404);

      const persisted = await Source.findById(otherTeamSource._id);
      expect(persisted!.name).toBe('Other Team Source');
    });

    it('should return 400 for an invalid body', async () => {
      const logSource = await LogSource.create({
        ...logSourceBody(),
        team: team._id,
      });

      await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({ kind: SourceKind.Log, name: 'Missing required fields' })
        .expect(400);
    });

    it('should return 400 when connection is not a valid id', async () => {
      const logSource = await LogSource.create({
        ...logSourceBody(),
        team: team._id,
      });

      await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({ ...logSourceBody(), connection: 'my-connection-name' })
        .expect(400);
    });

    it('should return 400 when connection belongs to another team', async () => {
      const logSource = await LogSource.create({
        ...logSourceBody(),
        team: team._id,
      });
      const otherConnection = await createOtherTeamConnection(
        new mongoose.Types.ObjectId(),
      );

      await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({
          ...logSourceBody(),
          connection: otherConnection._id.toString(),
        })
        .expect(400);

      const persisted = await Source.findById(logSource._id);
      expect(persisted!.connection.toString()).toBe(connection._id.toString());
    });

    it('should preserve createdAt on a same-kind update', async () => {
      const logSource = await LogSource.create({
        ...logSourceBody(),
        team: team._id,
      });
      const originalCreatedAt = logSource.get('createdAt');
      expect(originalCreatedAt).toBeInstanceOf(Date);

      await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({ ...logSourceBody(), name: 'Updated Log Source' })
        .expect(200);

      const raw = await Source.collection.findOne({ _id: logSource._id });
      expect(raw!.createdAt).toEqual(originalCreatedAt);
    });

    it("should change a source's kind", async () => {
      const logSource = await LogSource.create({
        ...logSourceBody(),
        team: team._id,
      });
      const originalCreatedAt = logSource.get('createdAt');
      expect(originalCreatedAt).toBeInstanceOf(Date);

      const response = await authRequest('put', `${BASE_URL}/${logSource._id}`)
        .send({ ...traceSourceBody(), name: 'Now A Trace Source' })
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: logSource._id.toString(),
        kind: SourceKind.Trace,
        name: 'Now A Trace Source',
      });

      const persisted = await Source.findById(logSource._id);
      expect(persisted!.kind).toBe(SourceKind.Trace);

      // The kind-change path writes through the raw collection, bypassing
      // Mongoose casting/timestamps — assert on the raw document that
      // createdAt survives and connection is stored as a BSON ObjectId.
      const raw = await Source.collection.findOne({ _id: logSource._id });
      expect(raw!.createdAt).toEqual(originalCreatedAt);
      expect(raw!.connection).toBeInstanceOf(mongoose.Types.ObjectId);
    });

    it('should return 404 on a kind change when the source is deleted concurrently', async () => {
      const logSource = await LogSource.create({
        ...logSourceBody(),
        team: team._id,
      });

      // Simulate a concurrent delete landing between the controller's findOne
      // and the raw replaceOne in the kind-change path: the replace matches
      // nothing, so matchedCount === 0 and the controller must report 404
      // rather than hydrating a phantom document.
      const spy = jest
        .spyOn(Source.collection, 'replaceOne')
        .mockImplementationOnce(async () => {
          await Source.deleteOne({ _id: logSource._id });
          return { matchedCount: 0 } as any;
        });

      try {
        await authRequest('put', `${BASE_URL}/${logSource._id}`)
          .send({ ...traceSourceBody(), name: 'Now A Trace Source' })
          .expect(404);
      } finally {
        spy.mockRestore();
      }

      // No phantom document was written back.
      expect(await Source.findById(logSource._id)).toBeNull();
    });
  });

  describe('DELETE /api/v2/sources/:id', () => {
    it('should return 401 when user is not authenticated', async () => {
      await request(server.getHttpServer())
        .delete(`${BASE_URL}/${new mongoose.Types.ObjectId()}`)
        .expect(401);
    });

    it('should delete a source', async () => {
      const logSource = await LogSource.create({
        ...logSourceBody(),
        team: team._id,
      });

      await authRequest('delete', `${BASE_URL}/${logSource._id}`).expect(200);

      expect(await Source.findById(logSource._id)).toBeNull();
    });

    it('should return 404 for a non-existent source', async () => {
      await authRequest(
        'delete',
        `${BASE_URL}/${new mongoose.Types.ObjectId()}`,
      ).expect(404);
    });

    it("should return 404 for another team's source and leave it intact", async () => {
      const otherTeamSource = await createOtherTeamSource();

      await authRequest('delete', `${BASE_URL}/${otherTeamSource._id}`).expect(
        404,
      );

      expect(await Source.findById(otherTeamSource._id)).not.toBeNull();
    });
  });
});
