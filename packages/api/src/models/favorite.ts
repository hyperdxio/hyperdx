import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '.';

export interface IFavorite {
  _id: ObjectId;
  user: ObjectId;
  team: ObjectId;
  resourceType: 'dashboard' | 'savedSearch';
  resourceId: string;
  createdAt: Date;
  updatedAt: Date;
}

const favoriteSchema = new Schema<IFavorite>(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Team',
    },
    resourceType: {
      type: String,
      required: true,
      enum: ['dashboard', 'savedSearch'],
    },
    resourceId: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);

favoriteSchema.index(
  { team: 1, user: 1, resourceType: 1, resourceId: 1 },
  { unique: true },
);

export default mongoose.model<IFavorite>('Favorite', favoriteSchema);
