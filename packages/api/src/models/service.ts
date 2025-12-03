import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';
import Team from './team';
import User from './user';

export enum ServiceTier {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum ServiceReadiness {
  GOLD = 'gold',
  SILVER = 'silver',
  BRONZE = 'bronze',
  FAIL = 'fail',
}

export interface IService {
  _id: ObjectId;
  name: string;
  description?: string;
  team: ObjectId;
  
  // Metadata
  owner?: ObjectId; // User or potentially a Team member
  tier: ServiceTier;
  runbookUrl?: string;
  repoUrl?: string;
  
  // State
  lastSeenAt: Date;
  readiness?: ServiceReadiness;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export type ServiceDocument = mongoose.HydratedDocument<IService>;

const ServiceSchema = new Schema<IService>(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: Team.modelName,
      required: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: User.modelName,
      required: false,
    },
    tier: {
      type: String,
      enum: Object.values(ServiceTier),
      default: ServiceTier.MEDIUM,
    },
    runbookUrl: {
      type: String,
      required: false,
    },
    repoUrl: {
      type: String,
      required: false,
    },
    lastSeenAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    readiness: {
      type: String,
      enum: Object.values(ServiceReadiness),
      default: ServiceReadiness.FAIL,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);

// Ensure unique service names per team
ServiceSchema.index({ team: 1, name: 1 }, { unique: true });

export default mongoose.model<IService>('Service', ServiceSchema);

