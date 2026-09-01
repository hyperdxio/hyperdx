import {
  AlertThresholdType,
  MetricsDataType,
  PresetDashboard,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { omit } from 'lodash';
import mongoose, { Types } from 'mongoose';

import {
  getLoggedInAgent,
  getServer,
  makeAlertInput,
  makeRawSqlTile,
  makeTile,
} from '@/fixtures';
import Alert, { AlertSource } from '@/models/alert';
import Dashboard from '@/models/dashboard';
import PresetDashboardFilter from '@/models/presetDashboardFilter';
import { Source } from '@/models/source';
import User from '@/models/user';
import Webhook, { WebhookDocument, WebhookService } from '@/models/webhook';

const MOCK_DASHBOARD = {
  name: 'Test Dashboard',
  tiles: [makeTile(), makeTile(), makeTile(), makeTile(), makeTile()],
  tags: ['test'],
};

const makeMockAlert = (webhookId: string) => ({
  channel: { type: 'webhook' as const, webhookId },
  interval: '12h' as const,
  threshold: 1,
  thresholdType: AlertThresholdType.ABOVE,
});

describe('dashboard router', () => {
  const server = getServer();
  let agent: Awaited<ReturnType<typeof getLoggedInAgent>>['agent'];
  let team: Awaited<ReturnType<typeof getLoggedInAgent>>['team'];
  let user: Awaited<ReturnType<typeof getLoggedInAgent>>['user'];
  let webhook: WebhookDocument;

  beforeAll(async () => {
    await server.start();
  });

  beforeEach(async () => {
    const result = await getLoggedInAgent(server);
    agent = result.agent;
    team = result.team;
    user = result.user;
    webhook = await Webhook.create({
      name: 'Test Webhook',
      service: WebhookService.Slack,
      url: 'https://hooks.slack.com/test',
      team: team._id,
    });
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('can create a dashboard', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    expect(dashboard.body.name).toBe(MOCK_DASHBOARD.name);
    expect(dashboard.body.tiles.length).toBe(MOCK_DASHBOARD.tiles.length);
    expect(dashboard.body.tiles.map(tile => tile.id)).toEqual(
      MOCK_DASHBOARD.tiles.map(tile => tile.id),
    );
  });

  // Server-side migration shim for legacy `chart-1`..`chart-10` tokens
  // shipped by #2265. Stale-bundle React clients during a rolling deploy
  // and non-React HTTP callers (CI scripts, MCP, future external API
  // writes) can still send the numeric tokens; the route normalizes
  // them to hue-named equivalents *before* the strict
  // `ChartPaletteTokenSchema` runs, otherwise the request would 400.
  it('migrates legacy chart-N tile colors on POST', async () => {
    const tileWithLegacyColor = makeTile();
    tileWithLegacyColor.config = {
      ...tileWithLegacyColor.config,
      color: 'chart-1' as any,
    };

    const created = await agent
      .post('/dashboards')
      .send({
        name: 'Legacy Color Dashboard',
        tiles: [tileWithLegacyColor],
        tags: [],
      })
      .expect(200);

    expect(created.body.tiles[0].config.color).toBe('chart-green');
  });

  it('migrates legacy chart-N tile colors on PATCH', async () => {
    const created = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const patchedTile = {
      ...created.body.tiles[0],
      config: { ...created.body.tiles[0].config, color: 'chart-10' },
    };

    const updated = await agent
      .patch(`/dashboards/${created.body.id}`)
      .send({ tiles: [patchedTile, ...created.body.tiles.slice(1)] })
      .expect(200);

    expect(updated.body.tiles[0].config.color).toBe('chart-gray');
  });

  // Wire-format guarantee: GET emits canonical hue-named tokens even for
  // dashboards that pre-date the rename and still hold `chart-1`..`chart-10`
  // in Mongo. Without this, a non-React client (or a stale React bundle
  // that bypasses `normalizeDashboardTileColors`) could GET a legacy
  // color and round-trip it back through PATCH where the strict schema
  // would 400. Bypasses the API to seed the legacy value directly into
  // Mongo because the POST/PATCH middleware would otherwise rewrite it
  // before it ever reached the DB.
  //
  // The dashboards router currently only exposes a list GET (no
  // `/:id` single GET handler — single-dashboard reads on the React
  // side go through `useDashboards` and filter client-side). The
  // controller's `getDashboard` healer is still exercised in the same
  // process: `updateDashboard` calls `getDashboard` internally before
  // PATCH, so a follow-up no-op PATCH would surface a regression.
  it('returns hue-named tokens on GET (list) for a Mongo-seeded legacy chart-N tile', async () => {
    const tileWithLegacy = makeTile();
    (tileWithLegacy.config as any).color = 'chart-1';
    const seeded = await Dashboard.create({
      name: 'Pre-rename Dashboard',
      team: team._id,
      tiles: [tileWithLegacy],
      tags: [],
    });

    const list = await agent.get('/dashboards').expect(200);
    const fromList = list.body.find(d => d._id === seeded._id.toString());
    expect(fromList).toBeDefined();
    expect(fromList.tiles[0].config.color).toBe('chart-green');
  });

  it('sets createdBy and updatedBy on create and populates them in GET', async () => {
    const created = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    // GET all dashboards
    const allDashboards = await agent.get('/dashboards').expect(200);
    const dashboard = allDashboards.body.find(d => d._id === created.body.id);
    expect(dashboard.createdBy).toMatchObject({ email: user.email });
    expect(dashboard.updatedBy).toMatchObject({ email: user.email });
  });

  it('populates updatedBy with a different user after DB update', async () => {
    const created = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    // Create a second user on the same team
    const secondUser = await User.create({
      email: 'second@test.com',
      name: 'Second User',
      team: team._id,
    });

    // Simulate a different user updating the dashboard
    await Dashboard.findByIdAndUpdate(created.body.id, {
      updatedBy: secondUser._id,
    });

    const allDashboards = await agent.get('/dashboards').expect(200);
    const dashboard = allDashboards.body.find(d => d._id === created.body.id);
    expect(dashboard.createdBy).toMatchObject({ email: user.email });
    expect(dashboard.updatedBy).toMatchObject({
      email: 'second@test.com',
    });
  });

  it('can update a dashboard', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const updatedDashboard = await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboard.body,
        name: 'Updated Dashboard',
        tiles: dashboard.body.tiles.slice(1),
      })
      .expect(200);
    expect(updatedDashboard.body.name).toBe('Updated Dashboard');
    expect(updatedDashboard.body.tiles.length).toBe(
      dashboard.body.tiles.length - 1,
    );
    expect(updatedDashboard.body.tiles.map(tile => tile.id)).toEqual(
      dashboard.body.tiles.slice(1).map(tile => tile.id),
    );
  });

  it('returns 404 when patching a missing dashboard', async () => {
    await agent
      .patch(`/dashboards/${new mongoose.Types.ObjectId()}`)
      .send({ name: 'Missing Dashboard' })
      .expect(404);
  });

  it('can delete a dashboard', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    await agent.delete(`/dashboards/${dashboard.body.id}`).expect(204);
    const dashboards = await agent.get('/dashboards').expect(200);
    expect(dashboards.body.length).toBe(0);
  });

  it('alerts are created when creating dashboard', async () => {
    const mockAlert = makeMockAlert(webhook._id.toString());
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: mockAlert })],
        tags: [],
      })
      .expect(200);

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data).toMatchObject([
      {
        ...omit(mockAlert, 'channel.webhookId'),
        tileId: dashboard.body.tiles[0].id,
      },
    ]);

    const storedAlert = await Alert.findOne({
      team: team._id,
      dashboard: dashboard.body.id,
      tileId: dashboard.body.tiles[0].id,
      source: AlertSource.TILE,
    });
    expect(storedAlert).not.toBeNull();
    expect(storedAlert?.savedSearch).toBeNull();
    expect(storedAlert?.groupBy).toBeNull();
  });

  // A tile alert must always end up with a resolvable notification target.
  // Making `channel` optional briefly let a channels-only tile alert through
  // this path and persist with nothing to notify.
  it('persists a resolvable target for a channels-only tile alert', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [
          makeTile({
            alert: {
              channels: [
                { type: 'webhook' as const, webhookId: webhook._id.toString() },
              ],
              interval: '12h' as const,
              threshold: 1,
              thresholdType: AlertThresholdType.ABOVE,
            },
          }),
        ],
        tags: [],
      })
      .expect(200);

    const storedAlert = await Alert.findOne({
      team: team._id,
      dashboard: dashboard.body.id,
      source: AlertSource.TILE,
    });
    expect(storedAlert).not.toBeNull();
    expect(storedAlert?.channels).toEqual([
      { type: 'webhook', webhookId: webhook._id.toString() },
    ]);
    // The legacy mirror is what pre-multi-channel readers dispatch from.
    expect(storedAlert?.channel).toEqual({
      type: 'webhook',
      webhookId: webhook._id.toString(),
    });
  });

  it('rejects a tile alert with no notification channel', async () => {
    await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [
          makeTile({
            alert: {
              interval: '12h' as const,
              threshold: 1,
              thresholdType: AlertThresholdType.ABOVE,
            },
          }),
        ],
        tags: [],
      })
      .expect(400);
  });

  it('alerts are created when updating dashboard (adding alert to tile)', async () => {
    const mockAlert = makeMockAlert(webhook._id.toString());
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const updatedDashboard = await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboard.body,
        tiles: [...dashboard.body.tiles, makeTile({ alert: mockAlert })],
      })
      .expect(200);

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data).toMatchObject([
      {
        ...omit(mockAlert, 'channel.webhookId'),
        tileId: updatedDashboard.body.tiles[MOCK_DASHBOARD.tiles.length].id,
      },
    ]);
  });

  it('alerts are deleted when updating dashboard (deleting tile alert settings)', async () => {
    const mockAlert = makeMockAlert(webhook._id.toString());
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: mockAlert })],
        tags: [],
      })
      .expect(200);

    await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboard.body,
        tiles: dashboard.body.tiles.slice(1),
      })
      .expect(200);

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data).toEqual([]);
  });

  it('alerts are deleted when removing alert from tile (keeping tile)', async () => {
    const mockAlert = makeMockAlert(webhook._id.toString());
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: mockAlert })],
        tags: [],
      })
      .expect(200);

    // Remove alert from tile but keep the tile
    await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboard.body,
        tiles: [
          {
            ...dashboard.body.tiles[0],
            config: {
              ...dashboard.body.tiles[0].config,
              alert: undefined, // Remove the alert
            },
          },
        ],
      })
      .expect(200);

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data).toEqual([]);
  });

  it('alerts are updated when updating dashboard (updating tile alert settings)', async () => {
    const mockAlert = makeMockAlert(webhook._id.toString());
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: mockAlert })],
        tags: [],
      })
      .expect(200);

    const updatedAlert = {
      ...mockAlert,
      threshold: 2,
    };

    await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({
        ...dashboard.body,
        tiles: [
          {
            ...dashboard.body.tiles[0],
            config: {
              ...dashboard.body.tiles[0].config,
              alert: updatedAlert,
            },
          },
        ],
      })
      .expect(200);

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data).toMatchObject([
      {
        ...omit(updatedAlert, 'channel.webhookId'),
        tileId: dashboard.body.tiles[0].id,
      },
    ]);

    const storedAlerts = await Alert.find({
      team: team._id,
      dashboard: dashboard.body.id,
      tileId: dashboard.body.tiles[0].id,
      source: AlertSource.TILE,
    });
    expect(storedAlerts).toHaveLength(1);
    expect(storedAlerts[0].threshold).toBe(updatedAlert.threshold);
  });

  it('deletes alert when tile is updated from builder to raw SQL config', async () => {
    const builderTile = makeTile();
    const dashboard = await agent
      .post('/dashboards')
      .send({ name: 'Test Dashboard', tiles: [builderTile], tags: [] })
      .expect(200);

    // Create a standalone alert for the builder tile
    await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: builderTile.id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);

    expect((await agent.get('/alerts').expect(200)).body.data.length).toBe(1);

    // Update the tile to a raw SQL config (same tile ID)
    const rawSqlTile = makeRawSqlTile({ id: builderTile.id });
    await agent
      .patch(`/dashboards/${dashboard.body.id}`)
      .send({ tiles: [rawSqlTile] })
      .expect(200);

    const alertsAfter = await agent.get('/alerts').expect(200);
    expect(alertsAfter.body.data).toEqual([]);
  });

  it('deletes attached alerts when deleting tiles', async () => {
    await agent.post('/dashboards').send(MOCK_DASHBOARD).expect(200);
    const initialDashboards = await agent.get('/dashboards').expect(200);

    // Create alerts for all charts
    const dashboard = initialDashboards.body[0];
    await Promise.all(
      dashboard.tiles.map(tile =>
        agent
          .post('/alerts')
          .send(
            makeAlertInput({
              dashboardId: dashboard._id,
              tileId: tile.id,
              webhookId: webhook._id.toString(),
            }),
          )
          .expect(200),
      ),
    );

    // Make sure all alerts are attached to the dashboard charts
    const allTiles = dashboard.tiles.map(tile => tile.id).sort();
    const alertsPreDelete = await agent.get(`/alerts`).expect(200);
    const alertsPreDeleteTiles = alertsPreDelete.body.data
      .map(alert => alert.tileId)
      .sort();
    expect(allTiles).toEqual(alertsPreDeleteTiles);

    // Delete the first chart
    const dashboardPreDelete = await agent
      .get('/dashboards')
      .expect(200)
      .then(res => res.body[0]);
    await agent
      .patch(`/dashboards/${dashboard._id}`)
      .send({
        ...dashboardPreDelete,
        tiles: dashboardPreDelete.tiles.slice(1),
      })
      .expect(200);

    const dashboardPostDelete = await agent
      .get('/dashboards')
      .expect(200)
      .then(res => res.body[0]);

    // Make sure all alerts are attached to the dashboard charts
    const allTilesPostDelete = dashboardPostDelete.tiles
      .map(tile => tile.id)
      .sort();
    const alertsPostDelete = await agent.get(`/alerts`).expect(200);
    const alertsPostDeleteTiles = alertsPostDelete.body.data
      .map(alert => alert.tileId)
      .sort();
    expect(allTilesPostDelete).toEqual(alertsPostDeleteTiles);
  });

  it('alert on a tile only appears on the dashboard that owns it, not on another dashboard with the same tile ID', async () => {
    const sharedTileId = new mongoose.Types.ObjectId().toHexString();
    const mockAlert = makeMockAlert(webhook._id.toString());

    // Create dashboard A with an alert on the tile
    const dashboardA = await agent
      .post('/dashboards')
      .send({
        name: 'Dashboard A',
        tiles: [makeTile({ id: sharedTileId, alert: mockAlert })],
        tags: [],
      })
      .expect(200);

    // Create dashboard B with a tile that has the same ID, but no alert
    const dashboardB = await agent
      .post('/dashboards')
      .send({
        name: 'Dashboard B',
        tiles: [makeTile({ id: sharedTileId })],
        tags: [],
      })
      .expect(200);

    // Fetch all dashboards
    const dashboards = await agent.get('/dashboards').expect(200);

    const fetchedA = dashboards.body.find(
      (d: any) => d._id === dashboardA.body.id,
    );
    const fetchedB = dashboards.body.find(
      (d: any) => d._id === dashboardB.body.id,
    );

    // The alert should appear on dashboard A's tile
    expect(fetchedA.tiles[0].config.alert).toBeTruthy();
    expect(fetchedA.tiles[0].config.alert.tileId).toBe(sharedTileId);

    // The alert should NOT appear on dashboard B's tile
    expect(fetchedB.tiles[0].config.alert).toBeUndefined();
  });

  it('preserves alert creator when different user updates dashboard', async () => {
    const mockAlert = makeMockAlert(webhook._id.toString());
    const currentUser = user;

    // Arrange: Create dashboard with alert
    const dashboardResponse = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [makeTile({ alert: mockAlert })],
        tags: [],
      })
      .expect(200);

    const dashboard = dashboardResponse.body;
    const tileId = dashboard.tiles[0].id;

    // Setup: Simulate alert created by different user
    const originalAlert = await Alert.findOne({ tileId });

    if (!originalAlert) {
      throw new Error('Original alert not found');
    }

    // Set the original creator to a different user
    const originalCreatorId = new mongoose.Types.ObjectId();
    originalAlert.createdBy = originalCreatorId;
    await originalAlert.save({ validateBeforeSave: false });

    // Act: Current user updates the dashboard (modifies alert threshold)
    const updatedThreshold = 5;
    const updatedAlert = {
      ...mockAlert,
      threshold: updatedThreshold,
    };

    await agent
      .patch(`/dashboards/${dashboard.id}`)
      .send({
        ...dashboard,
        tiles: [
          {
            ...dashboard.tiles[0],
            config: {
              ...dashboard.tiles[0].config,
              alert: updatedAlert,
            },
          },
        ],
      })
      .expect(200);

    // Assert: Verify alert preserves original creator and updates threshold
    const updatedAlertRecord = await Alert.findOne({ tileId });
    expect(updatedAlertRecord).toBeTruthy();

    if (!updatedAlertRecord) {
      throw new Error('Updated alert record not found');
    }

    // Alert should preserve original creator
    if (!updatedAlertRecord.createdBy) {
      throw new Error('Updated alert record has no creator');
    }

    expect(updatedAlertRecord.createdBy.toString()).toBe(
      originalCreatorId.toString(),
    );
    expect(updatedAlertRecord.createdBy.toString()).not.toBe(
      currentUser._id.toString(),
    );

    // Alert should have updated threshold
    expect(updatedAlertRecord.threshold).toBe(updatedThreshold);
  });

  describe('dashboard filter variable fields', () => {
    const makeVariableFilter = (overrides = {}) => ({
      id: new Types.ObjectId().toString(),
      type: 'QUERY_EXPRESSION' as const,
      name: 'Service Name',
      expression: 'ServiceName',
      source: new Types.ObjectId().toString(),
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'Service_Name',
      ...overrides,
    });

    it('persists the variable fields on create', async () => {
      const filter = makeVariableFilter();

      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      expect(created.body.filters).toEqual([filter]);

      const stored = await Dashboard.findById(created.body.id).lean();
      expect(stored?.filters).toEqual([filter]);
    });

    it('leaves the variable fields absent when they are not sent', async () => {
      // Absence is meaningful: `isBroadcastEnabled` is read as enabled when
      // missing, so the server must not materialize a value on the way in.
      const filter = {
        id: new Types.ObjectId().toString(),
        type: 'QUERY_EXPRESSION' as const,
        name: 'Service Name',
        expression: 'ServiceName',
        source: new Types.ObjectId().toString(),
      };

      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      const stored = await Dashboard.findById(created.body.id).lean();
      expect(stored?.filters?.[0]).not.toHaveProperty('isBroadcastEnabled');
      expect(stored?.filters?.[0]).not.toHaveProperty('isVariableEnabled');
      expect(stored?.filters?.[0]).not.toHaveProperty('variableName');
    });

    it('persists updated variable fields on PATCH', async () => {
      const filter = makeVariableFilter();
      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      const updatedFilter = {
        ...filter,
        isBroadcastEnabled: true,
        isVariableEnabled: false,
      };
      await agent
        .patch(`/dashboards/${created.body.id}`)
        .send({ filters: [updatedFilter] })
        .expect(200);

      const stored = await Dashboard.findById(created.body.id).lean();
      expect(stored?.filters).toEqual([updatedFilter]);
    });

    it('leaves stored filters untouched on a PATCH that omits filters', async () => {
      const filter = makeVariableFilter();
      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      await agent
        .patch(`/dashboards/${created.body.id}`)
        .send({ name: 'Renamed Dashboard' })
        .expect(200);

      const stored = await Dashboard.findById(created.body.id).lean();
      expect(stored?.name).toBe('Renamed Dashboard');
      expect(stored?.filters).toEqual([filter]);
    });

    it('rejects a variableName that is not a bare token', async () => {
      await agent
        .post('/dashboards')
        .send({
          ...MOCK_DASHBOARD,
          filters: [makeVariableFilter({ variableName: 'has space' })],
        })
        .expect(400);
    });

    // The form blocks duplicates client-side, but the API is reachable directly,
    // so the same rule has to hold server-side or a dashboard can end up with an
    // ambiguous `$var` reference.
    describe('variable name uniqueness', () => {
      it('rejects two variable-enabled filters sharing a variable name on create', async () => {
        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({ variableName: 'service' }),
              makeVariableFilter({ variableName: 'service' }),
            ],
          })
          .expect(400);
      });

      it('rejects a duplicate introduced by PATCH', async () => {
        const created = await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [makeVariableFilter({ variableName: 'service' })],
          })
          .expect(200);

        await agent
          .patch(`/dashboards/${created.body.id}`)
          .send({
            filters: [
              makeVariableFilter({ variableName: 'service' }),
              makeVariableFilter({ variableName: 'service' }),
            ],
          })
          .expect(400);
      });

      it('rejects a clash against a name derived from the filter name', async () => {
        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              // Derives to `Service_Name`.
              makeVariableFilter({
                name: 'Service Name',
                variableName: undefined,
              }),
              makeVariableFilter({ variableName: 'Service_Name' }),
            ],
          })
          .expect(400);
      });

      it('accepts distinct variable names', async () => {
        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({ variableName: 'service' }),
              makeVariableFilter({ variableName: 'environment' }),
            ],
          })
          .expect(200);
      });

      // Nobody who never enabled the feature can be blocked by this rule, even
      // though the rule itself always runs.
      it('accepts duplicate names when the filters are not variable-enabled', async () => {
        const created = await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({
                variableName: 'service',
                isVariableEnabled: false,
                isBroadcastEnabled: true,
              }),
              makeVariableFilter({
                variableName: 'service',
                isVariableEnabled: undefined,
                isBroadcastEnabled: true,
              }),
            ],
          })
          .expect(200);

        expect(created.body.filters).toHaveLength(2);
      });

      // The shape a pre-feature dashboard has: no variable fields at all, and
      // two filters that legitimately share a display name on different sources.
      it('accepts identically named filters that carry no variable fields', async () => {
        const legacyFilter = {
          id: new Types.ObjectId().toString(),
          type: 'QUERY_EXPRESSION' as const,
          name: 'Service Name',
          expression: 'ServiceName',
          source: new Types.ObjectId().toString(),
        };

        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              legacyFilter,
              { ...legacyFilter, id: new Types.ObjectId().toString() },
            ],
          })
          .expect(200);
      });

      // Without this, a variable-enabled filter could persist with no token any
      // tile could reference: the schema allows `variableName` to be omitted, and
      // the display name has nothing token-safe to derive one from.
      it('rejects a variable-enabled filter whose name yields no usable variable name', async () => {
        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({ name: '环境', variableName: undefined }),
            ],
          })
          .expect(400);
      });

      it('accepts an unusable filter name when an explicit variable name is sent', async () => {
        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({ name: '环境', variableName: 'env' }),
            ],
          })
          .expect(200);
      });

      it('accepts an unusable filter name when the filter is not variable-enabled', async () => {
        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({
                name: '环境',
                variableName: undefined,
                isVariableEnabled: false,
                isBroadcastEnabled: true,
              }),
            ],
          })
          .expect(200);
      });
    });

    describe('at least one mode enabled', () => {
      it('rejects a filter with both modes off on create', async () => {
        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({
                isBroadcastEnabled: false,
                isVariableEnabled: false,
              }),
            ],
          })
          .expect(400);
      });

      it('treats an omitted variable flag as off', () =>
        agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({
                isBroadcastEnabled: false,
                isVariableEnabled: undefined,
                variableName: undefined,
              }),
            ],
          })
          .expect(400));

      it('rejects the state when PATCH introduces it', async () => {
        const filter = makeVariableFilter();
        const created = await agent
          .post('/dashboards')
          .send({ ...MOCK_DASHBOARD, filters: [filter] })
          .expect(200);

        await agent
          .patch(`/dashboards/${created.body.id}`)
          .send({
            filters: [{ ...filter, isVariableEnabled: false }],
          })
          .expect(400);

        // The stored filter is untouched by the rejected PATCH.
        const stored = await Dashboard.findById(created.body.id).lean();
        expect(stored?.filters).toEqual([filter]);
      });

      it('accepts broadcast-only and variable-only filters', async () => {
        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({
                variableName: 'broadcast_only',
                isBroadcastEnabled: true,
                isVariableEnabled: false,
              }),
              makeVariableFilter({
                variableName: 'variable_only',
                isBroadcastEnabled: false,
                isVariableEnabled: true,
              }),
            ],
          })
          .expect(200);
      });

      // Backwards compatibility: a missing `isBroadcastEnabled` reads as
      // enabled, so no dashboard written before the field existed can be
      // rejected — nor can one round-tripped by a client that drops it.
      it('accepts a filter that carries neither flag', async () => {
        const created = await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({
                isBroadcastEnabled: undefined,
                isVariableEnabled: undefined,
                variableName: undefined,
              }),
            ],
          })
          .expect(200);

        const stored = await Dashboard.findById(created.body.id).lean();
        expect(stored?.filters?.[0]).not.toHaveProperty('isBroadcastEnabled');
      });

      it('reports the offending filter by index', async () => {
        const response = await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makeVariableFilter({ variableName: 'ok' }),
              makeVariableFilter({
                name: 'Broken',
                variableName: 'broken',
                isBroadcastEnabled: false,
                isVariableEnabled: false,
              }),
            ],
          })
          .expect(400);

        // Only the second filter is flagged, and the path points at it.
        expect(response.body[0].errors.issues).toEqual([
          expect.objectContaining({
            message:
              'Filter "Broken" must broadcast its value, be available as a variable, or both',
            path: ['filters', 1, 'isBroadcastEnabled'],
          }),
        ]);
      });
    });
  });

  describe('static-list filters', () => {
    const makeStaticFilter = (overrides = {}) => ({
      id: new Types.ObjectId().toString(),
      type: 'STATIC_LIST' as const,
      name: 'Environment',
      options: ['prod', 'staging', 'dev'],
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'env',
      ...overrides,
    });

    it('persists a static-list filter on create and returns it on GET', async () => {
      const filter = makeStaticFilter();

      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      expect(created.body.filters).toEqual([filter]);

      const listed = await agent.get('/dashboards').expect(200);
      expect(
        listed.body.find(
          (dashboard: { _id: string }) => dashboard._id === created.body.id,
        )?.filters,
      ).toEqual([filter]);

      const stored = await Dashboard.findById(created.body.id).lean();
      expect(stored?.filters).toEqual([filter]);
      // The queried-filter fields have to stay absent, not be materialized as
      // null: `expression` falsiness is what makes `$__filter($env)` report
      // that the expression must be passed explicitly.
      expect(stored?.filters?.[0]).not.toHaveProperty('expression');
      expect(stored?.filters?.[0]).not.toHaveProperty('source');
    });

    it('preserves the authored option order', async () => {
      const filter = makeStaticFilter({ options: ['prod', 'staging', 'dev'] });

      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      expect(created.body.filters[0].options).toEqual([
        'prod',
        'staging',
        'dev',
      ]);
    });

    it('persists an updated option list on PATCH', async () => {
      const filter = makeStaticFilter();
      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      const updatedFilter = { ...filter, options: ['prod', 'canary'] };
      await agent
        .patch(`/dashboards/${created.body.id}`)
        .send({ filters: [updatedFilter] })
        .expect(200);

      const stored = await Dashboard.findById(created.body.id).lean();
      expect(stored?.filters).toEqual([updatedFilter]);
    });

    it('accepts a static filter alongside a queried one', async () => {
      await agent
        .post('/dashboards')
        .send({
          ...MOCK_DASHBOARD,
          filters: [
            makeStaticFilter(),
            {
              id: new Types.ObjectId().toString(),
              type: 'QUERY_EXPRESSION' as const,
              name: 'Service',
              expression: 'ServiceName',
              source: new Types.ObjectId().toString(),
            },
          ],
        })
        .expect(200);
    });

    // The modes are literals on the static variant and `options` is `.min(1)`,
    // so these are structural rejections; duplicate options are the one rule
    // still carried by a refinement.
    it.each([
      ['broadcast enabled', { isBroadcastEnabled: true }],
      ['broadcast unset', { isBroadcastEnabled: undefined }],
      ['not variable-enabled', { isVariableEnabled: false }],
      ['variables unset', { isVariableEnabled: undefined }],
      ['no options', { options: undefined }],
      ['an empty option list', { options: [] }],
      ['duplicate options', { options: ['prod', 'prod'] }],
    ])('rejects a static filter with %s', async (_label, overrides) => {
      await agent
        .post('/dashboards')
        .send({
          ...MOCK_DASHBOARD,
          filters: [makeStaticFilter(overrides)],
        })
        .expect(400);
    });

    // A query-expression field on a static filter is accepted and persisted
    // verbatim, exactly like any other unknown key on this route: the internal
    // filter variants are not strict (a strict variant would turn a stray key
    // left in Mongo by an older version into a failed save, since the edit form
    // spreads the stored filter back into its payload), and `validateRequest`
    // validates without replacing `req.body`, so nothing is stripped either.
    // The extra fields are inert — every reader narrows on `type` — and the
    // external API, which is strict, rejects the same payload outright.
    it('persists a query-expression field sent on a static filter, inert', async () => {
      const filter = makeStaticFilter();
      const withStrayFields = {
        ...filter,
        expression: 'ServiceName',
        where: "ServiceName = 'api'",
      };

      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [withStrayFields] })
        .expect(200);

      expect(created.body.filters).toEqual([withStrayFields]);

      // Still reads back as a valid static filter, and template export drops
      // the stray keys (see `convertToDashboardTemplate` in common-utils).
      const stored = await Dashboard.findById(created.body.id).lean();
      expect(stored?.filters?.[0]).toMatchObject({
        type: 'STATIC_LIST',
        options: ['prod', 'staging', 'dev'],
        isBroadcastEnabled: false,
        isVariableEnabled: true,
      });
    });

    it('rejects the state when PATCH introduces it, leaving the stored filter alone', async () => {
      const filter = makeStaticFilter();
      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      await agent
        .patch(`/dashboards/${created.body.id}`)
        .send({ filters: [{ ...filter, options: [] }] })
        .expect(400);

      const stored = await Dashboard.findById(created.body.id).lean();
      expect(stored?.filters).toEqual([filter]);
    });

    // The requiredness of both fields moved out of the field-level schema when
    // `STATIC_LIST` made them optional, so it has to keep holding here.
    it.each(['expression', 'source'])(
      'still rejects a query-expression filter with no %s',
      async field => {
        const response = await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              {
                id: new Types.ObjectId().toString(),
                type: 'QUERY_EXPRESSION' as const,
                name: 'Service',
                expression: 'ServiceName',
                source: new Types.ObjectId().toString(),
                [field]: undefined,
              },
            ],
          })
          .expect(400);

        expect(response.body[0].errors.issues).toEqual([
          expect.objectContaining({ path: ['filters', 0, field] }),
        ]);
      },
    );
  });

  describe('promql-label filters', () => {
    const createPromqlSource = () =>
      Source.create({
        kind: SourceKind.Promql,
        name: 'Test PromQL Source',
        team: team._id,
        connection: new Types.ObjectId().toString(),
        from: { databaseName: 'test_db', tableName: 'timeseries_table' },
        timestampValueExpression: 'timestamp',
      });

    // The route rejects a filter naming anything but a live PromQL source, so
    // every case here needs a real one.
    let promqlSourceId: string;
    beforeEach(async () => {
      promqlSourceId = (await createPromqlSource())._id.toString();
    });

    const makePromqlFilter = (overrides = {}) => ({
      id: new Types.ObjectId().toString(),
      type: 'PROMETHEUS_LABEL' as const,
      name: 'Pod',
      source: promqlSourceId,
      label: 'pod',
      isBroadcastEnabled: false,
      isVariableEnabled: true,
      variableName: 'pod',
      ...overrides,
    });

    it('persists a promql-label filter on create and returns it on GET', async () => {
      const filter = makePromqlFilter();

      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      expect(created.body.filters).toEqual([filter]);

      const stored = await Dashboard.findById(created.body.id).lean();
      expect(stored?.filters).toEqual([filter]);
      // Same reason as the static variant: an absent `expression` is what makes
      // `$__filter($pod)` report that the expression must be passed explicitly.
      expect(stored?.filters?.[0]).not.toHaveProperty('expression');
    });

    // Prometheus 3 allows UTF-8 label names, and a ClickHouse-backed source's
    // tags map holds whatever the collector ingested.
    it('persists a dotted OTel-shaped label', async () => {
      const filter = makePromqlFilter({ label: 'k8s.pod.name' });

      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      expect(created.body.filters).toEqual([filter]);
    });

    it('persists an updated label on PATCH', async () => {
      const filter = makePromqlFilter();
      const created = await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [filter] })
        .expect(200);

      const updatedFilter = { ...filter, label: 'namespace' };
      await agent
        .patch(`/dashboards/${created.body.id}`)
        .send({ filters: [updatedFilter] })
        .expect(200);

      const stored = await Dashboard.findById(created.body.id).lean();
      expect(stored?.filters).toEqual([updatedFilter]);
    });

    it.each([
      ['broadcast enabled', { isBroadcastEnabled: true }],
      ['broadcast unset', { isBroadcastEnabled: undefined }],
      ['not variable-enabled', { isVariableEnabled: false }],
      ['variables unset', { isVariableEnabled: undefined }],
      ['no source', { source: undefined }],
      ['no label', { label: undefined }],
      ['an empty label', { label: '' }],
    ])('rejects a promql-label filter with %s', async (_label, overrides) => {
      await agent
        .post('/dashboards')
        .send({ ...MOCK_DASHBOARD, filters: [makePromqlFilter(overrides)] })
        .expect(400);
    });

    // Resolving one of these reads the source's connection and db/table, which
    // only a PromQL source carries — so unlike every other source reference on
    // this route, a bad id is rejected rather than saved.
    describe('source validation', () => {
      it('rejects a filter naming a source that does not exist', async () => {
        const source = new Types.ObjectId().toString();

        const response = await agent
          .post('/dashboards')
          .send({ ...MOCK_DASHBOARD, filters: [makePromqlFilter({ source })] })
          .expect(400);

        expect(response.body.message).toContain(source);
      });

      it('rejects a filter naming a source of the wrong kind', async () => {
        const logSource = await Source.create({
          kind: SourceKind.Log,
          name: 'Test Log Source',
          team: team._id,
          connection: new Types.ObjectId().toString(),
          from: { databaseName: 'test_db', tableName: 'logs_table' },
          timestampValueExpression: 'timestamp',
          defaultTableSelectExpression: 'body',
        });

        const response = await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [makePromqlFilter({ source: logSource._id.toString() })],
          })
          .expect(400);

        expect(response.body.message).toContain(logSource._id.toString());
      });

      // The lookup is team-scoped, so another team's PromQL source is as good
      // as absent.
      it("rejects another team's PromQL source", async () => {
        const otherTeamSource = await Source.create({
          kind: SourceKind.Promql,
          name: 'Other Team PromQL Source',
          team: new Types.ObjectId(),
          connection: new Types.ObjectId().toString(),
          from: { databaseName: 'test_db', tableName: 'timeseries_table' },
          timestampValueExpression: 'timestamp',
        });

        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              makePromqlFilter({ source: otherTeamSource._id.toString() }),
            ],
          })
          .expect(400);
      });

      it('rejects the source when PATCH introduces it, leaving the stored filter alone', async () => {
        const filter = makePromqlFilter();
        const created = await agent
          .post('/dashboards')
          .send({ ...MOCK_DASHBOARD, filters: [filter] })
          .expect(200);

        await agent
          .patch(`/dashboards/${created.body.id}`)
          .send({
            filters: [{ ...filter, source: new Types.ObjectId().toString() }],
          })
          .expect(400);

        const stored = await Dashboard.findById(created.body.id).lean();
        expect(stored?.filters).toEqual([filter]);
      });

      // The fetch is skipped entirely when no filter of this type is present,
      // so a queried filter naming a missing source still saves as before.
      it('leaves other filter types unvalidated', async () => {
        await agent
          .post('/dashboards')
          .send({
            ...MOCK_DASHBOARD,
            filters: [
              {
                id: new Types.ObjectId().toString(),
                type: 'QUERY_EXPRESSION' as const,
                name: 'Service',
                expression: 'ServiceName',
                source: new Types.ObjectId().toString(),
              },
            ],
          })
          .expect(200);
      });
    });

    it('rejects a variable name it shares with another filter', async () => {
      await agent
        .post('/dashboards')
        .send({
          ...MOCK_DASHBOARD,
          filters: [
            makePromqlFilter({ variableName: 'pod' }),
            {
              id: new Types.ObjectId().toString(),
              type: 'QUERY_EXPRESSION' as const,
              name: 'Pod (logs)',
              expression: 'PodName',
              source: new Types.ObjectId().toString(),
              isVariableEnabled: true,
              variableName: 'pod',
            },
          ],
        })
        .expect(400);
    });
  });

  describe('preset dashboards', () => {
    const MOCK_SOURCE: Omit<Extract<TSource, { kind: 'log' }>, 'id'> = {
      kind: SourceKind.Log,
      name: 'Test Source',
      connection: new Types.ObjectId().toString(),
      from: {
        databaseName: 'test_db',
        tableName: 'test_table',
      },
      timestampValueExpression: 'timestamp',
      defaultTableSelectExpression: 'body',
    };

    const MOCK_PRESET_DASHBOARD_FILTER = {
      name: 'Test Filter',
      type: 'QUERY_EXPRESSION',
      expression: 'service.name:test-service',
      presetDashboard: PresetDashboard.Services,
    };

    describe('GET /preset/:presetDashboard/filters', () => {
      it('returns preset dashboard filters for a given source', async () => {
        // Create a test source
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        // Create a preset dashboard filter
        const filter = await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team._id,
          source: source._id,
        });

        const response = await agent
          .get(`/dashboards/preset/${PresetDashboard.Services}/filters`)
          .query({ sourceId: source._id.toString() })
          .expect(200);

        expect(response.body).toHaveLength(1);
        expect(response.body[0]).toMatchObject({
          name: MOCK_PRESET_DASHBOARD_FILTER.name,
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: MOCK_PRESET_DASHBOARD_FILTER.expression,
          presetDashboard: MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
          source: source._id.toString(),
          id: filter._id.toString(),
        });
      });

      it('returns empty array when no filters exist for source', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const response = await agent
          .get(`/dashboards/preset/${PresetDashboard.Services}/filters`)
          .query({ sourceId: source._id.toString() })
          .expect(200);

        expect(response.body).toEqual([]);
      });

      it('returns 400 when sourceId is missing', async () => {
        await agent
          .get(`/dashboards/preset/${PresetDashboard.Services}/filters`)
          .expect(400);
      });

      it('returns 400 when sourceId is empty', async () => {
        await agent
          .get(`/dashboards/preset/${PresetDashboard.Services}/filters`)
          .query({ sourceId: '' })
          .expect(400);
      });

      it('returns 400 for invalid preset dashboard type', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        await agent
          .get('/dashboards/preset/invalid-dashboard/filters')
          .query({ sourceId: source._id.toString() })
          .expect(400);
      });

      it('does not return filters from other teams in GET', async () => {
        const team2 = new mongoose.Types.ObjectId();

        const source1 = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const source2 = await Source.create({
          ...MOCK_SOURCE,
          team: team2,
        });

        await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team._id,
          source: source1._id,
        });

        await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team2,
          source: source2._id,
        });

        const response = await agent
          .get(`/dashboards/preset/${PresetDashboard.Services}/filters`)
          .query({ sourceId: source1._id.toString() })
          .expect(200);

        expect(response.body).toHaveLength(1);
        expect(response.body[0].team).toEqual(team._id.toString());
      });
    });

    describe('POST /preset/:presetDashboard/filter', () => {
      it('creates a new preset dashboard filter', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const filterInput = {
          ...MOCK_PRESET_DASHBOARD_FILTER,
          id: new Types.ObjectId().toString(),
          source: source._id.toString(),
        };

        const response = await agent
          .post(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: filterInput })
          .expect(200);

        expect(response.body).toMatchObject({
          name: MOCK_PRESET_DASHBOARD_FILTER.name,
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: MOCK_PRESET_DASHBOARD_FILTER.expression,
          presetDashboard: MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
        });

        // Verify filter was created in database
        const filters = await PresetDashboardFilter.find({ team: team._id });
        expect(filters).toHaveLength(1);
        expect(filters[0]._id.toString()).toBe(response.body.id);
        expect(filters[0].source.toString()).toBe(source._id.toString());
        expect(filters[0].team.toString()).toBe(team._id.toString());
        expect(filters[0].name).toBe(MOCK_PRESET_DASHBOARD_FILTER.name);
        expect(filters[0].type).toBe(MOCK_PRESET_DASHBOARD_FILTER.type);
        expect(filters[0].expression).toBe(
          MOCK_PRESET_DASHBOARD_FILTER.expression,
        );
        expect(filters[0].presetDashboard).toBe(
          MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
        );
      });

      it('creates filter with optional sourceMetricType', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const filterInput = {
          ...MOCK_PRESET_DASHBOARD_FILTER,
          id: new Types.ObjectId().toString(),
          source: source._id.toString(),
          sourceMetricType: MetricsDataType.Gauge,
        };

        const response = await agent
          .post(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: filterInput })
          .expect(200);

        expect(response.body.sourceMetricType).toBe(MetricsDataType.Gauge);
      });

      it('returns 400 when filter preset dashboard does not match params', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const filterInput = {
          ...MOCK_PRESET_DASHBOARD_FILTER,
          id: new Types.ObjectId().toString(),
          source: source._id.toString(),
          presetDashboard: PresetDashboard.Services,
        };

        // Try to create with mismatched preset dashboard in URL
        await agent
          .post('/dashboards/preset/invalid-dashboard/filter')
          .send({ filter: filterInput })
          .expect(400);
      });

      // Preset dashboards render the filter form with variables hidden, and a
      // static filter is variable-only, so there is no way to author one here.
      it('returns 400 for a STATIC_LIST preset filter', async () => {
        const response = await agent
          .post(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({
            filter: {
              id: new Types.ObjectId().toString(),
              type: 'STATIC_LIST',
              name: 'Environment',
              options: ['prod', 'staging', 'dev'],
              isBroadcastEnabled: false,
              isVariableEnabled: true,
              variableName: 'env',
              presetDashboard: PresetDashboard.Services,
            },
          })
          .expect(400);

        // The preset schema extends the query-expression variant, so the type
        // literal fails alongside the fields that variant requires.
        expect(response.body[0].errors.issues).toContainEqual(
          expect.objectContaining({ path: ['filter', 'type'] }),
        );
      });

      it.each(['expression', 'source'])(
        'returns 400 for a preset filter with no %s',
        async field => {
          const source = await Source.create({
            ...MOCK_SOURCE,
            team: team._id,
          });

          await agent
            .post(`/dashboards/preset/${PresetDashboard.Services}/filter`)
            .send({
              filter: {
                ...MOCK_PRESET_DASHBOARD_FILTER,
                id: new Types.ObjectId().toString(),
                source: source._id.toString(),
                [field]: undefined,
              },
            })
            .expect(400);
        },
      );

      it('returns 400 when filter is missing required fields', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const incompleteFilter = {
          name: 'Test Filter',
          source: source._id.toString(),
          // Missing type, expression, presetDashboard
        };

        await agent
          .post(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: incompleteFilter })
          .expect(400);
      });

      it('returns 400 when filter body is missing', async () => {
        await agent
          .post(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({})
          .expect(400);
      });
    });

    describe('PUT /preset/:presetDashboard/filter', () => {
      it('updates an existing preset dashboard filter', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        // Create initial filter
        const existingFilter = await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team._id,
          source: source._id,
        });

        const updatedFilterInput = {
          id: existingFilter._id.toString(),
          name: 'Updated Filter Name',
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: 'service.name:updated-service',
          presetDashboard: MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
          source: source._id.toString(),
        };

        const response = await agent
          .put(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: updatedFilterInput })
          .expect(200);

        expect(response.body).toMatchObject({
          name: 'Updated Filter Name',
          expression: 'service.name:updated-service',
        });

        // Verify filter was updated in database
        const updatedFilter = await PresetDashboardFilter.findById(
          existingFilter._id,
        );
        expect(updatedFilter?.name).toBe('Updated Filter Name');
        expect(updatedFilter?.expression).toBe('service.name:updated-service');
      });

      it('returns an error when the filter does not exist', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const newFilterInput = {
          id: new Types.ObjectId().toString(),
          name: 'New Filter',
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: 'service.name:new-service',
          presetDashboard: MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
          source: source._id.toString(),
        };

        await agent
          .put(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: newFilterInput })
          .expect(404);
      });

      it('updates filter with sourceMetricType', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const existingFilter = await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team._id,
          source: source._id,
        });

        const updatedFilterInput = {
          id: existingFilter._id.toString(),
          name: MOCK_PRESET_DASHBOARD_FILTER.name,
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: MOCK_PRESET_DASHBOARD_FILTER.expression,
          presetDashboard: MOCK_PRESET_DASHBOARD_FILTER.presetDashboard,
          source: source._id.toString(),
          sourceMetricType: MetricsDataType.Histogram,
        };

        const response = await agent
          .put(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: updatedFilterInput })
          .expect(200);

        expect(response.body.sourceMetricType).toBe(MetricsDataType.Histogram);
      });

      it('returns 400 when filter preset dashboard does not match params', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        const filterInput = {
          id: new Types.ObjectId().toString(),
          name: 'Test Filter',
          type: MOCK_PRESET_DASHBOARD_FILTER.type,
          expression: 'test',
          presetDashboard: PresetDashboard.Services,
          source: source._id.toString(),
        };

        // Try to update with mismatched preset dashboard in URL
        await agent
          .put('/dashboards/preset/invalid-dashboard/filter')
          .send({ filter: filterInput })
          .expect(400);
      });

      it('returns 400 when filter is missing required fields', async () => {
        const incompleteFilter = {
          id: new Types.ObjectId().toString(),
          name: 'Test Filter',
          // Missing type, expression, presetDashboard, source
        };

        await agent
          .put(`/dashboards/preset/${PresetDashboard.Services}/filter`)
          .send({ filter: incompleteFilter })
          .expect(400);
      });
    });

    describe('DELETE /preset/:presetDashboard/filter/:id', () => {
      it('deletes a preset dashboard filter', async () => {
        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team._id,
        });

        // Create a filter to delete
        const filter = await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team._id,
          source: source._id,
        });

        const response = await agent
          .delete(
            `/dashboards/preset/${PresetDashboard.Services}/filter/${filter._id}`,
          )
          .expect(200);

        expect(response.body).toMatchObject({
          id: filter._id.toString(),
        });

        // Verify filter was deleted from database
        const deletedFilter = await PresetDashboardFilter.findById(filter._id);
        expect(deletedFilter).toBeNull();
      });

      it('returns 404 when filter does not exist', async () => {
        const nonExistentId = new Types.ObjectId().toString();

        await agent
          .delete(
            `/dashboards/preset/${PresetDashboard.Services}/filter/${nonExistentId}`,
          )
          .expect(404);
      });

      it('returns 400 when id is invalid', async () => {
        await agent
          .delete('/dashboards/preset/services/filter/invalid-id')
          .expect(400);
      });

      it('returns 400 for invalid preset dashboard type', async () => {
        const filterId = new Types.ObjectId().toString();

        await agent
          .delete(`/dashboards/preset/invalid-dashboard/filter/${filterId}`)
          .expect(400);
      });

      it('does not delete filters from other teams', async () => {
        const team2Id = new mongoose.Types.ObjectId();

        const source = await Source.create({
          ...MOCK_SOURCE,
          team: team2Id,
        });

        const filter = await PresetDashboardFilter.create({
          ...MOCK_PRESET_DASHBOARD_FILTER,
          team: team2Id,
          source: source._id,
        });

        // Try to delete team2's filter as team1
        await agent
          .delete(
            `/dashboards/preset/${PresetDashboard.Services}/filter/${filter._id}`,
          )
          .expect(404);

        // Verify filter still exists for team2
        const stillExistingFilter = await PresetDashboardFilter.findById(
          filter._id,
        );
        expect(stillExistingFilter).toBeTruthy();
      });
    });
  });
});
