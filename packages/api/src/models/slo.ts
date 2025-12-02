import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';
import Team from './team';

export enum SLOMetricType {
  AVAILABILITY = 'availability',
  LATENCY = 'latency',
  ERROR_RATE = 'error_rate',
}

export enum SLOStatus {
  HEALTHY = 'healthy',
  AT_RISK = 'at_risk',
  BREACHED = 'breached',
}

export enum SLOSourceTable {
  LOGS = 'otel_logs',
  TRACES = 'otel_traces',
}

export interface ISLO {
  id: string;
  serviceName: string;
  sloName: string;
  metricType: SLOMetricType;
  targetValue: number; // 95.0 for 95%
  timeWindow: string; // '30d', '90d', etc
  sourceTable: SLOSourceTable; // Data source: otel_logs or otel_traces
  numeratorQuery?: string; // ClickHouse query for success count
  denominatorQuery?: string; // ClickHouse query for total count
  // Structured SLI definition for BubbleUp support
  filter?: string; // Base filter for the dataset (denominator) e.g. "ServiceName = 'api'"
  goodCondition?: string; // Condition for success (numerator = filter AND goodCondition) e.g. "SeverityNumber < 17"
  alertThreshold?: number; // 80 = alert at 80% of error budget
  team: ObjectId;
  createdBy?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
  lastAggregatedAt?: Date; // Track the last time this SLO was aggregated
}

export type SLODocument = mongoose.HydratedDocument<ISLO>;

const SLOSchema = new Schema<ISLO>(
  {
    serviceName: {
      type: String,
      required: true,
    },
    sloName: {
      type: String,
      required: true,
    },
    metricType: {
      type: String,
      enum: Object.values(SLOMetricType),
      required: true,
    },
    targetValue: {
      type: Number,
      required: true,
    },
    timeWindow: {
      type: String,
      required: true,
    },
    sourceTable: {
      type: String,
      enum: Object.values(SLOSourceTable),
      required: true,
      default: SLOSourceTable.LOGS, // Default to logs for backward compatibility
    },
    numeratorQuery: {
      type: String,
      required: false,
    },
    denominatorQuery: {
      type: String,
      required: false,
    },
    filter: {
      type: String,
      required: false,
    },
    goodCondition: {
      type: String,
      required: false,
    },
    alertThreshold: {
      type: Number,
      required: false,
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
    lastAggregatedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);


// Compound index for efficient lookups
SLOSchema.index({ team: 1, serviceName: 1, sloName: 1 }, { unique: true });

export default mongoose.model<ISLO>('SLO', SLOSchema);

