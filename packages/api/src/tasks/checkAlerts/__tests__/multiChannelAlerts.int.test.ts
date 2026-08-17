import mongoose from 'mongoose';

import { createAlert } from '@/controllers/alerts';
import { createTeam } from '@/controllers/team';
import { getServer } from '@/fixtures';
import Alert, { AlertSource, AlertThresholdType } from '@/models/alert';
import { loadProvider } from '@/tasks/checkAlerts/providers';

import {
  HOOK_A,
  HOOK_B,
  HOOK_BAD,
  HOOK_OK,
  installFetchRouter,
  makeGenericWebhook,
  runAlert as runAlertWith,
  seedTriggeringLogs,
  setupAlertFixtures,
} from './multiChannelAlerts.harness';

// End-to-end coverage for dispatching one alert event to several webhooks.
// Shared setup lives in ./multiChannelAlerts.harness.
describe('Multi-channel alert dispatch', () => {
  let alertProvider: any;
  let server: any;
  let requestedUrls: string[] = [];

  beforeAll(async () => {
    alertProvider = await loadProvider();
    server = getServer();
    await server.start();
  });

  beforeEach(() => {
    requestedUrls = installFetchRouter();
  });

  afterEach(async () => {
    await server.clearDBs();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await server.stop();
  });

  const setup = () => setupAlertFixtures(createTeam);
  const makeWebhook = makeGenericWebhook;
  const runAlert = (
    args: Omit<Parameters<typeof runAlertWith>[0], 'alertProvider'>,
  ) => runAlertWith({ ...args, alertProvider });

  it('notifies every configured channel exactly once', async () => {
    const { team, connection, source, savedSearch } = await setup();
    const [w1, w2] = await Promise.all([
      makeWebhook(team._id, 'Hook A', HOOK_A),
      makeWebhook(team._id, 'Hook B', HOOK_B),
    ]);

    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channels: [
          { type: 'webhook', webhookId: w1._id.toString() },
          { type: 'webhook', webhookId: w2._id.toString() },
        ],
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 1,
        savedSearchId: savedSearch.id,
        name: 'Multi Channel Alert',
      },
      new mongoose.Types.ObjectId(),
    );

    await seedTriggeringLogs();
    const updated = await runAlert({
      alertId: alert.id,
      connection,
      source,
      savedSearch,
      webhooks: [w1, w2],
    });

    expect([...requestedUrls].sort()).toEqual([HOOK_A, HOOK_B]);
    expect(updated!.state).toBe('ALERT');
    expect(updated!.executionErrors ?? []).toHaveLength(0);
  });

  it('keeps delivering to healthy targets when one fails', async () => {
    const { team, connection, source, savedSearch } = await setup();
    const [ok, bad] = await Promise.all([
      makeWebhook(team._id, 'Hook OK', HOOK_OK),
      makeWebhook(team._id, 'Hook Bad', HOOK_BAD),
    ]);

    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channels: [
          { type: 'webhook', webhookId: ok._id.toString() },
          { type: 'webhook', webhookId: bad._id.toString() },
        ],
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 1,
        savedSearchId: savedSearch.id,
        name: 'Partial Failure Alert',
      },
      new mongoose.Types.ObjectId(),
    );

    await seedTriggeringLogs();
    const updated = await runAlert({
      alertId: alert.id,
      connection,
      source,
      savedSearch,
      webhooks: [ok, bad],
    });

    expect(requestedUrls.slice().sort()).toEqual([HOOK_BAD, HOOK_OK].sort());
    expect(updated!.state).toBe('ALERT');
    // Delivery failures are metrics/logs only, not execution errors: the
    // dispatcher contract can't guarantee synchronous delivery reporting (a
    // queued implementation wouldn't have an outcome yet), so this stays
    // dispatcher-agnostic rather than special-casing the inline case.
    expect(updated!.executionErrors ?? []).toHaveLength(0);
  });

  it('still notifies a pre-multi-channel document that only has `channel`', async () => {
    const { team, connection, source, savedSearch } = await setup();
    const webhook = await makeWebhook(team._id, 'Legacy Hook', HOOK_A);

    // Written directly, bypassing makeAlert, to simulate a document stored
    // before `channels` existed.
    const alert = await new Alert({
      team: team._id,
      source: AlertSource.SAVED_SEARCH,
      channel: { type: 'webhook', webhookId: webhook._id.toString() },
      interval: '5m',
      thresholdType: AlertThresholdType.ABOVE,
      threshold: 1,
      savedSearch: savedSearch._id,
      name: 'Legacy Alert',
      state: 'OK',
    }).save();

    expect(alert.channels).toBeUndefined();

    await seedTriggeringLogs();
    const updated = await runAlert({
      alertId: alert.id,
      connection,
      source,
      savedSearch,
      webhooks: [webhook],
    });

    expect(requestedUrls).toEqual([HOOK_A]);
    expect(updated!.executionErrors ?? []).toHaveLength(0);
  });
});
