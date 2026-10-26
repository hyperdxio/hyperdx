import type { QuerySettings } from '@hyperdx/common-utils/dist/types';
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
import {
  encodeSearchCursor,
  fingerprintQuery,
} from '@/routers/external-api/v2/utils/searchCursor';
import logger from '@/utils/logger';

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

  // Each test seeds its own rows: afterEach calls server.clearDBs().
  const seedCursorRows = async () => {
    // 40 rows a minute apart, plus 3 on the newest 15m window's boundary.
    const boundary = DEFAULT_END_TIME - 15 * 60 * 1000;
    await bulkInsertLogs([
      ...Array.from({ length: 40 }, (_, i) => ({
        ServiceName: 'cursor-test',
        Timestamp: new Date(DEFAULT_END_TIME - i * 60 * 1000),
        SeverityText: 'INFO',
        Body: `row-${i}`,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        ServiceName: 'cursor-test',
        Timestamp: new Date(boundary),
        SeverityText: 'INFO',
        Body: `boundary-${i}`,
      })),
    ]);
  };

  const cursorOffset = (cursor: string) =>
    JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url').toString()).o;

  const cursorBody = () => ({
    sourceId: logSource.id.toString(),
    startTime: iso(DEFAULT_START_TIME),
    endTime: iso(DEFAULT_END_TIME),
    where: 'ServiceName:"cursor-test"',
    select: 'Timestamp,Body',
    maxResults: 5,
  });

  it('walks every row exactly once with cursor pagination', async () => {
    await seedCursorRows();

    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    for (; pages < 50; pages++) {
      const res = await search({
        ...cursorBody(),
        cursor: cursor ?? 'start',
      }).expect(200);
      seen.push(...res.body.data.map((r: Record<string, string>) => r.Body));
      cursor = res.body.nextCursor;
      if (cursor == null) break;
    }

    expect(pages).toBeLessThan(49);
    expect(cursor).toBeNull();
    expect(seen).toHaveLength(43);
    expect(new Set(seen).size).toBe(43);
  });

  it.each([
    ['omitted', {}],
    ['empty', { endTime: '' }],
  ])(
    'pages with a defaulted endTime (%s), which resolves to a fresh now each call',
    async (_label, endTimeField) => {
      await seedCursorRows();

      // An omitted or empty endTime resolves to a fresh `now` on each request.
      const body = {
        sourceId: logSource.id.toString(),
        startTime: iso(DEFAULT_START_TIME),
        ...endTimeField,
        where: 'ServiceName:"cursor-test"',
        select: 'Timestamp,Body',
        maxResults: 5,
      };

      const seen: string[] = [];
      let cursor: string | null | undefined;
      let pages = 0;
      for (; pages < 50; pages++) {
        const res = await search({ ...body, cursor: cursor ?? 'start' }).expect(
          200,
        );
        seen.push(...res.body.data.map((r: Record<string, string>) => r.Body));
        cursor = res.body.nextCursor;
        if (cursor == null) break;
      }

      expect(cursor).toBeNull();
      expect(seen).toHaveLength(43);
      expect(new Set(seen).size).toBe(43);
    },
  );

  it.each([
    ['on a whole second', 0],
    ['mid-second', 500],
  ])(
    'returns each row once around a window boundary %s with a second-precision timestamp column',
    async (_label, boundaryMs) => {
      const coarseSource = await Source.create({
        kind: SourceKind.Log,
        team: logSource.team,
        from: logSource.from,
        defaultTableSelectExpression: 'Timestamp, SeverityText, Body',
        timestampValueExpression: 'toDateTime(Timestamp), Timestamp',
        connection: logSource.connection,
        name: 'Logs (second-precision)',
      });

      // The first descending window boundary sits 15 minutes before endTime.
      const endTime = DEFAULT_END_TIME + boundaryMs;
      const boundary = endTime - 15 * 60 * 1000;
      await bulkInsertLogs(
        [-300, 0, 300].map(deltaMs => ({
          ServiceName: 'cursor-boundary-test',
          Timestamp: new Date(boundary + deltaMs),
          SeverityText: 'INFO',
          Body: `at-${deltaMs}`,
        })),
      );

      const body = {
        sourceId: coarseSource.id.toString(),
        startTime: iso(DEFAULT_START_TIME),
        endTime: iso(endTime),
        where: 'ServiceName:"cursor-boundary-test"',
        select: 'Timestamp,Body',
        orderBy: 'Timestamp DESC',
        maxResults: 5,
      };

      const seen: string[] = [];
      let cursor: string | null | undefined;
      for (let pages = 0; pages < 50; pages++) {
        const res = await search({ ...body, cursor: cursor ?? 'start' }).expect(
          200,
        );
        seen.push(...res.body.data.map((r: Record<string, string>) => r.Body));
        cursor = res.body.nextCursor;
        if (cursor == null) break;
      }

      expect(cursor).toBeNull();
      expect(seen.sort()).toEqual(['at--300', 'at-0', 'at-300']);
    },
  );

  it('starts a cursor walk over a range longer than a year', async () => {
    await seedCursorRows();

    const res = await search({
      ...cursorBody(),
      startTime: iso(DEFAULT_END_TIME - 400 * 24 * 60 * 60 * 1000),
      cursor: 'start',
    }).expect(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.nextCursor).toBeTruthy();
  });

  it('pages past 10,000 rows in a range shorter than the first window', async () => {
    const rangeStart = DEFAULT_END_TIME - 10 * 60 * 1000;
    await bulkInsertLogs(
      Array.from({ length: 10_050 }, (_, i) => ({
        ServiceName: 'cursor-dense-test',
        Timestamp: new Date(rangeStart + i * 50),
        SeverityText: 'INFO',
        Body: `dense-${i}`,
      })),
    );
    const body = {
      ...cursorBody(),
      startTime: iso(rangeStart),
      where: 'ServiceName:"cursor-dense-test"',
      maxResults: 2000,
    };

    const seen = new Set<string>();
    const offsets: number[] = [];
    let cursor: string | null | undefined;
    for (let pages = 0; pages < 20; pages++) {
      const res = await search({ ...body, cursor: cursor ?? 'start' }).expect(
        200,
      );
      res.body.data.forEach((r: Record<string, string>) => seen.add(r.Body));
      cursor = res.body.nextCursor;
      if (cursor == null) break;
      offsets.push(cursorOffset(cursor));
    }
    expect(cursor).toBeNull();
    expect(seen.size).toBe(10_050);
    // Rows are 50ms apart, so a second holds 20 of them.
    expect(Math.max(...offsets)).toBeLessThanOrEqual(20);
  });

  it.each(['Timestamp DESC', 'Timestamp ASC'])(
    'returns every row once when one second holds more rows than a page (%s)',
    async orderBy => {
      const second = DEFAULT_END_TIME - 5 * 60 * 1000;
      await bulkInsertLogs(
        Array.from({ length: 900 }, (_, i) => ({
          ServiceName: 'cursor-burst-test',
          Timestamp: new Date(second + i),
          SeverityText: 'INFO',
          Body: `burst-${i}`,
        })),
      );
      const body = {
        ...cursorBody(),
        where: 'ServiceName:"cursor-burst-test"',
        orderBy,
        maxResults: 300,
      };

      const seen: string[] = [];
      let cursor: string | null | undefined;
      for (let pages = 0; pages < 20; pages++) {
        const res = await search({ ...body, cursor: cursor ?? 'start' }).expect(
          200,
        );
        seen.push(...res.body.data.map((r: Record<string, string>) => r.Body));
        cursor = res.body.nextCursor;
        if (cursor == null) break;
      }
      expect(cursor).toBeNull();
      expect(seen).toHaveLength(900);
      expect(new Set(seen).size).toBe(900);
    },
  );

  it('walks every row exactly once in ascending order', async () => {
    await seedCursorRows();
    // seedCursorRows puts four rows on one Timestamp; Body breaks the tie.

    const seen: string[] = [];
    let cursor: string | null | undefined;
    for (let pages = 0; pages < 50; pages++) {
      const res = await search({
        ...cursorBody(),
        orderBy: 'Timestamp ASC, Body ASC',
        cursor: cursor ?? 'start',
      }).expect(200);
      seen.push(...res.body.data.map((r: Record<string, string>) => r.Body));
      cursor = res.body.nextCursor;
      if (cursor == null) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toHaveLength(43);
    expect(new Set(seen).size).toBe(43);
  });

  it.each([
    ['omitted', {}],
    ['without a timestamp', { select: 'Body' }],
  ])(
    'never returns the cursor timestamp column when select is %s',
    async (_label, selectField) => {
      await seedCursorRows();
      const { select: _omit, ...rest } = cursorBody();
      const res = await search({
        ...rest,
        ...selectField,
        cursor: 'start',
      }).expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const row of res.body.data) {
        expect(row).not.toHaveProperty('__hdx_cursor_ts');
      }
    },
  );

  const createLimitedSource = (querySettings: QuerySettings) =>
    Source.create({
      kind: SourceKind.Log,
      team: logSource.team,
      from: logSource.from,
      defaultTableSelectExpression: 'Timestamp, SeverityText, Body',
      timestampValueExpression: 'Timestamp',
      connection: logSource.connection,
      name: 'Logs (limited)',
      querySettings,
    });

  it('fails a cursor walk instead of truncating when source settings say break', async () => {
    await seedCursorRows();
    const limited = await createLimitedSource([
      { setting: 'max_rows_to_read', value: '1' },
      { setting: 'read_overflow_mode', value: 'break' },
    ]);
    const errorSpy = jest.spyOn(logger, 'error');

    const { maxResults: _max, ...body } = cursorBody();
    // Offset paging keeps the source's 'break' setting; a cursor walk overrides
    // it and fails instead of truncating.
    await search({ ...body, sourceId: limited.id.toString() }).expect(200);
    expect(errorSpy).not.toHaveBeenCalled();
    const res = await search({
      ...body,
      sourceId: limited.id.toString(),
      cursor: 'start',
    });
    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chType: 'TOO_MANY_ROWS' }),
      '[search] ClickHouse query error',
    );
    errorSpy.mockRestore();
  });

  it.each([5, 100])(
    'walks every row when maxResults %i is at or above the source max_result_rows',
    async maxResults => {
      await seedCursorRows();
      const limited = await createLimitedSource([
        { setting: 'max_result_rows', value: '5' },
        { setting: 'result_overflow_mode', value: 'break' },
      ]);

      const seen: string[] = [];
      let cursor: string | null | undefined;
      for (let pages = 0; pages < 50; pages++) {
        const res = await search({
          ...cursorBody(),
          sourceId: limited.id.toString(),
          maxResults,
          cursor: cursor ?? 'start',
        }).expect(200);
        expect(res.body.data.length).toBeLessThanOrEqual(5);
        seen.push(...res.body.data.map((r: Record<string, string>) => r.Body));
        cursor = res.body.nextCursor;
        if (cursor == null) break;
      }

      expect(cursor).toBeNull();
      expect(seen).toHaveLength(43);
      expect(new Set(seen).size).toBe(43);
    },
  );

  it('keeps a DISTINCT select distinct during a cursor walk', async () => {
    const now = DEFAULT_END_TIME - 2 * 60 * 1000;
    await bulkInsertLogs(
      Array.from({ length: 30 }, (_, i) => ({
        ServiceName: 'cursor-distinct-test',
        // Half the rows are older than the first 15m window's start.
        Timestamp: new Date(now - (i < 15 ? i : 30 * 60 + i) * 1000),
        SeverityText: 'INFO',
        Body: `dup-${i % 3}`,
      })),
    );

    const seen: string[] = [];
    let cursor: string | null | undefined;
    for (let pages = 0; pages < 20; pages++) {
      const res = await search({
        ...cursorBody(),
        where: 'ServiceName:"cursor-distinct-test"',
        select: 'DISTINCT Body',
        maxResults: 2,
        cursor: cursor ?? 'start',
      }).expect(200);
      seen.push(...res.body.data.map((r: Record<string, string>) => r.Body));
      cursor = res.body.nextCursor;
      if (cursor == null) break;
    }
    expect(seen.sort()).toEqual(['dup-0', 'dup-1', 'dup-2']);
  });

  it.each([
    [
      'a rounded leading key',
      'toStartOfMinute(Timestamp), Timestamp',
      'toStartOfMinute(Timestamp) DESC, Body ASC',
    ],
    [
      'an exact leading key on a compound expression',
      'toDateTime(Timestamp), Timestamp',
      'Timestamp DESC',
    ],
  ])(
    'returns every row once when the walk is ordered by %s',
    async (_label, timestampValueExpression, orderBy) => {
      const compound = await Source.create({
        kind: SourceKind.Log,
        team: logSource.team,
        from: logSource.from,
        defaultTableSelectExpression: 'Timestamp, SeverityText, Body',
        timestampValueExpression,
        connection: logSource.connection,
        name: 'Logs (compound)',
      });
      const minute =
        Math.floor((DEFAULT_END_TIME - 3 * 60 * 1000) / 60_000) * 60_000;
      // Body order is unrelated to time, so a cut on the wrong key loses rows.
      await bulkInsertLogs(
        Array.from({ length: 120 }, (_, i) => ({
          ServiceName: 'cursor-order-test',
          Timestamp: new Date(minute + i * 400),
          SeverityText: 'INFO',
          Body: `row-${String((i * 37) % 120).padStart(3, '0')}`,
        })),
      );

      const seen: string[] = [];
      let cursor: string | null | undefined;
      for (let pages = 0; pages < 50; pages++) {
        const res = await search({
          ...cursorBody(),
          sourceId: compound.id.toString(),
          where: 'ServiceName:"cursor-order-test"',
          orderBy,
          maxResults: 10,
          cursor: cursor ?? 'start',
        }).expect(200);
        seen.push(...res.body.data.map((r: Record<string, string>) => r.Body));
        cursor = res.body.nextCursor;
        if (cursor == null) break;
      }
      expect(cursor).toBeNull();
      expect(seen).toHaveLength(120);
      expect(new Set(seen).size).toBe(120);
    },
  );

  it('rejects a select that uses the reserved cursor column name', async () => {
    await search({
      ...cursorBody(),
      select: 'Timestamp AS __hdx_cursor_ts',
      cursor: 'start',
    }).expect(400);
  });

  it('rejects a cursor whose contents were edited', async () => {
    await seedCursorRows();

    const first = await search({ ...cursorBody(), cursor: 'start' }).expect(
      200,
    );
    const [payload, signature] = String(first.body.nextCursor).split('.');
    const edited = JSON.parse(Buffer.from(payload, 'base64url').toString());
    edited.o += 1;
    const forged = `${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${signature}`;

    const res = await search({ ...cursorBody(), cursor: forged }).expect(400);
    expect(res.body.message).toMatch(/invalid or expired/);
  });

  const forgeCursor = (
    body: ReturnType<typeof cursorBody> & { orderBy: string },
    offset: number,
  ) =>
    encodeSearchCursor(
      {
        window: {
          ordinal: 0,
          startTime: iso(DEFAULT_START_TIME),
          endTime: iso(DEFAULT_END_TIME),
        },
        offset,
        startTime: iso(DEFAULT_START_TIME),
        endTime: iso(DEFAULT_END_TIME),
      },
      fingerprintQuery({
        sourceId: body.sourceId,
        where: body.where,
        whereLanguage: 'lucene',
        select: body.select,
        orderBy: body.orderBy,
      }),
    );

  it('rejects a single-window cursor at the offset cap', async () => {
    const body = { ...cursorBody(), orderBy: 'Body DESC' };
    const res = await search({
      ...body,
      cursor: forgeCursor(body, 10_000),
    }).expect(400);
    expect(res.body.message).toMatch(/Too many matching rows/);
  });

  it('serves a short last page just under the offset cap', async () => {
    const body = { ...cursorBody(), orderBy: 'Body DESC' };
    const res = await search({
      ...body,
      cursor: forgeCursor(body, 9_998),
    }).expect(200);
    expect(res.body.nextCursor).toBeNull();
  });

  it('rejects a cursor replayed with a different explicit range', async () => {
    await seedCursorRows();

    const first = await search({ ...cursorBody(), cursor: 'start' }).expect(
      200,
    );
    expect(first.body.nextCursor).toBeTruthy();

    await search({
      ...cursorBody(),
      startTime: iso(DEFAULT_START_TIME + 60 * 1000),
      cursor: first.body.nextCursor,
    }).expect(400);
  });

  it('rejects a cursor reused against a different query', async () => {
    await seedCursorRows();

    const first = await search({ ...cursorBody(), cursor: 'start' }).expect(
      200,
    );
    expect(first.body.nextCursor).toBeTruthy();

    await search({
      ...cursorBody(),
      where: 'ServiceName:"other-cursor-svc"',
      cursor: first.body.nextCursor,
    }).expect(400);
  });

  it('leaves offset pagination behaving as before', async () => {
    await seedCursorRows();

    // Rows span ~40 minutes, so a large offset must reach past the newest 15m window.
    const first = await search({ ...cursorBody(), maxResults: 5 }).expect(200);
    const deep = await search({
      ...cursorBody(),
      maxResults: 5,
      offset: 20,
    }).expect(200);

    expect(first.body.data).toHaveLength(5);
    expect(deep.body.data).toHaveLength(5);
    // Offset-only callers are not driving a cursor walk.
    expect(first.body.nextCursor).toBeNull();
    expect(deep.body.nextCursor).toBeNull();
    const firstBodies = first.body.data.map(
      (r: Record<string, string>) => r.Body,
    );
    const deepBodies = deep.body.data.map(
      (r: Record<string, string>) => r.Body,
    );
    expect(deepBodies).not.toEqual(firstBodies);
  });
});
