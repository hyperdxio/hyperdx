/**
 * Unit-level tests for the Berg query lifecycle router.
 *
 * We stub the Athena SDK with `aws-sdk-client-mock` and the Mongoose
 * `Source` model so the router can be exercised without spinning up
 * Athena, Glue, or MongoDB.  An ad-hoc Express app is constructed with the
 * router mounted under `/api/v1/query`; auth is simulated by a tiny
 * middleware that injects (or omits) `req.user` before the auth gate runs.
 */

import {
  AthenaClient as SdkAthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
} from '@aws-sdk/client-athena';
import { mockClient } from 'aws-sdk-client-mock';
import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';

// Mock the Source model so we don't need MongoDB.  The query controller
// only uses `Source.findOne` and `Source.updateOne`.  The `jest.mock`
// call is hoisted above the `import` statements at runtime, so the
// router's transitive import of `@/models/source` resolves to this
// stub.
jest.mock('@/models/source', () => ({
  Source: {
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  },
}));

import { isUserAuthenticated } from '@/middleware/auth';
import { appErrorHandler } from '@/middleware/error';
import { Source } from '@/models/source';
import queryRouter from '@/routers/api/query';

const sdk = mockClient(SdkAthenaClient);

const setup = (
  opts: { authenticated: boolean; teamId?: string } = { authenticated: true },
) => {
  const app = express();
  app.use(express.json());

  if (opts.authenticated) {
    const teamId = opts.teamId ?? new Types.ObjectId().toString();
    app.use((req, _res, next) => {
      // Pretend Passport already authenticated this request.
      (req as any).user = {
        _id: 'test-user',
        team: new Types.ObjectId(teamId),
      };
      (req as any).isAuthenticated = () => true;
      next();
    });
  } else {
    app.use((req, _res, next) => {
      (req as any).isAuthenticated = () => false;
      next();
    });
  }

  app.use('/api/v1/query', isUserAuthenticated, queryRouter);
  app.use(appErrorHandler);
  return app;
};

