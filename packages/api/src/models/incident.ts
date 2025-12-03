import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';
import Team from './team';
import User from './user';
import Alert from './alert';

export enum IncidentStatus {
  OPEN = 'open',
  INVESTIGATING = 'investigating',
  FIXED = 'fixed',
  RESOLVED = 'resolved',
  CANCELLED = 'cancelled',
}

export enum IncidentSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum IncidentSource {
  MANUAL = 'manual',
  ALERT = 'alert',
}

export interface IncidentEvent {
  type: 'status_change' | 'comment' | 'assignment';
  author: ObjectId;
  message: string;
  createdAt: Date;
}

export interface IIncident {
  id: string;
  title: string;
  description?: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  source: IncidentSource;
  alert?: ObjectId;
  owner?: ObjectId;
  team: ObjectId;
  events: IncidentEvent[];
  resolutionNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type IncidentDocument = mongoose.HydratedDocument<IIncident>;

const IncidentSchema = new Schema<IIncident>(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      enum: IncidentStatus,
      default: IncidentStatus.OPEN,
      required: true,
    },
    severity: {
      type: String,
      enum: IncidentSeverity,
      default: IncidentSeverity.LOW,
      required: true,
    },
    source: {
      type: String,
      enum: IncidentSource,
      default: IncidentSource.MANUAL,
      required: true,
    },
    alert: {
      type: mongoose.Schema.Types.ObjectId,
      ref: Alert.modelName,
      required: false,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: User.modelName,
      required: false,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: Team.modelName,
      required: true,
    },
    resolutionNotes: {
        type: String,
        required: false,
    },
    events: [
      {
        type: {
          type: String,
          enum: ['status_change', 'comment', 'assignment'],
          required: true,
        },
        author: {
          type: mongoose.Schema.Types.ObjectId,
          ref: User.modelName,
          required: true,
        },
        message: {
          type: String,
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export default mongoose.model<IIncident>('Incident', IncidentSchema);
