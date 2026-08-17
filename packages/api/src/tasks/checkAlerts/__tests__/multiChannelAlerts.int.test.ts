import { AlertErrorType } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import { createAlert } from '@/controllers/alerts';
import { createTeam } from '@/controllers/team';
import { getServer } from '@/fixtures';
import Alert, {
  AlertSource,
  AlertState,
  AlertThresholdType,
} from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
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
    // The healthy target's delivery is unaffected by the other's failure —
    // the failing target's own error is still recorded (both the inline
    // dispatcher's job and the pre-dispatch path get here through the same
    // per-target failure list, see renderAlertTemplate).
    expect(updated!.executionErrors).toHaveLength(1);
    // The error names the failing target, not the healthy one.
    expect(updated!.executionErrors![0].message).toContain('Hook Bad');
    expect(updated!.executionErrors![0].message).not.toContain('Hook OK');
    expect(updated!.executionErrors![0].type).toBe(
      AlertErrorType.WEBHOOK_ERROR,
    );

    const errorHistories = await AlertHistory.find({
      alert: alert.id,
      state: AlertState.ERROR,
    });
    expect(errorHistories).toHaveLength(1);
    expect(errorHistories[0].errors).toHaveLength(1);
    expect(errorHistories[0].errors![0].type).toBe(
      AlertErrorType.WEBHOOK_ERROR,
    );
  });

  it('records a WEBHOOK_ERROR and an ERROR history row when the only channel fails to deliver', async () => {
    const { team, connection, source, savedSearch } = await setup();
    const bad = await makeWebhook(team._id, 'Hook Bad', HOOK_BAD);

    const alert = await createAlert(
      team._id,
      {
        source: AlertSource.SAVED_SEARCH,
        channels: [{ type: 'webhook', webhookId: bad._id.toString() }],
        interval: '5m',
        thresholdType: AlertThresholdType.ABOVE,
        threshold: 1,
        savedSearchId: savedSearch.id,
        name: 'Single Failing Channel Alert',
      },
      new mongoose.Types.ObjectId(),
    );

    await seedTriggeringLogs();
    const updated = await runAlert({
      alertId: alert.id,
      connection,
      source,
      savedSearch,
      webhooks: [bad],
    });

    expect(requestedUrls).toEqual([HOOK_BAD]);
    // The query still fired the alert; the delivery failure is a separate
    // execution error, not a change to the threshold evaluation.
    expect(updated!.state).toBe('ALERT');
    expect(updated!.executionErrors).toHaveLength(1);
    expect(updated!.executionErrors![0].type).toBe(
      AlertErrorType.WEBHOOK_ERROR,
    );
    expect(updated!.executionErrors![0].message).toContain('Hook Bad');

    const errorHistories = await AlertHistory.find({
      alert: alert.id,
      state: AlertState.ERROR,
    });
    expect(errorHistories).toHaveLength(1);
    expect(errorHistories[0].errors).toHaveLength(1);
    expect(errorHistories[0].errors![0].type).toBe(
      AlertErrorType.WEBHOOK_ERROR,
    );
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
