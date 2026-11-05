import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Types } from 'mongoose';

import { AlertState } from '@/models/alert';
import { processAlert } from '@/tasks/checkAlerts';
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
});
