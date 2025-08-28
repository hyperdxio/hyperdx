import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

type ObjectId = mongoose.Types.ObjectId;

export type TeamCHSettings = {
  metadataMaxRowsToRead?: number;
  searchRowLimit?: number;
  fieldMetadataDisabled?: boolean;
};

export type ITeam = {
  _id: ObjectId;
  id: string;
  name: string;
  allowedAuthMethods?: 'password'[];
  apiKey: string;
  hookId: string;
  collectorAuthenticationEnforced: boolean;
} & TeamCHSettings;
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
      // TODO: maybe add these to a top level Mixed type
      // CH Client Settings
      metadataMaxRowsToRead: Number,
      searchRowLimit: Number,
      fieldMetadataDisabled: Boolean,
    },
    {
      timestamps: true,
      toJSON: { virtuals: true },
      toObject: { virtuals: true },
    },
  ),
);
