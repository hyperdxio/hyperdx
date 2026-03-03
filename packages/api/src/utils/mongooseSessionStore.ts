import { SessionData, Store } from 'express-session';

import Session from '@/models/session';

interface MongooseSessionStoreOptions {
  sessionTTL?: number; // Session TTL in milliseconds (default: 30 days)
}

const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

export class MongooseSessionStore extends Store {
  private sessionTTL: number;

  constructor(options: MongooseSessionStoreOptions = {}) {
    super();
    this.sessionTTL = options.sessionTTL ?? DEFAULT_TTL;
  }

  get(
    sid: string,
    callback: (err?: Error | null, session?: SessionData | null) => void,
  ): void {
    Session.findOne({ sid, expires: { $gt: new Date() } })
      .lean()
      .then(doc => {
        if (!doc) {
          return callback(null, null);
        }
        try {
          const session = JSON.parse(doc.session);
          callback(null, session);
        } catch (err) {
          callback(err as Error);
        }
      })
      .catch(err => callback(err));
  }

  set(
    sid: string,
    session: SessionData,
    callback?: (err?: Error | null) => void,
  ): void {
    const expires = session.cookie?.expires
      ? new Date(session.cookie.expires)
      : new Date(Date.now() + this.sessionTTL);

    Session.findOneAndUpdate(
      { sid },
      {
        sid,
        session: JSON.stringify(session),
        expires,
      },
      { upsert: true },
    )
      .then(() => callback?.(null))
      .catch(err => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: Error | null) => void): void {
    Session.deleteOne({ sid })
      .then(() => callback?.(null))
      .catch(err => callback?.(err));
  }

  touch(
    sid: string,
    session: SessionData,
    callback?: (err?: Error | null) => void,
  ): void {
    const expires = session.cookie?.expires
      ? new Date(session.cookie.expires)
      : new Date(Date.now() + this.sessionTTL);

    Session.updateOne({ sid }, { expires })
      .then(() => callback?.(null))
      .catch(err => callback?.(err));
  }
}
