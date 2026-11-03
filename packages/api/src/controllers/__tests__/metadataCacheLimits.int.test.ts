import http from 'http';
import request from 'supertest';

import app from '@/api-app';
import { ClickhouseClient } from '@/clickhouse';
import * as config from '@/config';
import * as aiController from '@/controllers/ai';
import {
  clearDBCollections,
  closeTestFixtureClickHouseClient,
  connectDB,
  executeSqlCommand,
} from '@/fixtures';
import { mongooseConnection } from '@/models';
import Connection from '@/models/connection';
import { LogSource } from '@/models/source';
import User, { type UserDocument } from '@/models/user';

jest.mock('@/config', () => ({
  ...jest.requireActual('@/config'),
  AI_PROVIDER: 'openai',
  AI_API_KEY: 'test-only',
  AI_MODEL_NAME: 'test-only',
  AI_BASE_URL: 'http://127.0.0.1:1',
}));

jest.mock('ai', () => ({
  ...jest.requireActual('ai'),
  generateText: jest.fn().mockResolvedValue({
    output: {
      displayType: 'table',
      select: [{ aggregationFunction: 'count', property: 'Body' }],
      timeRange: 'Past 1h',
    },
  }),
}));

const server = http.createServer(app);
const agent = request.agent(server);
const metadataSpy = jest.spyOn(aiController, 'getAIMetadata');
const querySpy = jest.spyOn(ClickhouseClient.prototype, 'query');
const tables: string[] = [];
let user: UserDocument;
// Stabilize hourly cache keys without giving MongoDB expired test sessions.
const initialTime = new Date();
initialTime.setUTCMinutes(15, 0, 0);
const bucketTime = new Date(initialTime);
bucketTime.setUTCMinutes(0, 0, 0);
const fixtureTimestamp = bucketTime
  .toISOString()
  .slice(0, 19)
  .replace('T', ' ');

beforeAll(async () => {
  jest.useFakeTimers({
    now: initialTime,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  await connectDB();
  await clearDBCollections();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const credentials = {
    email: 'metadata-cache@example.invalid',
    password: 'Local-fixture-only-7368!',
  };
  if (!(await User.findOne({ email: credentials.email }))) {
    await agent
      .post('/register/password')
      .send({ ...credentials, confirmPassword: credentials.password })
      .expect(200);
  }
  await agent.post('/login/password').send(credentials).expect(303);
  const found = await User.findOne({ email: credentials.email });
  if (!found) throw new Error('Native registration did not persist user');
  user = found;
}, 60000);

afterAll(async () => {
  jest.useRealTimers();
  await new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve())),
  );
  for (const table of tables)
    await executeSqlCommand(`DROP TABLE IF EXISTS ${table}`);
  await clearDBCollections();
  await closeTestFixtureClickHouseClient();
  await mongooseConnection.close();
});

beforeEach(() => {
  jest.setSystemTime(initialTime);
  querySpy.mockClear();
  metadataSpy.mockClear();
});

async function sourceFixture(name: string, connectionName = name) {
  const table = `metadata_limits_${name}`;
  const rollup = `${table}_kv`;
  tables.push(table, rollup);
  await executeSqlCommand(
    `CREATE TABLE IF NOT EXISTS ${table} (Timestamp DateTime64(3), Body String, LogAttributes Map(String, String)) ENGINE=MergeTree ORDER BY Timestamp`,
  );
  await executeSqlCommand(
    `CREATE TABLE IF NOT EXISTS ${rollup} (Timestamp DateTime, ColumnIdentifier String, Key String, Value String, count UInt64) ENGINE=MergeTree ORDER BY (ColumnIdentifier, Timestamp, Key)`,
  );
  await executeSqlCommand(`TRUNCATE TABLE ${table}`);
  await executeSqlCommand(`TRUNCATE TABLE ${rollup}`);
  await executeSqlCommand(
    `INSERT INTO ${table} SELECT toDateTime64('${fixtureTimestamp}', 3), 'fixture', mapFromArrays(arrayMap(x -> concat('key', leftPad(toString(x), 3, '0')), range(100)), arrayMap(x -> 'value', range(100)))`,
  );
  await executeSqlCommand(
    `INSERT INTO ${rollup} SELECT toDateTime('${fixtureTimestamp}'), 'LogAttributes', concat('key', leftPad(toString(number), 3, '0')), 'value', 100-number FROM numbers(100)`,
  );
  let connection = await Connection.findOne({
    team: user.team,
    name: connectionName,
  });
  connection ??= await Connection.create({
    team: user.team,
    name: connectionName,
    host: config.CLICKHOUSE_HOST,
    username: config.CLICKHOUSE_USER,
    password: config.CLICKHOUSE_PASSWORD,
  });
  let source = await LogSource.findOne({ team: user.team, name });
  source ??= await LogSource.create({
    name,
    team: user.team,
    connection: connection._id,
    from: { databaseName: 'default', tableName: table },
    timestampValueExpression: 'Timestamp',
    bodyExpression: 'Body',
    eventAttributesExpression: 'LogAttributes',
    metadataMaterializedViews: { kvRollupTable: rollup, granularity: '1 hour' },
  });
  return source;
}

