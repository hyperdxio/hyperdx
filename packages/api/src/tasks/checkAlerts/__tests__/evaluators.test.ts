import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';

import { AlertState } from '@/models/alert';
import { getAlertWindowStart, processAlert } from '@/tasks/checkAlerts';
import {
  AlertEvaluationContext,
  AlertEvaluator,
  clearAlertEvaluators,
  findAlertEvaluator,
  registerAlertEvaluator,
} from '@/tasks/checkAlerts/evaluators';
import { AlertTaskType } from '@/tasks/checkAlerts/providers';

const makeAlert = (overrides: Record<string, unknown> = {}): any => ({
  id: new Types.ObjectId().toString(),
  interval: '5m',
  threshold: 1,
  thresholdType: 'above',
  channel: { type: 'webhook' },
  source: 'tile',
  ...overrides,
});

// A raw SQL inline alert needs no source and skips materialized-view
// optimization, so processAlert reaches evaluation without ClickHouse.
const makeDetails = (alert: any): any => ({
  alert,
  previousMap: new Map(),
  taskType: AlertTaskType.INLINE,
  chartConfig: {
    configType: 'sql',
    sqlTemplate: 'SELECT 1',
    displayType: DisplayType.Line,
  },
});

const makeProvider = (): any => ({
  updateAlertState: jest.fn().mockResolvedValue(undefined),
  recordAlertErrors: jest.fn().mockResolvedValue(undefined),
});

const makeClient = (): any => ({
  queryChartConfig: jest.fn().mockRejectedValue(new Error('not expected')),
  requestTimeoutMs: 1000,
});

const run = (alert: any, now: Date, provider = makeProvider()) => {
  const client = makeClient();
  return processAlert(
    now,
    makeDetails(alert),
    client,
    'connection-1',
    provider,
    new Map(),
  ).then(() => ({ client, provider }));
};

/** Registers an evaluator that runs `body` and returns its context. */
const evaluateWith = async (
  body: (ctx: AlertEvaluationContext) => Promise<void>,
  alert = makeAlert(),
) => {
  let ctx: AlertEvaluationContext | undefined;
  registerAlertEvaluator({
    name: 'custom',
    appliesTo: () => true,
    evaluate: async c => {
      ctx = c;
      await body(c);
    },
  });
  const result = await run(alert, new Date('2025-01-01T00:07:00Z'));
  return { ...result, ctx: ctx! };
};

