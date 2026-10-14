import MongoStore from 'connect-mongo';
import session from 'express-session';

import * as config from '@/config';
import { isMongoConnected } from '@/utils/readiness';

/**
 * express-session store that keeps sessions in MongoDB and recovers when
 * MongoDB starts after the API.
 *
 * `new MongoStore({ mongoUrl })` connects once, at construction, and every
 * session read/write awaits that one promise. If MongoDB is unreachable when
 * the API starts, the store replays the original MongoServerSelectionError
 * (so every request with a session cookie 500s) until the process restarts,
 * even after connectDBWithRetry has connected mongoose (see
 * https://github.com/hyperdxio/hyperdx/issues/2966).
 *
 * Instead, create the MongoStore once mongoose is connected, and create a new
 * one if its connect or setup fails. Until then, session operations fail fast.
 */
export class MongoSessionStore extends session.Store {
  private store?: MongoStore;

  private getStore(): MongoStore | undefined {
    if (this.store != null) {
      return this.store;
    }
    if (!isMongoConnected()) {
      return undefined;
    }
    const store = new MongoStore({ mongoUrl: config.MONGO_URI });
    // A store whose connect or setup failed would replay that error forever,
    // so drop it and let the next session operation build a fresh one.
    store.collectionP.catch(() => {
      if (this.store === store) {
        this.store = undefined;
      }
    });
    this.store = store;
    return store;
  }

  private withStore(
    callback: ((err?: unknown) => void) | undefined,
    op: (store: MongoStore) => void,
  ) {
    const store = this.getStore();
    if (store == null) {
      callback?.(new Error('MongoDB is not connected'));
      return;
    }
    op(store);
  }

  get(
    sid: string,
    callback: (err: unknown, session?: session.SessionData | null) => void,
  ) {
    this.withStore(callback, store => store.get(sid, callback));
  }

  set(
    sid: string,
    sess: session.SessionData,
    callback?: (err?: unknown) => void,
  ) {
    this.withStore(callback, store => store.set(sid, sess, callback));
  }

  destroy(sid: string, callback?: (err?: unknown) => void) {
    this.withStore(callback, store => store.destroy(sid, callback));
  }

  touch(
    sid: string,
    sess: session.SessionData,
    callback?: (err?: unknown) => void,
  ) {
    this.withStore(callback, store =>
      store.touch(sid, sess as Parameters<MongoStore['touch']>[1], callback),
    );
  }
}
