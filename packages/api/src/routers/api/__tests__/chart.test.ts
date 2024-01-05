import ms from 'ms';

import * as clickhouse from '@/clickhouse';
import {
  buildEvent,
  clearClickhouseTables,
  clearDBCollections,
  clearRedis,
  closeDB,
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

    await clickhouse.bulkInsertTeamLogStream(
      team.logStreamTableVersion,
      team.id,
      [
        buildEvent({
          timestamp: now - ms('30m'),
          service: 'service1',
          'k8s.namespace.name': 'namespace1',
          'k8s.pod.name': 'pod1',
          'k8s.pod.uid': 'uid1',
        }),
        buildEvent({
          timestamp: now - ms('1d'),
          service: 'service1',
          'k8s.namespace.name': 'namespace1',
          'k8s.pod.name': 'pod2',
          'k8s.pod.uid': 'uid2',
        }),
        buildEvent({
          timestamp: now - ms('1h'),
          service: 'service2',
          'k8s.namespace.name': 'namespace2',
          'k8s.pod.name': 'pod3',
          'k8s.pod.uid': 'uid3',
        }),
      ],
    );

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

    await clickhouse.bulkInsertTeamLogStream(
      team.logStreamTableVersion,
      team.id,
      [
        buildEvent({
          timestamp: now - ms('30m'),
          service: 'service1',
          'k8s.namespace.name': 'namespace1',
          'k8s.pod.uid': 'uid1',
        }),
        buildEvent({
          timestamp: now - ms('1d'),
          service: 'service1',
          'k8s.namespace.name': 'namespace1',
          'k8s.pod.uid': 'uid2',
        }),
        buildEvent({
          timestamp: now - ms('1h'),
          service: 'service2',
          'k8s.namespace.name': 'namespace2',
          'k8s.pod.uid': 'uid3',
        }),
      ],
    );

    const results = await agent.get('/chart/services').expect(200);
    expect(results.body.data).toMatchInlineSnapshot(`
Object {
  "service1": Array [
    Object {
      "k8s.namespace.name": "namespace1",
      "k8s.pod.uid": "uid1",
    },
    Object {
      "k8s.namespace.name": "namespace1",
      "k8s.pod.uid": "uid2",
    },
  ],
  "service2": Array [
    Object {
      "k8s.namespace.name": "namespace2",
      "k8s.pod.uid": "uid3",
    },
  ],
}
`);
  });
});
