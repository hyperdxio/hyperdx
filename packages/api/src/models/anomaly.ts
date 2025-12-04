import mongoose, { Document, Schema } from 'mongoose';

export enum AnomalyStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
  IGNORED = 'ignored',
}

export interface IAnomaly extends Document {
  team: mongoose.Types.ObjectId;
  serviceName: string;
  metric: string; // e.g., 'p95_duration', 'error_rate'
  value: number;
  baseline: number;
  deviation: number; // percentage change
  startTime: Date;
  endTime: Date;
  status: AnomalyStatus;
  rcaAnalysis?: string;
  createdAt: Date;
}

const AnomalySchema = new Schema<IAnomaly>(
  {
    team: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      index: true,
    },
    serviceName: { type: String, required: true },
    metric: { type: String, required: true },
    value: { type: Number, required: true },
    baseline: { type: Number, required: true },
    deviation: { type: Number, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(AnomalyStatus),
      default: AnomalyStatus.OPEN,
    },
    rcaAnalysis: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  },
);

AnomalySchema.index({ team: 1, serviceName: 1, createdAt: -1 });

export const Anomaly = mongoose.model<IAnomaly>('Anomaly', AnomalySchema);

