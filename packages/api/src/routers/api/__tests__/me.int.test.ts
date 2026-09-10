import type { OnboardingTaskId } from '@hyperdx/common-utils/dist/types';
import { AlertThresholdType } from '@hyperdx/common-utils/dist/types';

import {
  getAgent,
  getLoggedInAgent,
  getServer,
  makeAlertInput,
  makeTile,
  randomMongoId,
} from '@/fixtures';
import type { ObjectId } from '@/models';
import User from '@/models/user';
import Webhook, { WebhookService } from '@/models/webhook';

describe('me router', () => {
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

  describe('GET /me', () => {
    it('returns the calling user', async () => {
      const { agent, team, user } = await getLoggedInAgent(server);

      const resp = await agent.get('/me').expect(200);

      expect(resp.body.id).toEqual(user._id.toString());
      expect(resp.body.email).toEqual('fake@deploysentinel.com');
      expect(resp.body.accessKey).toEqual(user.accessKey);
      expect(resp.body.team.id).toEqual(team._id.toString());
    });

    it('defaults onboardingData for users created before the field existed', async () => {
      const { agent, user } = await getLoggedInAgent(server);
      // Simulate a legacy document with no onboardingData subdocument.
      await User.updateOne(
        { _id: user._id },
        { $unset: { onboardingData: '' } },
      );

      const resp = await agent.get('/me').expect(200);

      expect(resp.body.onboardingData).toEqual({
        completedTasks: [],
        isDismissed: false,
      });
    });

    it('rejects an unauthenticated request', async () => {
      await getAgent(server).get('/me').expect(401);
    });
  });

  describe('POST /me/onboarding/task', () => {
    it('rejects an unauthenticated request', async () => {
      await getAgent(server)
        .post('/me/onboarding/task')
        .send({ taskId: 'mcp' })
        .expect(401);
    });

    it('rejects an unknown task id', async () => {
      const { agent } = await getLoggedInAgent(server);
      await agent
        .post('/me/onboarding/task')
        .send({ taskId: 'not-a-real-task' })
        .expect(400);
    });

    it('records a task and is idempotent', async () => {
      const { agent, user } = await getLoggedInAgent(server);

      const first = await agent
        .post('/me/onboarding/task')
        .send({ taskId: 'dashboard' })
        .expect(200);
      expect(first.body.onboardingData.completedTasks).toEqual(['dashboard']);

      // Completing the same task again does not duplicate it.
      const second = await agent
        .post('/me/onboarding/task')
        .send({ taskId: 'dashboard' })
        .expect(200);
      expect(second.body.onboardingData.completedTasks).toEqual(['dashboard']);

      expect(
        (await User.findById(user._id))?.onboardingData?.completedTasks,
      ).toEqual(['dashboard']);
    });
  });

  // The 'alert' and 'dashboard' tasks are recorded server-side in the
  // controllers so every write surface counts (UI, external API, MCP, and
  // dashboard-tile alerts, which never hit the /alerts router). These verify
  // the recording end-to-end through GET /me.
  describe('onboarding task recording via product actions', () => {
    // Recording is fire-and-forget (not awaited by the handler), so the write
    // can land after the response. Poll rather than reading GET /me once.
    const completedTasksFor = async (userId: ObjectId) =>
      (await User.findById(userId))?.onboardingData?.completedTasks ?? [];

    const waitForTask = async (userId: ObjectId, task: OnboardingTaskId) => {
      for (let i = 0; i < 20; i++) {
        if ((await completedTasksFor(userId)).includes(task)) return true;
        await new Promise(r => setTimeout(r, 25));
      }
      return false;
    };

    it('records the dashboard task when a dashboard with a tile is created', async () => {
      const { agent, user } = await getLoggedInAgent(server);

      await agent
        .post('/dashboards')
        .send({ name: 'Dash', tiles: [makeTile()], tags: [] })
        .expect(200);

      expect(await waitForTask(user._id, 'dashboard')).toBe(true);
      // Poll for 'dashboard' above guarantees the write cycle ran, so this
      // negative assertion can't pass merely because the write hadn't landed.
      expect(await completedTasksFor(user._id)).not.toContain('alert');
    });

    it('does NOT record the dashboard task for an empty (tileless) dashboard', async () => {
      const { agent, user } = await getLoggedInAgent(server);

      const created = await agent
        .post('/dashboards')
        .send({ name: 'Empty', tiles: [], tags: [] })
        .expect(200);

      expect(await completedTasksFor(user._id)).not.toContain('dashboard');

      // Adding a tile via update then completes it — the task means "built a
      // chart", not "created a shell". Waiting for it to appear also confirms
      // the create above didn't record it late (the negative isn't vacuous).
      await agent
        .patch(`/dashboards/${created.body.id}`)
        .send({ ...created.body, tiles: [makeTile()] })
        .expect(200);

      expect(await waitForTask(user._id, 'dashboard')).toBe(true);
    });

    it('records the alert task when a saved-search alert is created', async () => {
      const { agent, team, user } = await getLoggedInAgent(server);
      const webhook = await Webhook.create({
        name: 'Test Webhook',
        service: WebhookService.Slack,
        url: 'https://hooks.slack.com/test',
        team: team._id,
      });
      const dashboard = await agent
        .post('/dashboards')
        .send({ name: 'Dash', tiles: [makeTile()], tags: [] })
        .expect(200);

      await agent
        .post('/alerts')
        .send(
          makeAlertInput({
            dashboardId: dashboard.body.id,
            tileId: dashboard.body.tiles[0].id,
            webhookId: webhook._id.toString(),
          }),
        )
        .expect(200);

      expect(await waitForTask(user._id, 'alert')).toBe(true);
    });

    it('records the alert task when an existing alert is edited (PUT /alerts/:id)', async () => {
      const { agent, team, user } = await getLoggedInAgent(server);
      const webhook = await Webhook.create({
        name: 'Test Webhook',
        service: WebhookService.Slack,
        url: 'https://hooks.slack.com/test',
        team: team._id,
      });
      const dashboard = await agent
        .post('/dashboards')
        .send({ name: 'Dash', tiles: [makeTile()], tags: [] })
        .expect(200);

      const created = await agent
        .post('/alerts')
        .send(
          makeAlertInput({
            dashboardId: dashboard.body.id,
            tileId: dashboard.body.tiles[0].id,
            webhookId: webhook._id.toString(),
          }),
        )
        .expect(200);

      // Clear the task recorded by create so the update is the only thing that
      // could re-record it.
      await User.updateOne(
        { _id: user._id },
        { $set: { 'onboardingData.completedTasks': [] } },
      );

      await agent
        .put(`/alerts/${created.body.data._id}`)
        .send(
          makeAlertInput({
            dashboardId: dashboard.body.id,
            tileId: dashboard.body.tiles[0].id,
            webhookId: webhook._id.toString(),
            threshold: 42,
          }),
        )
        .expect(200);

      expect(await waitForTask(user._id, 'alert')).toBe(true);
    });

    it('records the alert task for a dashboard-tile alert (never hits /alerts)', async () => {
      const { agent, team, user } = await getLoggedInAgent(server);
      const webhook = await Webhook.create({
        name: 'Test Webhook',
        service: WebhookService.Slack,
        url: 'https://hooks.slack.com/test',
        team: team._id,
      });
      const tileId = randomMongoId();
      const tile = makeTile({
        id: tileId,
        alert: {
          interval: '15m',
          threshold: 8,
          thresholdType: AlertThresholdType.ABOVE,
          channel: { type: 'webhook', webhookId: webhook._id.toString() },
        },
      });

      await agent
        .post('/dashboards')
        .send({ name: 'Dash', tiles: [tile], tags: [] })
        .expect(200);

      // Saving the dashboard alone completes 'dashboard'; the inline tile alert
      // completes 'alert' via createOrUpdateDashboardAlerts.
      expect(await waitForTask(user._id, 'dashboard')).toBe(true);
      expect(await waitForTask(user._id, 'alert')).toBe(true);
    });
  });

  describe('PATCH /me/onboarding/dismiss', () => {
    it('rejects an unauthenticated request', async () => {
      await getAgent(server)
        .patch('/me/onboarding/dismiss')
        .send({ isDismissed: true })
        .expect(401);
    });

    it('persists the dismissed flag', async () => {
      const { agent, user } = await getLoggedInAgent(server);

      const resp = await agent
        .patch('/me/onboarding/dismiss')
        .send({ isDismissed: true })
        .expect(200);
      expect(resp.body.onboardingData.isDismissed).toBe(true);

      expect((await User.findById(user._id))?.onboardingData?.isDismissed).toBe(
        true,
      );

      // And it can be un-dismissed.
      await agent
        .patch('/me/onboarding/dismiss')
        .send({ isDismissed: false })
        .expect(200);
      expect((await User.findById(user._id))?.onboardingData?.isDismissed).toBe(
        false,
      );
    });
  });

  describe('PATCH /me/accessKey', () => {
    it('rejects an unauthenticated request', async () => {
      // The new verb is covered by the mount-time isUserAuthenticated in
      // api-app.ts, not by anything in the handler itself.
      await getAgent(server).patch('/me/accessKey').expect(401);
    });

    it('returns a new key and persists it', async () => {
      const { agent, user } = await getLoggedInAgent(server);

      const resp = await agent.patch('/me/accessKey').expect(200);

      expect(resp.body.newAccessKey).toEqual(expect.any(String));
      expect(resp.body.newAccessKey).not.toEqual(user.accessKey);
      expect((await User.findById(user._id))?.accessKey).toEqual(
        resp.body.newAccessKey,
      );
    });

    it('revokes the old key and accepts the new one', async () => {
      const { agent, user } = await getLoggedInAgent(server);
      const oldAccessKey = user.accessKey;

      // GET /api/v2 is the bearer-authed surface with no rate limiter attached,
      // so three sequential calls here are safe.
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${oldAccessKey}`)
        .expect(200);

      const { body } = await agent.patch('/me/accessKey').expect(200);

      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${oldAccessKey}`)
        .expect(401);
      await agent
        .get('/api/v2')
        .set('Authorization', `Bearer ${body.newAccessKey}`)
        .expect(200);
    });

    it('does not sign the user out of their browser session', async () => {
      // Session auth never reads accessKey (see isUserAuthenticated), so
      // rotating must leave the cookie session intact.
      const { agent } = await getLoggedInAgent(server);

      const { body } = await agent.patch('/me/accessKey').expect(200);

      const resp = await agent.get('/me').expect(200);
      expect(resp.body.accessKey).toEqual(body.newAccessKey);
    });

    it("does not touch another user's key", async () => {
      const { agent, user } = await getLoggedInAgent(server);
      // Created directly rather than via /register/password, which is gated to
      // the first user. We only read the schema-defaulted accessKey off it.
      const other = await User.create({
        email: 'other@deploysentinel.com',
        team: user.team,
      });

      await agent.patch('/me/accessKey').expect(200);

      expect((await User.findById(other._id))?.accessKey).toEqual(
        other.accessKey,
      );
    });
  });
});