describe('alert evaluators', () => {
  afterEach(() => {
    clearAlertEvaluators();
  });

  it('finds the first evaluator that applies to the alert', () => {
    const custom: AlertEvaluator = {
      name: 'custom',
      appliesTo: alert => alert.threshold === 42,
      evaluate: jest.fn(),
    };
    registerAlertEvaluator(custom);

    expect(findAlertEvaluator(makeAlert({ threshold: 42 }))).toBe(custom);
    expect(findAlertEvaluator(makeAlert())).toBeUndefined();
  });

  it('rejects a second evaluator with the same name', () => {
    const evaluator: AlertEvaluator = {
      name: 'custom',
      appliesTo: () => true,
      evaluate: jest.fn(),
    };
    registerAlertEvaluator(evaluator);
    expect(() => registerAlertEvaluator(evaluator)).toThrow(
      'already registered',
    );
  });

  it('evaluates with the registered evaluator instead of the threshold query', async () => {
    let ctx: AlertEvaluationContext | undefined;
    registerAlertEvaluator({
      name: 'custom',
      appliesTo: () => true,
      evaluate: async c => {
        ctx = c;
        const history = c.getOrCreateHistory('');
        history.state = AlertState.OK;
        await c.persistHistories([history]);
      },
    });

    const alert = makeAlert();
    const { client, provider } = await run(
      alert,
      new Date('2025-01-01T00:07:00Z'),
    );

    expect(client.queryChartConfig).not.toHaveBeenCalled();
    expect(ctx?.alert).toBe(alert);
    expect(ctx?.nowInMinsRoundDown).toEqual(new Date('2025-01-01T00:05:00Z'));
    expect(provider.updateAlertState).toHaveBeenCalledTimes(1);
    const [alertId, records, errors] = provider.updateAlertState.mock.calls[0];
    expect(alertId).toBe(alert.id);
    expect(records).toEqual([
      expect.objectContaining({ state: AlertState.OK }),
    ]);
    expect(errors).toEqual([]);
  });

  it('schedules the window from the evaluator clock', async () => {
    let ctx: AlertEvaluationContext | undefined;
    registerAlertEvaluator({
      name: 'delayed',
      appliesTo: () => true,
      // Two minutes behind: 00:06 on the wall clock evaluates as 00:04.
      evaluationNow: (_alert, now) => new Date(now.getTime() - 2 * 60_000),
      evaluate: async c => {
        ctx = c;
      },
    });

    await run(makeAlert(), new Date('2025-01-01T00:06:00Z'));

    expect(ctx?.nowInMinsRoundDown).toEqual(new Date('2025-01-01T00:00:00Z'));
  });

  it('records an error thrown by the evaluator on the alert', async () => {
    registerAlertEvaluator({
      name: 'failing',
      appliesTo: () => true,
      evaluate: async () => {
        throw new Error('boom');
      },
    });

    const { provider } = await run(
      makeAlert(),
      new Date('2025-01-01T00:07:00Z'),
    );

    expect(provider.updateAlertState).not.toHaveBeenCalled();
    expect(provider.recordAlertErrors).toHaveBeenCalledTimes(1);
    const [, errors, windowStart] = provider.recordAlertErrors.mock.calls[0];
    expect(errors).toEqual([expect.objectContaining({ type: 'UNKNOWN' })]);
    expect(windowStart).toEqual(new Date('2025-01-01T00:05:00Z'));
  });

  it('uses the threshold query when no evaluator applies', async () => {
    registerAlertEvaluator({
      name: 'other',
      appliesTo: () => false,
      evaluate: jest.fn(),
    });

    const { client } = await run(makeAlert(), new Date('2025-01-01T00:07:00Z'));

    expect(client.queryChartConfig).toHaveBeenCalledTimes(1);
  });

  it('reports a silenced send as suppressed', async () => {
    let sent: boolean | undefined;
    const { ctx } = await evaluateWith(
      async c => {
        sent = await c.trySendNotification({
          state: AlertState.ALERT,
          group: '',
          totalCount: 5,
        });
      },
      makeAlert({ silenced: { until: new Date(Date.now() + 60_000) } }),
    );

    expect(sent).toBe(false);
    expect(ctx.executionErrors).toEqual([]);
  });

  it('reports an attempted send even when delivery fails', async () => {
    let sent: boolean | undefined;
    // The test alert has no team, so the attempt records a webhook error.
    const { ctx } = await evaluateWith(async c => {
      sent = await c.trySendNotification({
        state: AlertState.ALERT,
        group: '',
        totalCount: 5,
      });
    });

    expect(sent).toBe(true);
    expect(ctx.executionErrors).toHaveLength(1);
  });

  it('sends a resolve notification through the context', async () => {
    const { ctx } = await evaluateWith(async c => {
      const history = c.getOrCreateHistory('');
      history.state = AlertState.OK;
      await c.sendNotificationIfResolved(
        { state: AlertState.ALERT, fired: true } as any,
        history,
        '',
      );
    });

    // One dispatch attempt, failing on the missing team.
    expect(ctx.executionErrors).toHaveLength(1);
  });

  it('persists extra errors with the collected ones', async () => {
    const extra = { type: 'INVALID_ALERT', message: 'extra' } as any;
    const { provider } = await evaluateWith(async c => {
      c.executionErrors.push({ type: 'WEBHOOK_ERROR', message: 'a' } as any);
      await c.persistHistories([c.getOrCreateHistory('')], [extra]);
    });

    const [, , errors] = provider.updateAlertState.mock.calls[0];
    expect(errors).toEqual([expect.objectContaining({ message: 'a' }), extra]);
  });

  it('attaches analytics only when something was measured', async () => {
    const measured = await evaluateWith(async c => {
      c.evaluationAnalytics.queryDurationMs = 12;
      await c.persistHistories([c.getOrCreateHistory('')]);
    });
    clearAlertEvaluators();
    const unmeasured = await evaluateWith(async c => {
      await c.persistHistories([c.getOrCreateHistory('')]);
    });

    const [[, [measuredRecord]]] =
      measured.provider.updateAlertState.mock.calls;
    const [[, [unmeasuredRecord]]] =
      unmeasured.provider.updateAlertState.mock.calls;
    expect(measuredRecord.analytics).toEqual({ queryDurationMs: 12 });
    expect(unmeasuredRecord.analytics).toBeUndefined();
  });

  it('aligns the up-front history window with the evaluator clock', () => {
    registerAlertEvaluator({
      name: 'delayed',
      appliesTo: () => true,
      evaluationNow: (_alert, now) => new Date(now.getTime() - 2 * 60_000),
      evaluate: jest.fn(),
    });

    expect(
      getAlertWindowStart(makeAlert(), new Date('2025-01-01T00:06:00Z')),
    ).toEqual(new Date('2025-01-01T00:00:00Z'));
  });

  it('ignores an evaluator clock that is ahead of the wall clock', () => {
    registerAlertEvaluator({
      name: 'ahead',
      appliesTo: () => true,
      evaluationNow: (_alert, now) => new Date(now.getTime() + 10 * 60_000),
      evaluate: jest.fn(),
    });

    expect(
      getAlertWindowStart(makeAlert(), new Date('2025-01-01T00:06:00Z')),
    ).toEqual(new Date('2025-01-01T00:05:00Z'));
  });

  it('records a failing evaluator lookup on the alert', async () => {
    registerAlertEvaluator({
      name: 'broken',
      appliesTo: () => {
        throw new Error('lookup failed');
      },
      evaluate: jest.fn(),
    });

    const { provider } = await run(
      makeAlert(),
      new Date('2025-01-01T00:07:00Z'),
    );

    expect(provider.recordAlertErrors).toHaveBeenCalledTimes(1);
    const [, errors] = provider.recordAlertErrors.mock.calls[0];
    expect(errors).toEqual([expect.objectContaining({ type: 'UNKNOWN' })]);
  });
});

describe('extension registration', () => {
  it('rolls back and retries a failed registration', () => {
    jest.isolateModules(() => {
      const registerExtensions = jest
        .fn()
        .mockImplementationOnce(() => {
          evaluatorsModule.registerAlertEvaluator({
            name: 'partial',
            appliesTo: () => true,
            evaluate: jest.fn(),
          });
          throw new Error('registration failed');
        })
        .mockImplementationOnce(() => {
          evaluatorsModule.registerAlertEvaluator({
            name: 'partial',
            appliesTo: () => true,
            evaluate: jest.fn(),
          });
        });
      jest.doMock('@/extensions', () => ({ registerExtensions }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
      const evaluatorsModule = require('@/tasks/checkAlerts/evaluators');

      expect(() => evaluatorsModule.findAlertEvaluator(makeAlert())).toThrow(
        'registration failed',
      );
      // The partial registration was rolled back, so the retry can register
      // the same name again.
      expect(evaluatorsModule.findAlertEvaluator(makeAlert())?.name).toBe(
        'partial',
      );
      expect(registerExtensions).toHaveBeenCalledTimes(2);
    });
  });
});
