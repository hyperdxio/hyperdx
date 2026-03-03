import mongoose, { Schema } from 'mongoose';

export interface ISession {
  sid: string;
  session: string; // JSON string
  expires: Date;
}

const SessionSchema = new Schema<ISession>({
  sid: { type: String, required: true, unique: true, index: true },
  session: { type: String, required: true },
  expires: { type: Date, required: true },
});

SessionSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ISession>('Session', SessionSchema);
