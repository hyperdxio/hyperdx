import MongoStore from 'connect-mongo';
import session from 'express-session';

import { mongooseConnection } from '@/models';
import { isMongoConnected } from '@/utils/readiness';

type MongoClient = ReturnType<typeof mongooseConnection.getClient>;
type ConnectMongoClient = NonNullable<
  ConstructorParameters<typeof MongoStore>[0]['client']
>;

/**
 * express-session store that keeps sessions in MongoDB over the app's
 * mongoose connection.
 *
 * `new MongoStore({ mongoUrl })` opens its own MongoClient once, at
 * construction, and caches that connect promise. If MongoDB is unreachable
 * when the API starts, every session read/write replays the original
 * MongoServerSelectionError (so every request with a session cookie 500s)
 * until the process restarts, even after connectDBWithRetry has connected
 * mongoose (see https://github.com/hyperdxio/hyperdx/issues/2966).
 *
 * Instead, build a MongoStore on mongoose's client once mongoose is connected,
 * and rebuild it whenever mongoose replaces that client: every
 * mongoose.connect() creates a new one, and a closed client can't be reused.
 * Until mongoose connects, session operations fail fast.
 */
export class MongooseSessionStore extends session.Store {
  private store?: MongoStore;
  private storeClient?: MongoClient;

  private getStore(): MongoStore | undefined {
    const client = mongooseConnection.getClient();
    // Keep using the store through a transient disconnect of the same client;
    // the driver reconnects it on its own.
    if (this.store != null && this.storeClient === client) {
      return this.store;
    }
    if (!isMongoConnected()) {
      return undefined;
    }
    // mongoose bundles its own mongodb driver (4.x), so its MongoClient type
    // differs from the hoisted 6.x one connect-mongo is typed against. 4.x is
    // connect-mongo's declared peer and covers the collection CRUD it uses.
    const store = new MongoStore({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      client: client as unknown as ConnectMongoClient,
    });
    // A store whose collection setup failed would replay that error forever,
    // so drop it and let the next session operation build a fresh one.
    store.collectionP.catch(() => {
      if (this.store === store) {
        this.store = undefined;
      }
    });
    this.store = store;
    this.storeClient = client;
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
    callback: (err: any, session?: session.SessionData | null) => void,
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
