import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { SuperAgentTest } from 'supertest';

import * as config from '@/config';
import { getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';
import { Source } from '@/models/source';

describe('External API NetFlow sources', () => {
  const server = getServer();
  let agent: SuperAgentTest;
  let accessKey: string;
  let connectionId: string;
  const path = '/api/v2/sources';
  const mappings = {
    bytesExpression: 'Bytes',
    packetsExpression: 'Packets',
    srcAddrExpression: 'SrcAddr',
    dstAddrExpression: 'DstAddr',
    srcPortExpression: 'SrcPort',
    dstPortExpression: 'DstPort',
    protocolExpression: 'Proto',
    samplingRateExpression: 'SamplingRate',
    exporterExpression: 'ExporterName',
    inIfExpression: 'InIfName',
    outIfExpression: 'OutIfName',
    implicitColumnExpression: 'SearchText',
  };
  const body = () => ({
    kind: SourceKind.Netflow,
    name: 'Network flows',
    connection: connectionId,
    from: { databaseName: 'default', tableName: 'flows' },
    timestampValueExpression: 'TimeReceived',
    defaultTableSelectExpression: 'TimeReceived, SrcAddr, DstAddr, Bytes',
    ...mappings,
  });
  const authRequest = (method: 'get' | 'post' | 'put', url: string) =>
    (method === 'get'
      ? agent.get(url)
      : method === 'post'
        ? agent.post(url)
        : agent.put(url)
    ).set('Authorization', `Bearer ${accessKey}`);

  beforeAll(async () => {
    await server.start();
  });
  beforeEach(async () => {
    const session = await getLoggedInAgent(server);
    agent = session.agent;
    accessKey = session.user.accessKey;
    const connection = await Connection.create({
      team: session.team._id,
      name: 'ClickHouse',
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USER,
      password: config.CLICKHOUSE_PASSWORD,
    });
    connectionId = connection.id;
  });
  afterEach(async () => {
    await server.clearDBs();
  });
  afterAll(async () => {
    await server.stop();
  });

  it('creates, reads, updates, and persists every mapping', async () => {
    const created = await authRequest('post', path).send(body()).expect(200);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject(body());
    const read = await authRequest('get', `${path}/${id}`).expect(200);
    expect(read.body.data).toMatchObject(body());
    const updated = {
      ...body(),
      name: 'Updated flows',
      ...Object.fromEntries(
        Object.entries(mappings).map(([key, value]) => [key, `(${value})`]),
      ),
    };
    await authRequest('put', `${path}/${id}`).send(updated).expect(200);
    const readUpdate = await authRequest('get', `${path}/${id}`).expect(200);
    expect(readUpdate.body.data).toMatchObject(updated);
    expect(await Source.findById(id).lean()).toMatchObject({
      ...updated,
      connection: expect.anything(),
    });
  });

  it.each([
    'defaultTableSelectExpression',
    'bytesExpression',
    'packetsExpression',
    'srcAddrExpression',
    'dstAddrExpression',
    'srcPortExpression',
    'dstPortExpression',
    'protocolExpression',
  ])(
    'rejects create and update missing %s without changing saved mappings',
    async field => {
      const invalid = { ...body(), [field]: undefined };
      await authRequest('post', path).send(invalid).expect(400);
      expect(await Source.countDocuments({ kind: SourceKind.Netflow })).toBe(0);
      const created = await authRequest('post', path).send(body()).expect(200);
      const id = created.body.data.id;
      await authRequest('put', `${path}/${id}`).send(invalid).expect(400);
      const read = await authRequest('get', `${path}/${id}`).expect(200);
      expect(read.body.data).toMatchObject(body());
    },
  );
});
