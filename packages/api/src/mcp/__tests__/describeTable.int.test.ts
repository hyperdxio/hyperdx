import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import mongoose from 'mongoose';

import * as config from '@/config';
import {
  getLoggedInAgent,
  getServer,
  getTestFixtureClickHouseClient,
} from '@/fixtures';
import { McpContext } from '@/mcp/tools/types';
import Connection from '@/models/connection';

import { callTool, createTestClient, getFirstText } from './mcpTestUtils';

const DATABASE = 'mcp_describe_table_test';
// Kept apart so the Distributed table does not change DATABASE's listing.
const DIST_DATABASE = 'mcp_describe_table_dist_test';

describe('clickstack_describe_table', () => {
  const server = getServer();
  let connection: any;
  let client: Client;

  beforeAll(async () => {
    await server.start();
    const ch = await getTestFixtureClickHouseClient();
    await ch.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await ch.command({ query: `DROP DATABASE IF EXISTS ${DIST_DATABASE}` });
    await ch.command({ query: `CREATE DATABASE ${DATABASE}` });
    await ch.command({ query: `CREATE DATABASE ${DIST_DATABASE}` });
    await ch.command({
      query: `
        CREATE TABLE ${DATABASE}.events (
          Timestamp DateTime64(9),
          ServiceName LowCardinality(String) COMMENT 'emitting service',
          Body String,
          Day Date MATERIALIZED toDate(Timestamp),
          INDEX idx_body Body TYPE tokenbf_v1(8192, 3, 0) GRANULARITY 1
        )
        ENGINE = MergeTree
        PARTITION BY toDate(Timestamp)
        PRIMARY KEY ServiceName
        ORDER BY (ServiceName, Timestamp)
        COMMENT 'test events'
      `,
    });
    await ch.command({
      query: `CREATE VIEW ${DATABASE}.events_view AS SELECT ServiceName FROM ${DATABASE}.events`,
    });
    await ch.command({
      query: `CREATE TABLE ${DIST_DATABASE}.events AS ${DATABASE}.events ENGINE = Distributed(hdx_cluster, ${DATABASE}, events)`,
    });
    await ch.insert({
      table: `${DATABASE}.events`,
      values: [
        { Timestamp: '2024-01-01 00:00:00', ServiceName: 'api', Body: 'a' },
        { Timestamp: '2024-01-01 00:00:01', ServiceName: 'web', Body: 'b' },
        { Timestamp: '2024-01-01 00:00:02', ServiceName: 'api', Body: 'c' },
      ],
      format: 'JSONEachRow',
    });
  });

  beforeEach(async () => {
    const { team, user } = await getLoggedInAgent(server);
    connection = await Connection.create({
      team: team._id,
      name: 'Default',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const context: McpContext = {
      teamId: team._id.toString(),
      userId: user._id.toString(),
    };
    client = await createTestClient(context);
  });

  afterEach(async () => {
    await client?.close();
    await server.clearDBs();
  });

  afterAll(async () => {
    const ch = await getTestFixtureClickHouseClient();
    await ch.command({ query: `DROP DATABASE IF EXISTS ${DIST_DATABASE}` });
    await ch.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await server.stop();
  });

  const call = (args: Record<string, unknown>) =>
    callTool(client, 'clickstack_describe_table', {
      connectionId: connection._id.toString(),
      ...args,
    });

  it('describes columns, keys, indices, and size of a table', async () => {
    const result = await call({ database: DATABASE, table: 'events' });
    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));

    expect(output.table).toMatchObject({
      database: DATABASE,
      name: 'events',
      engine: 'MergeTree',
      sortingKey: 'ServiceName, Timestamp',
      primaryKey: 'ServiceName',
      partitionKey: 'toDate(Timestamp)',
      comment: 'test events',
      approxTotalRows: 3,
    });
    expect(output.table.approxTotalBytes).toBeGreaterThan(0);

    expect(output.columns).toEqual([
      {
        name: 'Timestamp',
        type: 'DateTime64(9)',
        inSortingKey: true,
        inPrimaryKey: false,
      },
      {
        name: 'ServiceName',
        type: 'LowCardinality(String)',
        comment: 'emitting service',
        inSortingKey: true,
        inPrimaryKey: true,
      },
      {
        name: 'Body',
        type: 'String',
        inSortingKey: false,
        inPrimaryKey: false,
      },
      {
        name: 'Day',
        type: 'Date',
        defaultKind: 'MATERIALIZED',
        defaultExpression: 'toDate(Timestamp)',
        inSortingKey: false,
        inPrimaryKey: false,
      },
    ]);
    expect(output.dataSkippingIndices).toEqual([
      { name: 'idx_body', type: 'tokenbf_v1', expression: 'Body' },
    ]);
    expect(output.sampleRows).toBeUndefined();
  });

  it('reads keys and indices of a Distributed table from its local table', async () => {
    const result = await call({ database: DIST_DATABASE, table: 'events' });
    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.table).toMatchObject({
      engine: 'Distributed',
      localTable: {
        cluster: 'hdx_cluster',
        database: DATABASE,
        table: 'events',
        engine: 'MergeTree',
      },
      sortingKey: 'ServiceName, Timestamp',
      primaryKey: 'ServiceName',
      partitionKey: 'toDate(Timestamp)',
    });
    expect(
      output.columns.find((c: any) => c.name === 'ServiceName'),
    ).toMatchObject({
      inSortingKey: true,
      inPrimaryKey: true,
    });
    expect(output.dataSkippingIndices).toEqual([
      { name: 'idx_body', type: 'tokenbf_v1', expression: 'Body' },
    ]);
  });

  it('reflects an index added after a previous describe', async () => {
    await call({ database: DATABASE, table: 'events' });
    const ch = await getTestFixtureClickHouseClient();
    await ch.command({
      query: `ALTER TABLE ${DATABASE}.events ADD INDEX idx_svc ServiceName TYPE set(10) GRANULARITY 1`,
    });
    try {
      const output = JSON.parse(
        getFirstText(await call({ database: DATABASE, table: 'events' })),
      );
      expect(
        output.dataSkippingIndices.map((i: { name: string }) => i.name),
      ).toContain('idx_svc');
    } finally {
      await ch.command({
        query: `ALTER TABLE ${DATABASE}.events DROP INDEX idx_svc`,
      });
    }
  });

  it('returns a capped sample of rows when asked', async () => {
    const result = await call({
      database: DATABASE,
      table: 'events',
      sampleRows: 2,
    });
    expect(result.isError).toBeFalsy();
    const output = JSON.parse(getFirstText(result));
    expect(output.sampleRows).toHaveLength(2);
    expect(output.sampleRows[0]).toHaveProperty('ServiceName');
  });

  it('rejects more than 5 sample rows', async () => {
    const result = await call({
      database: DATABASE,
      table: 'events',
      sampleRows: 50,
    });
    expect(result.isError).toBe(true);
  });

  it('lists tables in a database across pages', async () => {
    const first = JSON.parse(
      getFirstText(await call({ database: DATABASE, limit: 1 })),
    );
    expect(first.tables).toEqual([
      { name: 'events', engine: 'MergeTree', approxTotalRows: 3 },
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = JSON.parse(
      getFirstText(
        await call({ database: DATABASE, limit: 1, cursor: first.nextCursor }),
      ),
    );
    expect(second.tables).toEqual([
      { name: 'events_view', engine: 'View', approxTotalRows: null },
    ]);
    expect(second.nextCursor).toBeUndefined();
  });

  it('returns user errors for a missing table or database', async () => {
    const missingTable = await call({ database: DATABASE, table: 'nope' });
    expect(missingTable.isError).toBe(true);
    expect(getFirstText(missingTable)).toMatch(/not found/);

    const missingDb = await call({ database: 'mcp_no_such_db' });
    expect(missingDb.isError).toBe(true);
    expect(getFirstText(missingDb)).toMatch(/not found/);
  });

  it('treats database and table names as values, not SQL', async () => {
    const result = await call({
      database: DATABASE,
      table: "events' OR '1'='1",
    });
    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toMatch(/not found/);
  });

  it("does not use another team's connection", async () => {
    const otherConnection = await Connection.create({
      team: new mongoose.Types.ObjectId(),
      name: 'Other',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    const result = await callTool(client, 'clickstack_describe_table', {
      connectionId: otherConnection._id.toString(),
      database: DATABASE,
    });
    expect(result.isError).toBe(true);
    expect(getFirstText(result)).toMatch(/Connection .* not found/);
  });
});
