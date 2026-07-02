import { SourceKind } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';
import request from 'supertest';

import * as config from '@/config';
import {
  bulkInsertLogs,
  DEFAULT_DATABASE,
  DEFAULT_LOGS_TABLE,
  getLoggedInAgent,
  getServer,
} from '@/fixtures';
import Connection from '@/models/connection';
import type { ISource } from '@/models/source';
import { Source } from '@/models/source';
import type { IUser } from '@/models/user';

const DEFAULT_END_TIME = Math.floor(Date.now() / 60000) * 60000;
const DEFAULT_START_TIME = DEFAULT_END_TIME - 3600 * 1000;

const iso = (ms: number) => new Date(ms).toISOString();

describe('External API v2 Search', () => {
  const server = getServer();
  let agent: request.SuperTest<request.Test>;
  let user: IUser;
  let logSource: ISource;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    user = result.user;
    const team = result.team;

    const connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });

    logSource = await Source.create({
      kind: SourceKind.Log,
      team: team._id,
      from: {
        databaseName: DEFAULT_DATABASE,
        tableName: DEFAULT_LOGS_TABLE,
      },
      defaultTableSelectExpression: 'Timestamp, SeverityText, Body',
      timestampValueExpression: 'Timestamp',
      connection: connection._id,
      name: 'Logs',
    });

    const now = new Date(DEFAULT_END_TIME - 10000);
    await bulkInsertLogs([
      {
        ServiceName: 'search-svc',
        Timestamp: now,
        SeverityText: 'INFO',
        Body: 'hello from search test',
      },
      {
        ServiceName: 'search-svc',
        Timestamp: new Date(now.getTime() + 1000),
        SeverityText: 'ERROR',
        Body: 'error in search test',
      },
      {
        ServiceName: 'other-svc',
        Timestamp: new Date(now.getTime() + 2000),
        SeverityText: 'INFO',
        Body: 'other service log',
      },
    ]);
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  // Helper: authenticated POST to /api/v2/search
  const search = (body: Record<string, unknown>) =>
    agent
      .post('/api/v2/search')
      .set('Authorization', `Bearer ${user.accessKey}`)
      .send(body);

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it('returns 400 when sourceId is missing', async () => {
    const res = await search({
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when sourceId is not a valid ObjectId', async () => {
    const res = await search({
      sourceId: 'not-an-objectid',
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when startTime is not a valid ISO string', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: 'not-a-date',
      endTime: iso(DEFAULT_END_TIME),
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when startTime is after endTime', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_END_TIME),
      endTime: iso(DEFAULT_START_TIME),
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when where exceeds 8192 characters', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      where: 'x'.repeat(8 * 1024 + 1),
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when select exceeds 4096 characters', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      select: 'x'.repeat(4 * 1024 + 1),
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when offset exceeds 10000', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      offset: 10_001,
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when maxResults exceeds 2000', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      maxResults: 9999,
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await agent.post('/api/v2/search').send({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when sourceId does not exist', async () => {
    const res = await search({
      sourceId: '000000000000000000000000',
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
    });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 404 when the connection for a source no longer exists', async () => {
    const team = logSource.team;
    const deadConn = await Connection.create({
      team,
      name: 'Dead Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const orphanSource = await Source.create({
      kind: SourceKind.Log,
      team,
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_LOGS_TABLE },
      timestampValueExpression: 'Timestamp',
      connection: deadConn._id,
      name: 'Orphan',
    });
    await Connection.deleteOne({ _id: deadConn._id });

    const res = await search({
      sourceId: orphanSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
    });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('message');
  });

  // -------------------------------------------------------------------------
  // Basic fetch + response shape
  // -------------------------------------------------------------------------

  it('returns rows from the source with default settings', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('rows');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.rows).toBe(res.body.data.length);
  });

  it('returns flat row objects with column names as top-level keys (not a nested envelope)', async () => {
    // Guards against the ResponseJSON-envelope bug where result.data was the
    // entire { data: [...], meta, rows, statistics } object instead of the
    // row array, making every response look like { data: [<envelope>], rows: 1 }.
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      select: 'Timestamp,SeverityText,Body',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      // Each element must be a flat object with string column keys, not a
      // nested { data: [...], meta, rows } envelope.
      expect(typeof row.Timestamp).toBe('string');
      expect(typeof row.SeverityText).toBe('string');
      expect(typeof row.Body).toBe('string');
      expect(row).not.toHaveProperty('meta');
      expect(row).not.toHaveProperty('statistics');
    }
  });

  // -------------------------------------------------------------------------
  // Column selection
  // -------------------------------------------------------------------------

  it('returns exactly the requested select columns and no others', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      select: 'Timestamp,SeverityText,Body',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(Object.keys(row).sort()).toEqual([
        'Body',
        'SeverityText',
        'Timestamp',
      ]);
    }
  });

  // -------------------------------------------------------------------------
  // Lucene filter
  // -------------------------------------------------------------------------

  it('filters rows by Lucene where clause', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      where: 'SeverityText:ERROR',
      select: 'SeverityText,Body',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(row.SeverityText).toBe('ERROR');
    }
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  it('respects maxResults', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      maxResults: 1,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });

  it('respects offset for pagination with deterministic DESC timestamp ordering', async () => {
    // beforeEach inserts 3 rows: now, now+1s, now+2s.
    // ORDER BY Timestamp DESC => row order: [now+2s, now+1s, now].
    // Fetching 2 rows then 1 with offset=1 must yield an exact continuation.
    const page1 = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      maxResults: 2,
      offset: 0,
      select: 'Timestamp,SeverityText,Body',
    });

    const page2 = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      maxResults: 1,
      offset: 1,
      select: 'Timestamp,SeverityText,Body',
    });

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    expect(page1.body.data.length).toBe(2);
    expect(page2.body.data.length).toBe(1);
    // The single row on page 2 must equal the second row on page 1
    expect(page2.body.data[0].Body).toBe(page1.body.data[1].Body);
    expect(page2.body.data[0].Timestamp).toBe(page1.body.data[1].Timestamp);
  });

  // -------------------------------------------------------------------------
  // SQL where language
  // -------------------------------------------------------------------------

  it('supports SQL where language', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      where: "SeverityText = 'ERROR'",
      whereLanguage: 'sql',
      select: 'SeverityText,Body',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(row.SeverityText).toBe('ERROR');
    }
  });

  it('defaults whereLanguage to lucene when omitted', async () => {
    // Verifies processRequestWithEnhancedErrors applies the Zod default so
    // the Lucene filter is active even without an explicit whereLanguage field.
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      where: 'SeverityText:ERROR',
      // whereLanguage intentionally omitted
      select: 'SeverityText,Body',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(row.SeverityText).toBe('ERROR');
    }
  });

  // -------------------------------------------------------------------------
  // Empty time range
  // -------------------------------------------------------------------------

  it('returns empty data when time range has no matching rows', async () => {
    const farPast = new Date('2000-01-01T00:00:00Z').getTime();
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(farPast),
      endTime: iso(farPast + 60_000),
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.rows).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Error response shape
  // -------------------------------------------------------------------------

  it('uses { message } envelope for 4xx errors', async () => {
    const res = await search({ sourceId: 'not-an-objectid' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('error');
  });

  it('uses { message } envelope for 404 errors', async () => {
    const res = await search({
      sourceId: '000000000000000000000000',
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
    });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body).not.toHaveProperty('error');
  });

  it('returns 400 when whereLanguage is not lucene or sql', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      whereLanguage: 'graphql',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when select contains a semicolon', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      select: 'Timestamp; DROP TABLE otel_logs',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when select contains a SELECT subquery', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      select: '(SELECT max(Timestamp) FROM system.tables)',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message');
  });

  // -------------------------------------------------------------------------
  // Boundary values
  // -------------------------------------------------------------------------

  it('accepts maxResults at the upper boundary of 2000', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      maxResults: 2000,
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  it('accepts offset at the upper boundary of 10000', async () => {
    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      offset: 10000,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('applies maxResults default of 100 when omitted', async () => {
    // Insert 101 rows to ensure the default cap of 100 is observable.
    await bulkInsertLogs(
      Array.from({ length: 101 }, (_, i) => ({
        ServiceName: 'cap-svc',
        Timestamp: new Date(DEFAULT_END_TIME - 100_000 + i * 10),
        SeverityText: 'DEBUG',
        Body: `row ${i}`,
      })),
    );

    const res = await search({
      sourceId: logSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
      // maxResults intentionally omitted
    });
    expect(res.status).toBe(200);
    expect(res.body.rows).toBeLessThanOrEqual(100);
  });

  // -------------------------------------------------------------------------
  // Cross-team isolation
  // -------------------------------------------------------------------------

  it('returns 404 when sourceId belongs to a different team', async () => {
    // The /register/password endpoint only allows one team to register, so
    // create a synthetic "other team" source directly in Mongo and verify
    // the authenticated user (team 1) cannot access it.
    const otherTeamId = new mongoose.Types.ObjectId();
    const otherConnection = await Connection.create({
      team: otherTeamId,
      name: 'Other Team Connection',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const otherSource = await Source.create({
      kind: SourceKind.Log,
      team: otherTeamId,
      from: { databaseName: DEFAULT_DATABASE, tableName: DEFAULT_LOGS_TABLE },
      timestampValueExpression: 'Timestamp',
      connection: otherConnection._id,
      name: 'Other Team Source',
    });

    const res = await search({
      sourceId: otherSource.id.toString(),
      startTime: iso(DEFAULT_START_TIME),
      endTime: iso(DEFAULT_END_TIME),
    });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('message');
  });
});
