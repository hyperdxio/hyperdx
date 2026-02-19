import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import request, { SuperAgentTest } from 'supertest';

import { ITeam } from '@/models/team';
import { IUser } from '@/models/user';

import * as config from '../../../config';
import {
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  getLoggedInAgent,
  getServer,
} from '../../../fixtures';
import Connection, { IConnection } from '../../../models/connection';
import { Source } from '../../../models/source';
import { mapGranularityToExternalFormat } from '../v2/sources';

describe('External API v2 Sources', () => {
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

  describe('GET /api/v2/sources', () => {
    const BASE_URL = '/api/v2/sources';

    it('should return 401 when user is not authenticated', async () => {
      await request(server.getHttpServer()).get(BASE_URL).expect(401);
    });

    it('should return empty array when no sources exist', async () => {
      const response = await authRequest('get', BASE_URL).expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toEqual([]);
    });

    it('should return a single log source', async () => {
      const logSource = await Source.create({
        kind: SourceKind.Log,
        team: team._id,
        name: 'Test Log Source',
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: '*',
        connection: connection._id,
      });

      const response = await authRequest('get', BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual({
        id: logSource._id.toString(),
        name: 'Test Log Source',
        kind: SourceKind.Log,
        connection: connection._id.toString(),
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: '*',
        highlightedTraceAttributeExpressions: [],
        highlightedRowAttributeExpressions: [],
        materializedViews: [],
        querySettings: [],
      });
    });

    it('should return a single trace source', async () => {
      const traceSource = await Source.create({
        kind: SourceKind.Trace,
        team: team._id,
        name: 'Test Trace Source',
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
        connection: connection._id,
        highlightedTraceAttributeExpressions: [
          {
            sqlExpression: "ResourceAttributes['ServiceName']",
            alias: 'ServiceName',
            luceneExpression: 'ResourceAttributes.ServiceName',
          },
        ],
        highlightedRowAttributeExpressions: [
          {
            sqlExpression: 'TraceId',
            alias: 'trace_id',
            luceneExpression: 'TraceId',
          },
        ],
        materializedViews: [
          {
            databaseName: DEFAULT_DATABASE,
            tableName: 'traces_mv',
            dimensionColumns: 'ServiceName',
            minGranularity: '1 minute',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [
              {
                mvColumn: 'count',
                aggFn: 'count',
              },
            ],
          },
          {
            databaseName: DEFAULT_DATABASE,
            tableName: 'traces_mv_15s',
            dimensionColumns: 'ServiceName',
            minGranularity: '15 second',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [
              {
                mvColumn: 'count',
                aggFn: 'count',
              },
            ],
          },
        ],
        querySettings: [
          {
            setting: 'max_execution_time',
            value: '30',
          },
        ],
      });

      const response = await authRequest('get', BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual({
        id: traceSource._id.toString(),
        name: 'Test Trace Source',
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: 'otel_traces',
        },
        kind: SourceKind.Trace,
        connection: connection._id.toString(),
        timestampValueExpression: 'Timestamp',
        durationExpression: 'Duration',
        durationPrecision: 3,
        traceIdExpression: 'TraceId',
        spanIdExpression: 'SpanId',
        parentSpanIdExpression: 'ParentSpanId',
        spanNameExpression: 'SpanName',
        spanKindExpression: 'SpanKind',
        highlightedTraceAttributeExpressions: [
          {
            sqlExpression: "ResourceAttributes['ServiceName']",
            alias: 'ServiceName',
            luceneExpression: 'ResourceAttributes.ServiceName',
          },
        ],
        highlightedRowAttributeExpressions: [
          {
            sqlExpression: 'TraceId',
            alias: 'trace_id',
            luceneExpression: 'TraceId',
          },
        ],
        materializedViews: [
          {
            databaseName: DEFAULT_DATABASE,
            tableName: 'traces_mv',
            dimensionColumns: 'ServiceName',
            minGranularity: '1m',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [
              {
                mvColumn: 'count',
                aggFn: 'count',
              },
            ],
          },
          {
            databaseName: DEFAULT_DATABASE,
            tableName: 'traces_mv_15s',
            dimensionColumns: 'ServiceName',
            minGranularity: '15s',
            timestampColumn: 'Timestamp',
            aggregatedColumns: [
              {
                mvColumn: 'count',
                aggFn: 'count',
              },
            ],
          },
        ],
        querySettings: [
          {
            setting: 'max_execution_time',
            value: '30',
          },
        ],
      });
    });

    it('should return a single metric source', async () => {
      const metricSource = await Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        name: 'Test Metric Source',
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: '',
        },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: 'otel_metrics_gauge',
          [MetricsDataType.Sum.toLowerCase()]: 'otel_metrics_sum',
          [MetricsDataType.Histogram.toLowerCase()]: 'otel_metrics_histogram',
        },
        timestampValueExpression: 'TimeUnix',
        resourceAttributesExpression: 'ResourceAttributes',
        connection: connection._id,
      });

      const response = await authRequest('get', BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toEqual({
        id: metricSource._id.toString(),
        name: 'Test Metric Source',
        kind: SourceKind.Metric,
        connection: connection._id.toString(),
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: '',
        },
        metricTables: {
          gauge: 'otel_metrics_gauge',
          sum: 'otel_metrics_sum',
          histogram: 'otel_metrics_histogram',
        },
        timestampValueExpression: 'TimeUnix',
        resourceAttributesExpression: 'ResourceAttributes',
        querySettings: [],
      });
    });

    it('should return a single session source', async () => {
      const traceSource = await Source.create({
        kind: SourceKind.Trace,
        team: team._id,
        name: 'Trace Source for Session',
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
        connection: connection._id,
      });

      const sessionSource = await Source.create({
        kind: SourceKind.Session,
        team: team._id,
        name: 'Test Session Source',
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: 'rrweb_events',
        },
        traceSourceId: traceSource._id.toString(),
        connection: connection._id,
      });

      const response = await authRequest('get', BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(2);

      const sessionData = response.body.data.find(
        (s: any) => s.kind === SourceKind.Session,
      );
      expect(sessionData).toEqual({
        id: sessionSource._id.toString(),
        name: 'Test Session Source',
        kind: SourceKind.Session,
        connection: connection._id.toString(),
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: 'rrweb_events',
        },
        traceSourceId: traceSource._id.toString(),
        querySettings: [],
      });
    });

    it('should return multiple sources of different kinds', async () => {
      const logSource = await Source.create({
        kind: SourceKind.Log,
        team: team._id,
        name: 'Logs',
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: '*',
        connection: connection._id,
      });

      const traceSource = await Source.create({
        kind: SourceKind.Trace,
        team: team._id,
        name: 'Traces',
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
        connection: connection._id,
      });

      const metricSource = await Source.create({
        kind: SourceKind.Metric,
        team: team._id,
        name: 'Metrics',
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: '',
        },
        metricTables: {
          [MetricsDataType.Gauge.toLowerCase()]: 'otel_metrics_gauge',
        },
        timestampValueExpression: 'TimeUnix',
        resourceAttributesExpression: 'ResourceAttributes',
        connection: connection._id,
      });

      const response = await authRequest('get', BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(3);

      const kinds = response.body.data.map((s: any) => s.kind);
      expect(kinds).toContain(SourceKind.Log);
      expect(kinds).toContain(SourceKind.Trace);
      expect(kinds).toContain(SourceKind.Metric);

      const ids = response.body.data.map((s: any) => s.id);
      expect(ids).toContain(logSource._id.toString());
      expect(ids).toContain(traceSource._id.toString());
      expect(ids).toContain(metricSource._id.toString());
    });

    it("should only return sources for the authenticated user's team", async () => {
      // Create a source for the current team
      const currentTeamSource = await Source.create({
        kind: SourceKind.Log,
        team: team._id,
        name: 'Current Team Source',
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: '*',
        connection: connection._id,
      });

      // Create another team and source
      const otherTeamId = new mongoose.Types.ObjectId();
      const otherConnection = await Connection.create({
        team: otherTeamId,
        name: 'Other Team Connection',
        host: config.CLICKHOUSE_HOST,
        username: config.CLICKHOUSE_USER,
        password: config.CLICKHOUSE_PASSWORD,
      });

      await Source.create({
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

      const response = await authRequest('get', BASE_URL).expect(200);

      // Should only return the current team's source
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(currentTeamSource._id.toString());
      expect(response.body.data[0].name).toBe('Current Team Source');
    });

    it('should format sources according to SourceSchema', async () => {
      await Source.create({
        kind: SourceKind.Log,
        team: team._id,
        name: 'Test Source',
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: '*',
        connection: connection._id,
      });

      const response = await authRequest('get', BASE_URL).expect(200);

      expect(response.body.data).toHaveLength(1);

      // Verify that MongoDB _id is converted to string id
      expect(response.body.data[0]).toHaveProperty('id');
      expect(response.body.data[0]).not.toHaveProperty('_id');
      expect(typeof response.body.data[0].id).toBe('string');

      // Verify connection ObjectId is converted to string
      expect(typeof response.body.data[0].connection).toBe('string');

      // Verify team field is not included (internal field)
      expect(response.body.data[0]).not.toHaveProperty('team');
    });

    it('should filter out sources that fail schema validation', async () => {
      // Create a valid source
      const validSource = await Source.create({
        kind: SourceKind.Log,
        team: team._id,
        name: 'Valid Source',
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_LOGS_TABLE,
        },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: '*',
        connection: connection._id,
      });

      // Create an invalid source by bypassing Mongoose validation
      // This simulates a source that might exist in the database but doesn't
      // match the SourceSchema (e.g., due to schema evolution)
      await Source.collection.insertOne({
        kind: 'invalid-kind', // Invalid kind
        team: team._id,
        name: 'Invalid Source',
        from: {
          databaseName: DEFAULT_DATABASE,
          tableName: DEFAULT_LOGS_TABLE,
        },
        connection: connection._id,
      });

      const response = await authRequest('get', BASE_URL).expect(200);

      // Should only return the valid source
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(validSource._id.toString());
    });
  });
});

describe('External API v2 Sources Mapping', () => {
  describe('mapGranularityToExternalFormat', () => {
    it.each`
      input         | expected
      ${'1 second'} | ${'1s'}
      ${'1 minute'} | ${'1m'}
      ${'1 hour'}   | ${'1h'}
      ${'1 day'}    | ${'1d'}
    `(
      'maps supported long-form granularity $input to $expected',
      ({ input, expected }) => {
        expect(mapGranularityToExternalFormat(input)).toBe(expected);
      },
    );

    it.each`
      input          | expected
      ${'invalid'}   | ${'invalid'}
      ${'1m'}        | ${'1m'}
      ${'2 minutes'} | ${'2 minutes'}
    `(
      'passes through unsupported or already-short granularity $input',
      ({ input, expected }) => {
        expect(mapGranularityToExternalFormat(input)).toBe(expected);
      },
    );
  });
});
