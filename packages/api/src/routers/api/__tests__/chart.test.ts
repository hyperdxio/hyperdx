import ms from 'ms';

import * as clickhouse from '@/clickhouse';
import {
  clearClickhouseTables,
  clearDBCollections,
  clearRedis,
  closeDB,
  generateBuildTeamEventFn,
  getLoggedInAgent,
  getServer,
  mockLogsPropertyTypeMappingsModel,
} from '@/fixtures';

describe('charts router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await clearDBCollections();
    await clearClickhouseTables();
    await clearRedis();
  });

  afterAll(async () => {
    await server.closeHttpServer();
    await closeDB();
  });

  it('GET /chart/services', async () => {
    const now = Date.now();
    const { agent, team } = await getLoggedInAgent(server);

    const buildEvent = generateBuildTeamEventFn(team.id, {});

    await clickhouse.bulkInsertLogStream([
      buildEvent({
        'k8s.namespace.name': 'namespace1',
        'k8s.pod.name': 'pod1',
        'k8s.pod.uid': 'uid1',
        level: 'ok',
        service: 'service1',
        timestamp: now,
      }),
      buildEvent({
        'k8s.namespace.name': 'namespace1',
        'k8s.pod.name': 'pod2',
        'k8s.pod.uid': 'uid2',
        level: 'ok',
        service: 'service1',
        timestamp: now,
      }),
      buildEvent({
        'k8s.namespace.name': 'namespace2',
        'k8s.pod.name': 'pod3',
        'k8s.pod.uid': 'uid3',
        level: 'ok',
        service: 'service2',
        timestamp: now - ms('1d'),
      }),
    ]);

    const results = await agent.get('/chart/services').expect(200);
    expect(results.body.data).toMatchInlineSnapshot(`
Object {
  "service1": Array [
    Object {
      "k8s.namespace.name": "namespace1",
      "k8s.pod.name": "pod1",
      "k8s.pod.uid": "uid1",
    },
    Object {
      "k8s.namespace.name": "namespace1",
      "k8s.pod.name": "pod2",
      "k8s.pod.uid": "uid2",
    },
  ],
  "service2": Array [
    Object {
      "k8s.namespace.name": "namespace2",
      "k8s.pod.name": "pod3",
      "k8s.pod.uid": "uid3",
    },
  ],
}
`);
  });

  it('GET /chart/services (missing custom attributes)', async () => {
    const now = Date.now();
    const { agent, team } = await getLoggedInAgent(server);

    const buildEvent = generateBuildTeamEventFn(team.id, {});

    await clickhouse.bulkInsertLogStream([
      buildEvent({
        timestamp: now,
        service: 'service1',
      }),
      buildEvent({
        timestamp: now,
        service: 'service1',
      }),
      buildEvent({
        timestamp: now - ms('1d'),
        service: 'service2',
      }),
    ]);

    const results = await agent.get('/chart/services').expect(200);
    expect(results.body.data).toMatchInlineSnapshot(`
Object {
  "service1": Array [],
  "service2": Array [],
}
`);
  });

  it('GET /chart/services (missing data but custom attributes exist)', async () => {
    const now = Date.now();
    const { agent, team } = await getLoggedInAgent(server);

    const buildEvent = generateBuildTeamEventFn(team.id, {});

    await clickhouse.bulkInsertLogStream([
      buildEvent({
        timestamp: now,
        service: 'service1',
      }),
      buildEvent({
        timestamp: now,
        service: 'service1',
      }),
      buildEvent({
        timestamp: now - ms('1d'),
        service: 'service2',
      }),
    ]);

    mockLogsPropertyTypeMappingsModel({
      service: 'string',
      'k8s.namespace.name': 'string',
    });

    const results = await agent.get('/chart/services').expect(200);
    expect(results.body.data).toMatchInlineSnapshot(`
Object {
  "service1": Array [],
  "service2": Array [],
}
`);
  });
});
