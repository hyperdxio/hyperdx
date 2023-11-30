import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
// @ts-ignore don't install the @types for this package, as it conflicts with mongoose
import passportLocalMongoose from 'passport-local-mongoose';

type ObjectId = mongoose.Types.ObjectId;

export interface IUser {
  _id: ObjectId;
  accessKey: string;
  createdAt: Date;
  email: string;
  name: string;
  team: ObjectId;
}

export type UserDocument = mongoose.HydratedDocument<IUser>;

const UserSchema = new Schema(
  {
    name: String,
    email: {
      type: String,
      required: true,
    },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    accessKey: {
      type: String,
      default: function genUUID() {
        return uuidv4();
      },
    },
  },
  {
    timestamps: true,
  },
);

UserSchema.virtual('hasPasswordAuth').get(function (this: IUser) {
  return true;
});

UserSchema.plugin(passportLocalMongoose, {
  usernameField: 'email',
  usernameLowerCase: true,
  usernameCaseInsensitive: true,
});

UserSchema.index({ email: 1 }, { unique: true });

export default mongoose.model<IUser>('User', UserSchema);
