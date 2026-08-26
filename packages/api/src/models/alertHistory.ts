import {
  AlertErrorType,
  AlertNotificationTargetTiming,
} from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import ms from 'ms';

import { AlertState, IAlertError } from '@/models/alert';

import type { ObjectId } from '.';

/**
 * Diagnostics for the evaluation that wrote a history record.
 * Evaluation-level: identical on every row one evaluation writes (including
 * per-group rows).
 */
export interface IAlertHistoryAnalytics {
  /**
   * ClickHouse query duration for the evaluation (ms). On query-failure
   * ERROR records, the time until the query failed — for QUERY_TIMEOUT this
   * is approximately the configured evaluation timeout.
   */
  queryDurationMs?: number;
  /**
   * Total wall time delivering webhook notifications in the evaluation,
   * including retries (ms).
   */
  webhookDurationMs?: number;
  /**
   * Earlier buckets backfilled in this run after missed ticks
   * (expected buckets − 1). 0 in steady state.
   */
  backfilledBuckets?: number;
  /**
   * Per-target breakdown of `webhookDurationMs`, one entry per distinct
   * target, slowest first. Targets dispatch concurrently, so these do not sum
   * to `webhookDurationMs`. Absent when the evaluation sent nothing.
   */
  notificationTargets?: AlertNotificationTargetTiming[];
}

export interface IAlertHistory {
  alert: ObjectId;
  counts: number;
  createdAt: Date;
  state: AlertState;
  lastValues: { startTime: Date; count: number }[];
  group?: string; // For group-by alerts, stores the group identifier
  fired?: boolean;
  /**
   * Errors recorded for this evaluation window. Present on ERROR-state rows
   * (query/processing failures where no normal history is written) and on
   * the ERROR row created alongside normal rows when notifications fail.
   */
  errors?: IAlertError[];
  /** Diagnostics for the evaluation that wrote this record. */
  analytics?: IAlertHistoryAnalytics;
}

const AlertHistorySchema = new Schema<IAlertHistory>({
  counts: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    required: true,
  },
  alert: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert' },
  state: {
    type: String,
    enum: Object.values(AlertState),
    required: true,
  },
  lastValues: [
    {
      startTime: {
        type: Date,
        required: true,
      },
      count: {
        type: Number,
        required: true,
      },
    },
  ],
  group: {
    type: String,
    required: false,
  },
  fired: {
    type: Boolean,
    required: false,
  },
  errors: {
    type: [
      {
        _id: false,
        timestamp: { type: Date, required: true },
        type: {
          type: String,
          enum: AlertErrorType,
          required: true,
        },
        message: { type: String, required: true },
      },
    ],
    required: false,
    default: undefined,
  },
  analytics: {
    type: {
      _id: false,
      queryDurationMs: { type: Number, required: false },
      webhookDurationMs: { type: Number, required: false },
      backfilledBuckets: { type: Number, required: false },
      notificationTargets: {
        type: [
          {
            _id: false,
            target: { type: String, required: true },
            durationMs: { type: Number, required: true },
            dispatches: { type: Number, required: true },
            failures: { type: Number, required: true },
          },
        ],
        required: false,
        default: undefined,
      },
    },
    required: false,
    default: undefined,
  },
});

AlertHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: ms('30d') / 1000 },
);

// Used by getRecentAlertHistories (matches on alert, sorts by createdAt)
AlertHistorySchema.index({ alert: 1, createdAt: -1 });

// Used by getPreviousAlertHistories (groups by {alert, group}, sorts by createdAt)
AlertHistorySchema.index({ alert: 1, group: 1, createdAt: -1 });

export default mongoose.model<IAlertHistory>(
  'AlertHistory',
  AlertHistorySchema,
);
