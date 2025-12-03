import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';
import Team from './team';

export enum UptimeMonitorStatus {
  UP = 'UP',
  DOWN = 'DOWN',
  PAUSED = 'PAUSED',
  DEGRADED = 'DEGRADED',
}

export enum UptimeMonitorMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS',
}

export enum UptimeMonitorInterval {
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  TEN_MINUTES = '10m',
  FIFTEEN_MINUTES = '15m',
  THIRTY_MINUTES = '30m',
  ONE_HOUR = '1h',
}

export type UptimeMonitorNotificationChannel =
  | {
      type: 'webhook';
      webhookId: string;
    }
  | {
      type: null;
    };

export interface IUptimeMonitor {
  id: string;
  name: string;
  url: string;
  method: UptimeMonitorMethod;
  interval: UptimeMonitorInterval;
  timeout: number; // in milliseconds, default 10000 (10s)
  status: UptimeMonitorStatus;
  team: ObjectId;
  createdBy?: ObjectId;
  
  // Notification settings
  notificationChannel?: UptimeMonitorNotificationChannel;
  
  // Request settings
  headers?: Record<string, string>;
  body?: string;
  
  // Validation settings
  expectedStatusCodes?: number[]; // default [200]
  expectedResponseTime?: number; // in milliseconds, alert if response time exceeds this
  expectedBodyContains?: string; // check if response body contains this string
  
  // SSL/TLS settings
  verifySsl?: boolean; // default true
  
  // Metadata
  lastCheckedAt?: Date;
  lastStatus?: UptimeMonitorStatus;
  lastResponseTime?: number;
  lastError?: string;
  
  // Pause functionality
  paused?: boolean;
  pausedBy?: ObjectId;
  pausedAt?: Date;
  pausedUntil?: Date;
}

export type UptimeMonitorDocument = mongoose.HydratedDocument<IUptimeMonitor>;

const UptimeMonitorSchema = new Schema<IUptimeMonitor>(
  {
    name: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    method: {
      type: String,
      enum: Object.values(UptimeMonitorMethod),
      default: UptimeMonitorMethod.GET,
      required: true,
    },
    interval: {
      type: String,
      enum: Object.values(UptimeMonitorInterval),
      default: UptimeMonitorInterval.FIVE_MINUTES,
      required: true,
    },
    timeout: {
      type: Number,
      default: 10000,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(UptimeMonitorStatus),
      default: UptimeMonitorStatus.UP,
      required: true,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: Team.modelName,
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    notificationChannel: {
      type: Schema.Types.Mixed,
      required: false,
    },
    headers: {
      type: Map,
      of: String,
      required: false,
    },
    body: {
      type: String,
      required: false,
    },
    expectedStatusCodes: {
      type: [Number],
      default: [200],
      required: false,
    },
    expectedResponseTime: {
      type: Number,
      required: false,
    },
    expectedBodyContains: {
      type: String,
      required: false,
    },
    verifySsl: {
      type: Boolean,
      default: true,
      required: false,
    },
    lastCheckedAt: {
      type: Date,
      required: false,
    },
    lastStatus: {
      type: String,
      enum: Object.values(UptimeMonitorStatus),
      required: false,
    },
    lastResponseTime: {
      type: Number,
      required: false,
    },
    lastError: {
      type: String,
      required: false,
    },
    paused: {
      type: Boolean,
      default: false,
      required: false,
    },
    pausedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    pausedAt: {
      type: Date,
      required: false,
    },
    pausedUntil: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);

// Indexes for efficient queries
UptimeMonitorSchema.index({ team: 1 });
UptimeMonitorSchema.index({ team: 1, status: 1 });
UptimeMonitorSchema.index({ team: 1, lastCheckedAt: 1 });

export default mongoose.model<IUptimeMonitor>(
  'UptimeMonitor',
  UptimeMonitorSchema,
);

