import { DisplayType } from '@hyperdx/common-utils/dist/types';

import {
  getLoggedInAgent,
  getServer,
  makeAlertInput,
  makeRawSqlAlertTile,
  makeRawSqlNumberAlertTile,
  makeRawSqlTile,
  makeTile,
  randomMongoId,
  RAW_SQL_ALERT_TEMPLATE,
} from '@/fixtures';
import Alert, {
  AlertSource,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Webhook, { WebhookDocument, WebhookService } from '@/models/webhook';

const MOCK_TILES = [makeTile(), makeTile(), makeTile(), makeTile(), makeTile()];

const MOCK_DASHBOARD = {
  id: randomMongoId(),
  name: 'Test Dashboard',
  tiles: MOCK_TILES,
  tags: ['test'],
};

describe('alerts router', () => {
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

  it('can create an alert', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);
    expect(alert.body.data.dashboard).toBe(dashboard.body.id);
    expect(alert.body.data.tileId).toBe(dashboard.body.tiles[0].id);
  });

  it('can delete an alert', async () => {
    const resp = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: resp.body.id,
          tileId: MOCK_TILES[0].id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);
    await agent.delete(`/alerts/${alert.body.data._id}`).expect(200);
    const alerts = await agent.get('/alerts').expect(200);
    expect(alerts.body.data.length).toBe(0);
  });

  it('can update an alert', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: MOCK_TILES[0].id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);
    await agent
      .put(`/alerts/${alert.body.data._id}`)
      .send({
        ...alert.body.data,
        dashboardId: dashboard.body.id, // because alert.body.data stores 'dashboard' instead of 'dashboardId'
        threshold: 10,
      })
      .expect(200);
    const allAlerts = await agent.get(`/alerts`).expect(200);
    expect(allAlerts.body.data.length).toBe(1);
    expect(allAlerts.body.data[0].threshold).toBe(10);
  });

  it('preserves scheduleStartAt when omitted in updates and clears when null', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const scheduleStartAt = '2024-01-01T00:00:00.000Z';
    const createdAlert = await agent
      .post('/alerts')
      .send({
        ...makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          webhookId: webhook._id.toString(),
        }),
        scheduleStartAt,
      })
      .expect(200);

    const updatePayload = {
      channel: createdAlert.body.data.channel,
      interval: createdAlert.body.data.interval,
      threshold: 10,
      thresholdType: createdAlert.body.data.thresholdType,
      source: createdAlert.body.data.source,
      dashboardId: dashboard.body.id,
      tileId: dashboard.body.tiles[0].id,
    };

    await agent
      .put(`/alerts/${createdAlert.body.data._id}`)
      .send(updatePayload)
      .expect(200);

    const alertAfterOmittedScheduleStartAt = await Alert.findById(
      createdAlert.body.data._id,
    );
    expect(
      alertAfterOmittedScheduleStartAt?.scheduleStartAt?.toISOString(),
    ).toBe(scheduleStartAt);

    await agent
      .put(`/alerts/${createdAlert.body.data._id}`)
      .send({
        ...updatePayload,
        scheduleStartAt: null,
      })
      .expect(200);

    const alertAfterNullScheduleStartAt = await Alert.findById(
      createdAlert.body.data._id,
    );
    expect(alertAfterNullScheduleStartAt?.scheduleStartAt).toBeNull();
  });

  it('preserves scheduleOffsetMinutes when schedule fields are omitted in updates', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const createdAlert = await agent
      .post('/alerts')
      .send({
        ...makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          interval: '15m',
          webhookId: webhook._id.toString(),
        }),
        scheduleOffsetMinutes: 2,
      })
      .expect(200);

    await agent
      .put(`/alerts/${createdAlert.body.data._id}`)
      .send({
        channel: createdAlert.body.data.channel,
        interval: createdAlert.body.data.interval,
        threshold: 10,
        thresholdType: createdAlert.body.data.thresholdType,
        source: createdAlert.body.data.source,
        dashboardId: dashboard.body.id,
        tileId: dashboard.body.tiles[0].id,
      })
      .expect(200);

    const updatedAlert = await Alert.findById(createdAlert.body.data._id);
    expect(updatedAlert?.scheduleOffsetMinutes).toBe(2);
    expect(updatedAlert?.scheduleStartAt).toBeUndefined();
  });

  it('resets scheduleOffsetMinutes to 0 when scheduleStartAt is set without offset', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const createdAlert = await agent
      .post('/alerts')
      .send({
        ...makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          webhookId: webhook._id.toString(),
        }),
        scheduleOffsetMinutes: 2,
      })
      .expect(200);

    expect(createdAlert.body.data.scheduleOffsetMinutes).toBe(2);

    const scheduleStartAt = '2024-01-01T00:00:00.000Z';

    await agent
      .put(`/alerts/${createdAlert.body.data._id}`)
      .send({
        channel: createdAlert.body.data.channel,
        interval: createdAlert.body.data.interval,
        threshold: createdAlert.body.data.threshold,
        thresholdType: createdAlert.body.data.thresholdType,
        source: createdAlert.body.data.source,
        dashboardId: dashboard.body.id,
        tileId: dashboard.body.tiles[0].id,
        scheduleStartAt,
      })
      .expect(200);

    const updatedAlert = await Alert.findById(createdAlert.body.data._id);
    expect(updatedAlert?.scheduleOffsetMinutes).toBe(0);
    expect(updatedAlert?.scheduleStartAt?.toISOString()).toBe(scheduleStartAt);
  });

  it('resets stale scheduleOffsetMinutes when scheduleStartAt is cleared without offset', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const staleAlert = await Alert.create({
      team: team._id,
      channel: {
        type: 'webhook',
        webhookId: webhook._id.toString(),
      },
      interval: '15m',
      threshold: 8,
      thresholdType: AlertThresholdType.ABOVE,
      source: AlertSource.TILE,
      dashboard: dashboard.body.id,
      tileId: dashboard.body.tiles[0].id,
      scheduleOffsetMinutes: 2,
      scheduleStartAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    await agent
      .put(`/alerts/${staleAlert._id.toString()}`)
      .send({
        ...makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          interval: '15m',
          webhookId: webhook._id.toString(),
        }),
        scheduleStartAt: null,
      })
      .expect(200);

    const updatedAlert = await Alert.findById(staleAlert._id);
    expect(updatedAlert?.scheduleOffsetMinutes).toBe(0);
    expect(updatedAlert?.scheduleStartAt).toBeNull();
  });

  it('rejects scheduleStartAt values more than 1 year in the future', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const farFutureScheduleStartAt = new Date(
      Date.now() + 366 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await agent
      .post('/alerts')
      .send({
        ...makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          webhookId: webhook._id.toString(),
        }),
        scheduleStartAt: farFutureScheduleStartAt,
      })
      .expect(400);
  });

  it('rejects scheduleStartAt values older than 10 years in the past', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    const tooOldScheduleStartAt = new Date(
      Date.now() - 11 * 365 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await agent
      .post('/alerts')
      .send({
        ...makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          webhookId: webhook._id.toString(),
        }),
        scheduleStartAt: tooOldScheduleStartAt,
      })
      .expect(400);
  });

  it('rejects scheduleOffsetMinutes when scheduleStartAt is provided', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    await agent
      .post('/alerts')
      .send({
        ...makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          webhookId: webhook._id.toString(),
        }),
        scheduleOffsetMinutes: 2,
        scheduleStartAt: new Date().toISOString(),
      })
      .expect(400);
  });

  it('preserves createdBy field during updates', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);

    // Create an alert
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          threshold: 5,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);

    // Verify alert was created and contains the expected data
    expect(alert.body.data.threshold).toBe(5);

    // Get the alert directly from database to verify createdBy was set
    const alertFromDb = await Alert.findById(alert.body.data._id);
    expect(alertFromDb).toBeDefined();
    expect(alertFromDb!.createdBy).toEqual(user._id);
    expect(alertFromDb!.threshold).toBe(5);

    // Update the alert with a different threshold
    const updatedAlert = await agent
      .put(`/alerts/${alert.body.data._id}`)
      .send({
        ...alert.body.data,
        dashboardId: dashboard.body.id, // because alert.body.data stores 'dashboard' instead of 'dashboardId'
        threshold: 15, // Change threshold
      })
      .expect(200);

    expect(updatedAlert.body.data.threshold).toBe(15);

    // Get the alert from database again to verify createdBy is preserved
    const alertFromDbAfterUpdate = await Alert.findById(alert.body.data._id);
    expect(alertFromDbAfterUpdate).toBeDefined();
    expect(alertFromDbAfterUpdate!.createdBy).toEqual(user._id); // ✅ createdBy should still be the original user
    expect(alertFromDbAfterUpdate!.threshold).toBe(15); // ✅ threshold should be updated
  });

  it('has alerts attached to dashboards', async () => {
    await agent.post('/dashboards').send(MOCK_DASHBOARD).expect(200);
    const initialDashboards = await agent.get('/dashboards').expect(200);

    // Create alerts for all charts
    const dashboard = initialDashboards.body[0];
    await Promise.all(
      dashboard.tiles.map((tile: { id: string }) =>
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

    const alerts = await agent.get(`/alerts`).expect(200);
    expect(alerts.body.data.length).toBe(5);
    for (const alert of alerts.body.data) {
      expect(alert.tileId).toBeDefined();
      expect(alert.dashboard).toBeDefined();
    }
  });

  it('can silence an alert', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);

    const mutedUntil = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
    await agent
      .post(`/alerts/${alert.body.data._id}/silenced`)
      .send({ mutedUntil })
      .expect(200);

    // Verify the alert was silenced
    const alertFromDb = await Alert.findById(alert.body.data._id);
    expect(alertFromDb).toBeDefined();
    expect(alertFromDb!.silenced).toBeDefined();
    expect(alertFromDb!.silenced!.by).toEqual(user._id);
    expect(alertFromDb!.silenced!.at).toBeDefined();
    expect(new Date(alertFromDb!.silenced!.until).toISOString()).toBe(
      mutedUntil,
    );
  });

  it('can unsilence an alert', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);

    // First silence the alert
    const mutedUntil = new Date(Date.now() + 3600000).toISOString();
    await agent
      .post(`/alerts/${alert.body.data._id}/silenced`)
      .send({ mutedUntil })
      .expect(200);

    // Verify it was silenced
    let alertFromDb = await Alert.findById(alert.body.data._id);
    expect(alertFromDb!.silenced).toBeDefined();

    // Now unsilence it
    await agent.delete(`/alerts/${alert.body.data._id}/silenced`).expect(200);

    // Verify it was unsilenced
    alertFromDb = await Alert.findById(alert.body.data._id);
    expect(alertFromDb).toBeDefined();
    expect(alertFromDb!.silenced).toBeUndefined();
  });

  it('returns silenced info in GET /alerts', async () => {
    const dashboard = await agent
      .post('/dashboards')
      .send(MOCK_DASHBOARD)
      .expect(200);
    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: dashboard.body.tiles[0].id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);

    // Silence the alert
    const mutedUntil = new Date(Date.now() + 3600000).toISOString();
    await agent
      .post(`/alerts/${alert.body.data._id}/silenced`)
      .send({ mutedUntil })
      .expect(200);

    // Get alerts and verify silenced info is returned
    const alerts = await agent.get('/alerts').expect(200);
    expect(alerts.body.data.length).toBe(1);
    const silencedAlert = alerts.body.data[0];
    expect(silencedAlert.silenced).toBeDefined();
    expect(silencedAlert.silenced.by).toBeDefined(); // Should contain email
    expect(silencedAlert.silenced.at).toBeDefined();
    expect(silencedAlert.silenced.until).toBeDefined();
  });

  it('prevents silencing an alert that does not exist', async () => {
    const fakeId = randomMongoId();
    const mutedUntil = new Date(Date.now() + 3600000).toISOString();

    await agent
      .post(`/alerts/${fakeId}/silenced`)
      .send({ mutedUntil })
      .expect(404); // Should fail because alert doesn't exist
  });

  it('prevents unsilencing an alert that does not exist', async () => {
    const fakeId = randomMongoId();

    await agent.delete(`/alerts/${fakeId}/silenced`).expect(404); // Should fail
  });

  it('allows creating an alert on a raw SQL line tile', async () => {
    const rawSqlTile = makeRawSqlAlertTile();
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [rawSqlTile],
        tags: [],
      })
      .expect(200);

    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: rawSqlTile.id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);
    expect(alert.body.data.dashboard).toBe(dashboard.body.id);
    expect(alert.body.data.tileId).toBe(rawSqlTile.id);
  });

  it('allows creating an alert on a raw SQL number tile', async () => {
    const rawSqlTile = makeRawSqlNumberAlertTile();
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [rawSqlTile],
        tags: [],
      })
      .expect(200);

    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: rawSqlTile.id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);
    expect(alert.body.data.dashboard).toBe(dashboard.body.id);
    expect(alert.body.data.tileId).toBe(rawSqlTile.id);
  });

  it('rejects creating an alert on a raw SQL table tile', async () => {
    const rawSqlTile = makeRawSqlTile({
      displayType: DisplayType.Table,
      sqlTemplate: RAW_SQL_ALERT_TEMPLATE,
    });
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [rawSqlTile],
        tags: [],
      })
      .expect(200);

    await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: rawSqlTile.id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(400);
  });

  it('rejects creating an alert on a raw SQL tile without interval params', async () => {
    const rawSqlTile = makeRawSqlTile({
      sqlTemplate: 'SELECT count() FROM otel_logs',
    });
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [rawSqlTile],
        tags: [],
      })
      .expect(200);

    await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: rawSqlTile.id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(400);
  });

  it('allows updating an alert to reference a raw SQL number tile', async () => {
    const regularTile = makeTile();
    const rawSqlTile = makeRawSqlNumberAlertTile();
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [regularTile, rawSqlTile],
        tags: [],
      })
      .expect(200);

    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: regularTile.id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);

    await agent
      .put(`/alerts/${alert.body.data._id}`)
      .send({
        ...makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: rawSqlTile.id,
          webhookId: webhook._id.toString(),
        }),
      })
      .expect(200);
  });

  it('rejects updating an alert to reference a raw SQL table tile', async () => {
    const regularTile = makeTile();
    const rawSqlTile = makeRawSqlTile({
      displayType: DisplayType.Table,
      sqlTemplate: RAW_SQL_ALERT_TEMPLATE,
    });
    const dashboard = await agent
      .post('/dashboards')
      .send({
        name: 'Test Dashboard',
        tiles: [regularTile, rawSqlTile],
        tags: [],
      })
      .expect(200);

    const alert = await agent
      .post('/alerts')
      .send(
        makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: regularTile.id,
          webhookId: webhook._id.toString(),
        }),
      )
      .expect(200);

    await agent
      .put(`/alerts/${alert.body.data._id}`)
      .send({
        ...makeAlertInput({
          dashboardId: dashboard.body.id,
          tileId: rawSqlTile.id,
          webhookId: webhook._id.toString(),
        }),
      })
      .expect(400);
  });

  describe('GET /alerts/:id', () => {
    it('returns 404 for non-existent alert', async () => {
      const fakeId = randomMongoId();
      await agent.get(`/alerts/${fakeId}`).expect(404);
    });

    it('returns alert with empty history when no history exists', async () => {
      const dashboard = await agent
        .post('/dashboards')
        .send(MOCK_DASHBOARD)
        .expect(200);

      const alert = await agent
        .post('/alerts')
        .send(
          makeAlertInput({
            dashboardId: dashboard.body.id,
            tileId: dashboard.body.tiles[0].id,
            webhookId: webhook._id.toString(),
          }),
        )
        .expect(200);

      const res = await agent.get(`/alerts/${alert.body.data._id}`).expect(200);

      expect(res.body.data._id).toBe(alert.body.data._id);
      expect(res.body.data.history).toEqual([]);
      expect(res.body.data.threshold).toBe(alert.body.data.threshold);
      expect(res.body.data.interval).toBe(alert.body.data.interval);
      expect(res.body.data.dashboard).toBeDefined();
      expect(res.body.data.tileId).toBe(dashboard.body.tiles[0].id);
    });

    it('returns alert with history entries', async () => {
      const dashboard = await agent
        .post('/dashboards')
        .send(MOCK_DASHBOARD)
        .expect(200);

      const alert = await agent
        .post('/alerts')
        .send(
          makeAlertInput({
            dashboardId: dashboard.body.id,
            tileId: dashboard.body.tiles[0].id,
            webhookId: webhook._id.toString(),
          }),
        )
        .expect(200);

      const now = new Date(Date.now() - 60000);
      const earlier = new Date(Date.now() - 120000);

      await AlertHistory.create({
        alert: alert.body.data._id,
        createdAt: now,
        state: AlertState.ALERT,
        counts: 5,
        lastValues: [{ startTime: now, count: 5 }],
      });

      await AlertHistory.create({
        alert: alert.body.data._id,
        createdAt: earlier,
        state: AlertState.OK,
        counts: 0,
        lastValues: [{ startTime: earlier, count: 0 }],
      });

      const res = await agent.get(`/alerts/${alert.body.data._id}`).expect(200);

      expect(res.body.data._id).toBe(alert.body.data._id);
      expect(res.body.data.history).toHaveLength(2);
      expect(res.body.data.history[0].state).toBe('ALERT');
      expect(res.body.data.history[0].counts).toBe(5);
      expect(res.body.data.history[1].state).toBe('OK');
      expect(res.body.data.history[1].counts).toBe(0);
    });
  });
});
