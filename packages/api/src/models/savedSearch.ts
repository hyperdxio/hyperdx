import { SavedSearchSchema } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

type ObjectId = mongoose.Types.ObjectId;

export interface ISavedSearch
  extends Omit<z.infer<typeof SavedSearchSchema>, 'source'> {
  _id: ObjectId;
  team: ObjectId;
  source: ObjectId;
}

export const SavedSearch = mongoose.model<ISavedSearch>(
  'SavedSearch',
  new Schema<ISavedSearch>(
    {
      team: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Team',
      },

      name: String,
      select: String,
      where: String,
      whereLanguage: String,
      orderBy: String,
      source: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Source',
      },
      tags: [String],
      filters: [{ type: mongoose.Schema.Types.Mixed }],
    },
    {
      toJSON: { virtuals: true },
      timestamps: true,
    },
  ),
);
