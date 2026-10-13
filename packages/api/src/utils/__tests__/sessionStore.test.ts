import session from 'express-session';
import mongoose from 'mongoose';

// jest.mock factories are hoisted, so the state they use must be named `mock*`.
type MockStore = {
  client: unknown;
  collectionP: Promise<unknown>;
  get: jest.Mock;
  set: jest.Mock;
  destroy: jest.Mock;
  touch: jest.Mock;
};
const mockStores: MockStore[] = [];
let mockCollectionP: () => Promise<unknown> = () => Promise.resolve({});
const mockConnection: { readyState: number; client: unknown } = {
  readyState: 0,
  client: undefined,
};

jest.mock('connect-mongo', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(({ client }) => {
    const store: MockStore = {
      client,
      collectionP: mockCollectionP(),
      get: jest.fn((_sid, cb) => cb(null, { client })),
      set: jest.fn((_sid, _sess, cb) => cb?.()),
      destroy: jest.fn((_sid, cb) => cb?.()),
      touch: jest.fn((_sid, _sess, cb) => cb?.()),
    };
    mockStores.push(store);
    return store;
  }),
}));
jest.mock('@/models', () => ({
  mongooseConnection: {
    get readyState() {
      return mockConnection.readyState;
    },
    getClient: () => mockConnection.client,
  },
}));

import { MongooseSessionStore } from '@/utils/sessionStore';

const { connected, connecting, disconnected } = mongoose.ConnectionStates;

type GetResult = { err: unknown; session?: session.SessionData | null };

const getSession = (store: MongooseSessionStore, sid = 'sid') =>
  new Promise<GetResult>(resolve =>
    store.get(sid, (err, session) => resolve({ err, session })),
  );

const connect = (client: unknown) => {
  mockConnection.client = client;
  mockConnection.readyState = connected;
};

describe('MongooseSessionStore', () => {
  beforeEach(() => {
    mockStores.length = 0;
    mockCollectionP = () => Promise.resolve({});
    mockConnection.readyState = disconnected;
    mockConnection.client = undefined;
  });

  it('fails session operations fast until mongoose connects', async () => {
    const store = new MongooseSessionStore();

    const { err } = await getSession(store);

    expect(err).toEqual(new Error('MongoDB is not connected'));
    expect(mockStores).toHaveLength(0);
  });

  it('recovers once mongoose connects after a failed start, without a restart', async () => {
    const store = new MongooseSessionStore();
    // connectDBWithRetry's first attempt left a client that never connected.
    mockConnection.client = { attempt: 1 };
    mockConnection.readyState = connecting;
    expect((await getSession(store)).err).toBeDefined();

    const client = { attempt: 2 };
    connect(client);

    expect(await getSession(store)).toEqual({
      err: null,
      session: { client },
    });
    expect(mockStores).toHaveLength(1);
    expect(mockStores[0].client).toBe(client);
  });

  it('delegates set, destroy and touch to the store on the connected client', async () => {
    connect({});
    const store = new MongooseSessionStore();
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

  it('keeps the store through a transient disconnect of the same client', async () => {
    connect({});
    const store = new MongooseSessionStore();
    await getSession(store);

    mockConnection.readyState = disconnected;

    expect((await getSession(store)).err).toBeNull();
    expect(mockStores).toHaveLength(1);
  });

  it('rebuilds the store when mongoose reconnects with a new client', async () => {
    connect({ id: 'a' });
    const store = new MongooseSessionStore();
    await getSession(store);

    // A closed client can't be reused; the reconnect makes a new one.
    const client = { id: 'b' };
    mockConnection.client = client;
    mockConnection.readyState = connecting;
    expect((await getSession(store)).err).toBeDefined();

    connect(client);

    expect((await getSession(store)).session).toEqual({ client });
    expect(mockStores).toHaveLength(2);
  });

  it('replaces a store whose collection setup failed', async () => {
    mockCollectionP = () => Promise.reject(new Error('createIndex failed'));
    connect({});
    const store = new MongooseSessionStore();
    await getSession(store);
    await new Promise(setImmediate);

    mockCollectionP = () => Promise.resolve({});
    await getSession(store);

    expect(mockStores).toHaveLength(2);
  });
});
