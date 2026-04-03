import crypto from 'crypto';
import mongoose, { Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

type ObjectId = mongoose.Types.ObjectId;

const CONNECTION_PASSWORD_PREFIX = 'enc:v1:';

function getConnectionPasswordKey() {
  const secret = process.env.CONNECTION_PASSWORD_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('Missing CONNECTION_PASSWORD_ENCRYPTION_KEY');
  }

  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptConnectionPassword(password: string) {
  if (!password || password.startsWith(CONNECTION_PASSWORD_PREFIX)) {
    return password;
  }

  const key = getConnectionPasswordKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(password, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${CONNECTION_PASSWORD_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptConnectionPassword(password: string) {
  if (!password || !password.startsWith(CONNECTION_PASSWORD_PREFIX)) {
    return password;
  }

  const parts = password.slice(CONNECTION_PASSWORD_PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted connection password format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getConnectionPasswordKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);

  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}

export interface IConnection {
  _id: ObjectId;
  id: string;
  host: string;
  name: string;
  password: string;
  username: string;
  team: ObjectId;
  hyperdxSettingPrefix?: string;
}

const ConnectionSchema = new Schema<IConnection>(
  {
    team: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Team',
    },
    name: String,
    host: String,
    username: String,
    password: {
      type: String,
      select: false,
    },
    hyperdxSettingPrefix: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);

ConnectionSchema.pre('save', function connectionPreSave(next) {
  if (this.isModified('password') && this.password) {
    this.password = encryptConnectionPassword(this.password);
  }

  next();
});

export default mongoose.model<IConnection>('Connection', ConnectionSchema);
