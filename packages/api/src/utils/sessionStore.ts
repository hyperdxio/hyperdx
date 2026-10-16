import MongoStore from 'connect-mongo';
import session from 'express-session';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';
import { isMongoConnected } from '@/utils/readiness';

// Same schedule as connectDBWithRetry's initial-connect retries.
const REBUILD_BASE_DELAY_MS = 1000;
const REBUILD_MAX_DELAY_MS = 30000;

const setupFailureCounter = getCounter('hyperdx.session_store.setup_failures', {
  description:
    'Failed session store connects or setups (TTL index); each schedules a rebuild with backoff.',
});

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
    store.collectionP.catch((err: unknown) => {
      // Only close() replaces the current store, and it has already closed
      // this one: its rejection isn't a setup failure, and the current store
      // may be a newer one.
      if (this.store !== store) {
        return;
      }
      this.store = undefined;
      this.failures++;
      const retryInMs = Math.min(
        REBUILD_BASE_DELAY_MS * 2 ** (this.failures - 1),
        REBUILD_MAX_DELAY_MS,
      );
      this.retryAt = Date.now() + retryInMs;
      setupFailureCounter.add(1);
      logger.error(
        { err: serializeError(err), failures: this.failures, retryInMs },
        'Session store setup failed, retrying',
      );
      // The client may have connected before setup failed.
      store.close().catch(() => {});
    });
    this.store = store;
    return store;
  }

  /**
   * Closes the current store's MongoClient. A closed client can't be reused,
   * so the next session operation builds a new store, without waiting out
   * any earlier backoff; this lets the server start again after a shutdown,
   * as the integration tests do.
   */
  async close(): Promise<void> {
    const store = this.store;
    this.store = undefined;
    this.failures = 0;
    this.retryAt = 0;
    await store?.close();
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