async function mcp(sourceId: string, accessKey = user.accessKey) {
  const response = await request(server)
    .post('/mcp')
    .set('Authorization', `Bearer ${accessKey}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'clickstack_describe_source', arguments: { sourceId } },
    });
  if (response.status !== 200)
    return { status: response.status, count: -1, isError: true };
  const data = response.text
    .split('\n')
    .find((line: string) => line.startsWith('data: '));
  const envelope = data ? JSON.parse(data.slice(6)) : response.body;
  const tool = envelope.result;
  if (!tool) throw new Error(JSON.stringify(envelope));
  if (tool.isError)
    return { status: response.status, count: -1, isError: true };
  const body = JSON.parse(
    tool.content.find((item: { type: string }) => item.type === 'text').text,
  );
  return {
    status: response.status,
    count: body.source.mapAttributeKeys.LogAttributes.length,
    isError: false,
    sourceId: body.source.id,
    connectionId: body.source.connectionId,
    partial: body.source.partial ?? false,
  };
}

async function ai(sourceId: string) {
  const response = await agent
    .post('/ai/assistant')
    .send({ text: 'Count logs', sourceId });
  if (response.status !== 200) return { status: response.status, count: -1 };
  const invocation = metadataSpy.mock.results.at(-1);
  if (!invocation || invocation.type !== 'return')
    throw new Error('Native getAIMetadata was not called');
  const value: Awaited<ReturnType<typeof aiController.getAIMetadata>> =
    await invocation.value;
  return {
    status: response.status,
    count: value.allFields.filter(
      field => field.path[0] === 'LogAttributes' && field.path.length > 1,
    ).length,
    sourceId: response.body.source,
    connectionId: response.body.connection,
  };
}

function keyQueries() {
  return querySpy.mock.calls
    .map(call => call[0])
    .filter(call => /SELECT Key\s+FROM/.test(call.query))
    .map(call => ({
      query: call.query,
      query_params: call.query_params,
      connectionId: call.connectionId,
      clickhouse_settings: call.clickhouse_settings,
    }));
}

test('MCP 50 then AI default preserves each requested limit', async () => {
  const source = await sourceFixture('mcp_ai');
  const first = await mcp(source.id);
  const second = await ai(source.id);
  expect(first).toMatchObject({
    status: 200,
    count: 50,
    isError: false,
    partial: false,
  });
  expect(second).toMatchObject({ status: 200, count: 100 });
  expect((await mcp(source.id)).count).toBe(50);
  expect((await ai(source.id)).count).toBe(100);
  expect(keyQueries()).toHaveLength(2);
});
test('AI default then MCP 50 preserves each requested limit', async () => {
  const source = await sourceFixture('ai_mcp');
  const first = await ai(source.id);
  const second = await mcp(source.id);
  expect(first).toMatchObject({ status: 200, count: 100 });
  expect(second).toMatchObject({
    status: 200,
    count: 50,
    isError: false,
    partial: false,
  });
  expect((await mcp(source.id)).count).toBe(50);
  expect((await ai(source.id)).count).toBe(100);
  expect(keyQueries()).toHaveLength(2);
});
