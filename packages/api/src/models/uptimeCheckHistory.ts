import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';
import { UptimeMonitorStatus } from './uptimeMonitor';

export interface IUptimeCheckHistory {
  monitor: ObjectId;
  status: UptimeMonitorStatus;
  responseTime?: number; // in milliseconds
  statusCode?: number;
  error?: string;
  checkedAt: Date;
  metadata?: {
    sslValid?: boolean;
    sslExpiresAt?: Date;
    redirectCount?: number;
    resolvedIp?: string;
  };
}

export type UptimeCheckHistoryDocument =
  mongoose.HydratedDocument<IUptimeCheckHistory>;

const UptimeCheckHistorySchema = new Schema<IUptimeCheckHistory>(
  {
    monitor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UptimeMonitor',
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(UptimeMonitorStatus),
      required: true,
    },
    responseTime: {
      type: Number,
      required: false,
    },
    statusCode: {
      type: Number,
      required: false,
    },
    error: {
      type: String,
      required: false,
    },
    checkedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    metadata: {
      type: {
        sslValid: Boolean,
        sslExpiresAt: Date,
        redirectCount: Number,
        resolvedIp: String,
      },
      required: false,
    },
  },
  {
    timestamps: false,
  },
);

// Indexes for efficient queries
UptimeCheckHistorySchema.index({ monitor: 1, checkedAt: -1 });
UptimeCheckHistorySchema.index({ checkedAt: -1 });

// TTL index to automatically delete old records after 30 days
UptimeCheckHistorySchema.index({ checkedAt: 1 }, { expireAfterSeconds: 2592000 });

export default mongoose.model<IUptimeCheckHistory>(
  'UptimeCheckHistory',
  UptimeCheckHistorySchema,
);