describe('query router', () => {
  beforeEach(() => {
    sdk.reset();
    jest.clearAllMocks();
    // By default the Source.findOne mock returns null; tests that need
    // a hit configure it explicitly.
    (Source.findOne as jest.Mock).mockReset().mockResolvedValue(null);
    (Source.updateOne as jest.Mock).mockReset().mockResolvedValue({
      acknowledged: true,
    });
  });

  describe('POST /api/v1/query', () => {
    it('runs a SELECT and returns rows + scannedBytes', async () => {
      sdk.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: 'e1' });
      sdk.on(GetQueryExecutionCommand).resolves({
        QueryExecution: {
          Status: { State: 'SUCCEEDED' },
          Statistics: { DataScannedInBytes: 100 },
        },
      });
      sdk.on(GetQueryResultsCommand).resolves({
        ResultSet: {
          ResultSetMetadata: { ColumnInfo: [{ Name: 'n', Type: 'integer' }] },
          Rows: [
            { Data: [{ VarCharValue: 'n' }] },
            { Data: [{ VarCharValue: '5' }] },
          ],
        },
      });

      const app = setup();
      const r = await request(app)
        .post('/api/v1/query')
        .send({ sql: 'SELECT 5' });

      expect(r.status).toBe(200);
      expect(r.body.rows).toEqual([{ n: 5 }]);
      expect(r.body.scannedBytes).toBe(100);
      expect(r.body.status).toBe('finished');
    });

    it('falls back to async handoff when sync timeout elapses', async () => {
      sdk.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: 'e2' });
      // Always RUNNING — the controller will give up after the sync
      // timeout (defaults to 30s in prod; 0 in tests because env is empty).
      sdk.on(GetQueryExecutionCommand).resolves({
        QueryExecution: {
          Status: { State: 'RUNNING' },
          Statistics: { DataScannedInBytes: 0 },
        },
      });

      const app = setup();
      const r = await request(app)
        .post('/api/v1/query')
        .send({ sql: 'SELECT pg_sleep(60)' });

      expect(r.status).toBe(200);
      expect(r.body.executionId).toBe('e2');
      expect(r.body.status).toBe('running');
      // scannedBytes is always present in the response shape.
      expect(typeof r.body.scannedBytes).toBe('number');
    });

    it('rejects writes with 403 + forbidden_write code', async () => {
      const app = setup();
      const r = await request(app)
        .post('/api/v1/query')
        .send({ sql: 'INSERT INTO x VALUES (1)' });

      expect(r.status).toBe(403);
      expect(r.body.code).toBe('forbidden_write');
      // Athena should never have been called for a write-classified query.
      expect(sdk.calls()).toHaveLength(0);
    });

    it('returns 401 when unauthenticated', async () => {
      const app = setup({ authenticated: false });
      const r = await request(app)
        .post('/api/v1/query')
        .send({ sql: 'SELECT 1' });

      expect(r.status).toBe(401);
    });

    it('rejects sourceId for a team that does not own it (404)', async () => {
      (Source.findOne as jest.Mock).mockResolvedValue(null);

      const app = setup();
      const sourceId = new Types.ObjectId().toString();
      const r = await request(app)
        .post('/api/v1/query')
        .send({ sql: 'SELECT 1', sourceId });

      expect(r.status).toBe(404);
      expect(r.body.code).toBe('source_not_found');
      expect(Source.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: sourceId }),
      );
    });

    it('accepts sourceId owned by the requesting team and updates lastQueriedAt', async () => {
      const sourceId = new Types.ObjectId();
      (Source.findOne as jest.Mock).mockResolvedValue({ _id: sourceId });

      sdk.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: 'e3' });
      sdk.on(GetQueryExecutionCommand).resolves({
        QueryExecution: {
          Status: { State: 'SUCCEEDED' },
          Statistics: { DataScannedInBytes: 42 },
        },
      });
      sdk.on(GetQueryResultsCommand).resolves({
        ResultSet: {
          ResultSetMetadata: { ColumnInfo: [{ Name: 'n', Type: 'integer' }] },
          Rows: [
            { Data: [{ VarCharValue: 'n' }] },
            { Data: [{ VarCharValue: '1' }] },
          ],
        },
      });

      const app = setup();
      const r = await request(app)
        .post('/api/v1/query')
        .send({ sql: 'SELECT 1', sourceId: sourceId.toString() });

      expect(r.status).toBe(200);
      expect(r.body.scannedBytes).toBe(42);
      expect(Source.updateOne).toHaveBeenCalledWith(
        { _id: sourceId },
        { $set: { lastQueriedAt: expect.any(Date) } },
      );
    });

    it('rejects an empty SQL body with 400 (zod validation)', async () => {
      const app = setup();
      const r = await request(app).post('/api/v1/query').send({ sql: '' });
      expect(r.status).toBe(400);
    });
  });

  describe('GET /api/v1/query/:id/status', () => {
    it('returns the Athena-reported status', async () => {
      sdk.on(GetQueryExecutionCommand).resolves({
        QueryExecution: { Status: { State: 'RUNNING' } },
      });

      const app = setup();
      const r = await request(app).get('/api/v1/query/e1/status');
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('running');
    });
  });

  describe('GET /api/v1/query/:id/results', () => {
    it('returns paginated results with nextToken', async () => {
      sdk.on(GetQueryExecutionCommand).resolves({
        QueryExecution: {
          Status: { State: 'SUCCEEDED' },
          Statistics: { DataScannedInBytes: 7 },
        },
      });
      sdk.on(GetQueryResultsCommand).resolves({
        ResultSet: {
          ResultSetMetadata: { ColumnInfo: [{ Name: 'n', Type: 'integer' }] },
          Rows: [{ Data: [{ VarCharValue: '1' }] }],
        },
        NextToken: 'cursor-2',
      });

      const app = setup();
      const r = await request(app)
        .get('/api/v1/query/e1/results')
        .query({ nextToken: 'cursor-1' });

      expect(r.status).toBe(200);
      expect(r.body.nextToken).toBe('cursor-2');
      expect(r.body.scannedBytes).toBe(7);
    });
  });

  describe('DELETE /api/v1/query/:id', () => {
    it('cancels the query via StopQueryExecution', async () => {
      sdk.on(StopQueryExecutionCommand).resolves({});

      const app = setup();
      const r = await request(app).delete('/api/v1/query/e1');
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);

      const stopCalls = sdk.commandCalls(StopQueryExecutionCommand);
      expect(stopCalls).toHaveLength(1);
      expect(stopCalls[0].args[0].input).toEqual({ QueryExecutionId: 'e1' });
    });
  });
});
