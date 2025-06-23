import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

type ObjectId = mongoose.Types.ObjectId;

export interface ITeam {
  _id: ObjectId;
  name: string;
  allowedAuthMethods?: 'password'[];
  apiKey: string;
  hookId: string;
  collectorAuthenticationEnforced: boolean;
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
    },
    {
      timestamps: true,
    },
  ),
);
