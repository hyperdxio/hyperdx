// @ts-ignore don't install the @types for this package, as it conflicts with mongoose
import passportLocalMongoose from '@hyperdx/passport-local-mongoose';
import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

type ObjectId = mongoose.Types.ObjectId;

export interface IUser {
  _id: ObjectId;
  accessKey: string;
  createdAt: Date;
  email: string;
  name: string;
  team: ObjectId;
  /**
   * Per-user opt-ins for in-development features ("HyperDX Labs"). An
   * enabled-set: a key present with `true` is on, an absent key is off.
   *
   * Deliberately not typed per-lab. The registry lives in
   * packages/app/src/labs/registry.ts so that adding a lab never has to touch
   * this file; ids and count are bounded on the write path by UserLabsSchema.
   * Absent on every document created before labs existed, which reads as "no
   * labs enabled". See agent_docs/labs.md.
   */
  labs?: Record<string, boolean>;
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
    // Mixed, not Map: a Mongoose Map's own toJSON() returns a *native* Map
    // unless handed { flattenMaps: true }, and `GET /me` passes this value
    // straight to res.json() — it would serialize as `{}` forever. See the
    // MongooseMap note in packages/api/src/models/webhook.ts. Mixed round-trips
    // as a plain object. Its one weakness (no change tracking on nested paths)
    // never comes up because setUserLabs only ever $sets the whole object.
    labs: { type: Schema.Types.Mixed },
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
UserSchema.index({ accessKey: 1 }, { unique: true });

export default mongoose.model<IUser>('User', UserSchema);
