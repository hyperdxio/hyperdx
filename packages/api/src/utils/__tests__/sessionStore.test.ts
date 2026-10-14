import session from 'express-session';

// jest.mock factories are hoisted, so the state they use must be named `mock*`.
type MockStore = {
  mongoUrl: string;
  collectionP: Promise<unknown>;
  get: jest.Mock;
  set: jest.Mock;
  destroy: jest.Mock;
  touch: jest.Mock;
  close: jest.Mock;
};
const mockStores: MockStore[] = [];
let mockCollectionP: () => Promise<unknown> = () => Promise.resolve({});
let mockMongoConnected = false;

jest.mock('connect-mongo', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(({ mongoUrl }) => {
    const store: MockStore = {
      mongoUrl,
      collectionP: mockCollectionP(),
      get: jest.fn((_sid, cb) => cb(null, { mongoUrl })),
      set: jest.fn((_sid, _sess, cb) => cb?.()),
      destroy: jest.fn((_sid, cb) => cb?.()),
      touch: jest.fn((_sid, _sess, cb) => cb?.()),
      close: jest.fn(() => Promise.resolve()),
    };
    mockStores.push(store);
    return store;
  }),
}));
jest.mock('@/config', () => ({
  MONGO_URI: 'mongodb://localhost:27017/hyperdx-test',
}));
jest.mock('@/utils/readiness', () => ({
  isMongoConnected: () => mockMongoConnected,
}));
// Keeps the simulated setup failures out of the test output.
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

import { MongoSessionStore } from '@/utils/sessionStore';

type GetResult = { err: unknown; session?: session.SessionData | null };

const getSession = (store: MongoSessionStore, sid = 'sid') =>
  new Promise<GetResult>(resolve =>
    store.get(sid, (err, session) => resolve({ err, session })),
  );

const flush = () => new Promise(setImmediate);

describe('MongoSessionStore', () => {
  let nowSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    mockStores.length = 0;
    mockCollectionP = () => Promise.resolve({});
    mockMongoConnected = false;
  });

  afterEach(() => {
    nowSpy?.mockRestore();
    nowSpy = undefined;
  });

  it('fails session operations fast until mongoose connects', async () => {
    const store = new MongoSessionStore();

    const { err } = await getSession(store);

    expect(err).toEqual(new Error('MongoDB is not connected'));
    expect(mockStores).toHaveLength(0);
  });

  it('recovers once mongoose connects after a failed start, without a restart', async () => {
    const store = new MongoSessionStore();
    expect((await getSession(store)).err).toBeDefined();

    mockMongoConnected = true;

    expect(await getSession(store)).toEqual({
      err: null,
      session: { mongoUrl: 'mongodb://localhost:27017/hyperdx-test' },
    });
    expect(mockStores).toHaveLength(1);
  });

  it('delegates set, destroy and touch to the store', async () => {
    mockMongoConnected = true;
    const store = new MongoSessionStore();
    const sess = { cookie: new session.Cookie() };
    const set = jest.fn();
    const destroy = jest.fn();
    const touch = jest.fn();

    store.set('sid', sess, set);
    store.destroy('sid', destroy);
    store.touch('sid', sess, touch);

    expect(mockStores).toHaveLength(1);
    expect(mockStores[0].set).toHaveBeenCalledWith('sid', sess, set);
    expect(mockStores[0].destroy).toHaveBeenCalledWith('sid', destroy);
    expect(mockStores[0].touch).toHaveBeenCalledWith('sid', sess, touch);
    expect(set).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
    expect(touch).toHaveBeenCalled();
  });

  it('keeps a connected store through a later MongoDB outage', async () => {
    // The store's MongoClient reconnects by itself once it has connected.
    mockMongoConnected = true;
    const store = new MongoSessionStore();
    await getSession(store);

    mockMongoConnected = false;

    expect((await getSession(store)).err).toBeNull();
    expect(mockStores).toHaveLength(1);
  });

  it('closes a store whose connect or setup failed', async () => {
    mockCollectionP = () => Promise.reject(new Error('createIndex failed'));
    mockMongoConnected = true;
    const store = new MongoSessionStore();

    await getSession(store);
    await flush();

    expect(mockStores[0].close).toHaveBeenCalled();
  });

  it('backs off exponentially before replacing a failed store', async () => {
    const retrying = new Error('Session store setup failed, retrying');
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    mockCollectionP = () => Promise.reject(new Error('createIndex failed'));
    mockMongoConnected = true;
    const store = new MongoSessionStore();
    await getSession(store);
    await flush();

    nowSpy.mockReturnValue(999);
    expect((await getSession(store)).err).toEqual(retrying);
    expect(mockStores).toHaveLength(1);

    nowSpy.mockReturnValue(1000);
    await getSession(store);
    await flush();
    expect(mockStores).toHaveLength(2);

    nowSpy.mockReturnValue(2999);
    expect((await getSession(store)).err).toEqual(retrying);
    expect(mockStores).toHaveLength(2);

    mockCollectionP = () => Promise.resolve({});
    nowSpy.mockReturnValue(3000);
    expect((await getSession(store)).err).toBeNull();
    expect(mockStores).toHaveLength(3);
    expect(mockStores[2].get).toHaveBeenCalled();
  });

  it('close() closes the current store and the next operation builds a new one', async () => {
    mockMongoConnected = true;
    const store = new MongoSessionStore();
    await getSession(store);

    await store.close();

    expect(mockStores[0].close).toHaveBeenCalled();
    expect((await getSession(store)).err).toBeNull();
    expect(mockStores).toHaveLength(2);
    expect(mockStores[1].get).toHaveBeenCalled();
  });

  it('close() resolves when no store was created', async () => {
    await expect(new MongoSessionStore().close()).resolves.toBeUndefined();
  });
});
