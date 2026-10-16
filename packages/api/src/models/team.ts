import { type Team } from '@hyperdx/common-utils/dist/types';
import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

type ObjectId = mongoose.Types.ObjectId;

export interface ITeam extends Team {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type TeamDocument = mongoose.HydratedDocument<ITeam>;

export default mongoose.model<ITeam>(
  'Team',
  new Schema<ITeam>(
    {
      name: String,
      allowedAuthMethods: [String],
      hookId: {
        type: String,
        default: function genUUID() {
          return uuidv4();
        },
      },
      apiKey: {
        type: String,
        default: function genUUID() {
          return uuidv4();
        },
      },
      collectorAuthenticationEnforced: {
        type: Boolean,
        default: false,
      },
      isMetricsSeriesTableEnabled: {
        type: Boolean,
        default: false,
      },
      // CH Client Settings
      metadataMaxRowsToRead: Number,
      searchRowLimit: Number,
      queryTimeout: Number,
      fieldMetadataDisabled: Boolean,
      parallelizeWhenPossible: Boolean,
      filterKeysFetchLimit: Number,
      // Query Language Settings
      defaultQueryLanguage: {
        type: String,
        enum: ['lucene', 'sql'],
        default: 'lucene',
      },
      allowedQueryLanguages: {
        type: [String],
        enum: ['lucene', 'sql'],
        default: ['lucene', 'sql'],
      },
    },
    {
      timestamps: true,
      toJSON: { virtuals: true },
      toObject: { virtuals: true },
    },
  ),
);
