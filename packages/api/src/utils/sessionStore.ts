import MongoStore from 'connect-mongo';
import session from 'express-session';

import * as config from '@/config';
import { isMongoConnected } from '@/utils/readiness';

// Same schedule as connectDBWithRetry's initial-connect retries.
const REBUILD_BASE_DELAY_MS = 1000;
const REBUILD_MAX_DELAY_MS = 30000;

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
 * one, with backoff, if its connect or setup fails. Until then, session
 * operations fail fast.
 */
export class MongoSessionStore extends session.Store {
  private store?: MongoStore;
  private failures = 0;
  private retryAt = 0;

  private getStore(): MongoStore | Error {
    if (this.store != null) {
      return this.store;
    }
    if (!isMongoConnected()) {
      return new Error('MongoDB is not connected');
    }
    // Without a delay, a persistent setup failure (e.g. a missing createIndex
    // privilege) would open a new client on every session operation.
    if (Date.now() < this.retryAt) {
      return new Error('Session store setup failed, retrying');
    }
    const store = new MongoStore({ mongoUrl: config.MONGO_URI });
    // A store whose connect or setup failed would replay that error forever,
    // so drop it and let a later session operation build a fresh one.
    store.collectionP.catch(() => {
      if (this.store === store) {
        this.store = undefined;
      }
      this.failures++;
      this.retryAt =
        Date.now() +
        Math.min(
          REBUILD_BASE_DELAY_MS * 2 ** (this.failures - 1),
          REBUILD_MAX_DELAY_MS,
        );
      // The client may have connected before setup failed.
      store.close().catch(() => {});
    });
    this.store = store;
    return store;
  }

  private withStore(
    callback: ((err?: unknown) => void) | undefined,
    op: (store: MongoStore) => void,
  ) {
    const store = this.getStore();
    if (store instanceof Error) {
      callback?.(store);
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
