import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  getAgent,
  getLoggedInAgent,
  getServer,
  randomMongoId,
} from '@/fixtures';
import Alert, { AlertSource, AlertState } from '@/models/alert';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Webhook from '@/models/webhook';

describe('iac router', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET /iac/import-manifest returns lean id+name listings', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent
      .post('/dashboards')
      .send({ name: 'My Dashboard', tiles: [], tags: [] })
      .expect(200);

    const resp = await agent.get('/iac/import-manifest').expect(200);

    expect(resp.body.dashboards).toHaveLength(1);
    expect(resp.body.dashboards[0]).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      name: 'My Dashboard',
    });
    // No heavy fields leak through.
    expect(resp.body.dashboards[0]).not.toHaveProperty('tiles');
    expect(resp.body).toEqual(
      expect.objectContaining({
        alerts: [],
        savedSearches: [],
        sources: [],
        connections: [],
        webhooks: [],
      }),
    );
  });

  it('excludes provisioned dashboards', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    await Dashboard.create({
      name: 'Provisioned',
      tiles: [],
      team: team._id,
      provisioned: true,
    });

    const resp = await agent.get('/iac/import-manifest').expect(200);
    expect(resp.body.dashboards).toHaveLength(0);
  });

  it('rejects unauthenticated requests', async () => {
    const resp = await getAgent(server).get('/iac/import-manifest');
    expect(resp.status).toBe(401);
  });

  it('maps every resource type, not just dashboards', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    const connection = await Connection.create({
      team: team._id,
      name: 'Local ClickHouse',
      host: 'http://localhost:8123',
      username: 'default',
    });

    const source = await Source.create({
      kind: SourceKind.Log,
      name: 'Logs',
      team: team._id,
      connection: connection._id,
      from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp',
      defaultTableSelectExpression: 'Body',
    });

    const savedSearch = await SavedSearch.create({
      team: team._id,
      name: 'Production errors',
      select: '',
      where: 'level:error',
      source: source._id,
    });

    await Alert.create({
      team: team._id,
      name: 'Too many errors',
      source: AlertSource.SAVED_SEARCH,
      savedSearch: savedSearch._id,
      threshold: 10,
      interval: '5m',
      state: AlertState.OK,
      channel: { type: null },
    });

    await Webhook.create({
      team: team._id,
      name: 'Ops Slack',
      service: 'slack',
      url: 'https://hooks.slack.test/abc',
    });

    const resp = await agent.get('/iac/import-manifest').expect(200);

    expect(resp.body.savedSearches).toEqual([
      { id: savedSearch._id.toString(), name: 'Production errors' },
    ]);
    // `provisioned` is absent, not false — the export needs "unknown" to stay
    // distinguishable from an explicit self-managed marker.
    expect(resp.body.connections).toEqual([
      { id: expect.stringMatching(/^[a-f0-9]{24}$/), name: 'Local ClickHouse' },
    ]);
    expect(resp.body.connections[0]).not.toHaveProperty('provisioned');
    expect(resp.body.webhooks).toEqual([
      { id: expect.stringMatching(/^[a-f0-9]{24}$/), name: 'Ops Slack' },
    ]);
    expect(resp.body.sources).toHaveLength(1);
    expect(resp.body.sources[0].name).toBe('Logs');
    // The ObjectId -> string mapping on savedSearchId is the arm most likely
    // to regress silently, so pin it explicitly.
    expect(resp.body.alerts).toEqual([
      {
        id: expect.stringMatching(/^[a-f0-9]{24}$/),
        name: 'Too many errors',
        source: 'saved_search',
        savedSearchId: savedSearch._id.toString(),
      },
    ]);
  });

  it('surfaces an explicit provisioned marker on a connection', async () => {
    const { agent, team } = await getLoggedInAgent(server);

    await Connection.create({
      team: team._id,
      name: 'Cloud ClickHouse',
      host: 'https://abc.clickhouse.cloud:8443',
      username: 'default',
      provisioned: true,
    });

    const resp = await agent.get('/iac/import-manifest').expect(200);

    expect(resp.body.connections).toEqual([
      {
        id: expect.stringMatching(/^[a-f0-9]{24}$/),
        name: 'Cloud ClickHouse',
        provisioned: true,
      },
    ]);
  });

  // `provisioned` decides whether IaC export treats a connection as safe to
  // `terraform import`, so it must be server-owned. Adding it to the Mongoose
  // schema is what made a client-supplied value persistable at all — strict
  // mode used to drop it — so this pins the explicit strip in the router.
  it('ignores a client-supplied provisioned flag on connection create', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent
      .post('/connections')
      .send({
        name: 'Attacker ClickHouse',
        host: 'http://localhost:8123',
        username: 'default',
        password: '',
        provisioned: false,
      })
      .expect(200);

    const resp = await agent.get('/iac/import-manifest').expect(200);

    expect(resp.body.connections).toHaveLength(1);
    expect(resp.body.connections[0]).not.toHaveProperty('provisioned');
  });

  it("excludes every other team's resources", async () => {
    const { agent } = await getLoggedInAgent(server);
    const otherTeam = randomMongoId();

    await Dashboard.create({
      name: "Other team's dashboard",
      tiles: [],
      team: otherTeam,
    });
    await Alert.create({
      team: otherTeam,
      threshold: 1,
      interval: '5m',
      state: AlertState.OK,
      channel: { type: null },
    });
    await Connection.create({
      team: otherTeam,
      name: "Other team's connection",
      host: 'http://elsewhere:8123',
      username: 'default',
    });
    await Webhook.create({
      team: otherTeam,
      name: "Other team's webhook",
      service: 'slack',
      url: 'https://hooks.slack.test/other',
    });

    const resp = await agent.get('/iac/import-manifest').expect(200);

    // Dropping `{ team: teamId }` from any of the six finds must fail here.
    expect(resp.body).toEqual({
      dashboards: [],
      alerts: [],
      savedSearches: [],
      sources: [],
      connections: [],
      webhooks: [],
    });
  });
});
