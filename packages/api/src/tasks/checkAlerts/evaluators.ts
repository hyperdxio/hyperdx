import type { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import type { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';

import { registerExtensions } from '@/extensions';
import type { AlertState, IAlert, IAlertError } from '@/models/alert';
import type {
  IAlertHistory,
  IAlertHistoryAnalytics,
} from '@/models/alertHistory';
import type { ISource } from '@/models/source';
import type { AggregatedAlertHistory } from '@/tasks/checkAlerts';
import type {
  AlertDetails,
  AlertProvider,
} from '@/tasks/checkAlerts/providers';

/**
 * What processAlert has resolved by the time it evaluates an alert: the
 * scheduled window, the chart config to query, and the helpers that record
 * state and send notifications. The threshold path in processAlert uses the
 * same helpers, so an evaluator gets identical silencing, resolve, and
 * persistence behavior.
 */
export interface AlertEvaluationContext {
  alert: IAlert;
  details: AlertDetails;
  source: ISource | undefined;
  /** Unoptimized config: evaluators that change the date range or
   * granularity must re-run materialized-view selection themselves. */
  chartConfig: ChartConfigWithOptDateRange;
  clickhouseClient: ClickhouseClient;
  metadata: Metadata;
  dateRange: [Date, Date];
  windowSizeInMins: number;
  /** Scheduled start of the window being evaluated. */
  nowInMinsRoundDown: Date;
  hasGroupBy: boolean;
  previousMap: Map<string, AggregatedAlertHistory>;
  alertProvider: AlertProvider;
  /** Persisted on every history record this evaluation writes. */
  evaluationAnalytics: IAlertHistoryAnalytics;
  /** Errors collected so far (e.g. failed notification targets). */
  executionErrors: IAlertError[];
  getOrCreateHistory: (groupKey: string) => IAlertHistory;
  /** Resolves false when the send was suppressed (the alert is silenced). */
  trySendNotification: (args: {
    state: AlertState;
    totalCount: number;
    group: string;
    startTime?: Date;
    attributes?: Record<string, string>;
  }) => Promise<boolean>;
  sendNotificationIfResolved: (
    previousHistory: AggregatedAlertHistory | undefined,
    currentHistory: IAlertHistory,
    groupKey: string,
  ) => Promise<void>;
  /** Writes the records and alert state the way the threshold path does,
   * with `extraErrors` added to the collected execution errors. Attaches
   * `evaluationAnalytics` to each record when anything was measured. */
  persistHistories: (
    records: IAlertHistory[],
    extraErrors?: IAlertError[],
  ) => Promise<void>;
}

/**
 * A detection strategy for alerts. processAlert evaluates an alert with the
 * first registered evaluator whose `appliesTo` returns true, and falls back to
 * the built-in threshold evaluation when none does.
 */
export interface AlertEvaluator {
  /** Low-cardinality name, recorded on the alerts.evaluate metric. */
  name: string;
  appliesTo: (alert: IAlert) => boolean;
  /**
   * The clock to evaluate against. Defaults to the wall clock. Applied both
   * in processAlert and when fetching history up front, so the scheduled
   * window and the history it is compared to stay aligned.
   */
  evaluationNow?: (alert: IAlert, wallClockNow: Date) => Date;
  /** Evaluates the window and persists state through `ctx`. Throwing records
   * the error on the alert, as for the threshold path. */
  evaluate: (ctx: AlertEvaluationContext) => Promise<void>;
}

export const THRESHOLD_EVALUATOR_NAME = 'threshold';

const evaluators: AlertEvaluator[] = [];
let extensionsRegistered = false;

export const registerAlertEvaluator = (evaluator: AlertEvaluator) => {
  if (evaluators.some(e => e.name === evaluator.name)) {
    throw new Error(
      `Alert evaluator "${evaluator.name}" is already registered`,
    );
  }
  evaluators.push(evaluator);
};

/** The registered evaluator for this alert, or undefined for the threshold
 * path. */
export const findAlertEvaluator = (
  alert: IAlert,
): AlertEvaluator | undefined => {
  if (!extensionsRegistered) {
    extensionsRegistered = true;
    registerExtensions();
  }
  return evaluators.find(e => e.appliesTo(alert));
};

/** @internal Test helper. Extensions are not registered again afterwards. */
export const clearAlertEvaluators = () => {
  extensionsRegistered = true;
  evaluators.length = 0;
};
