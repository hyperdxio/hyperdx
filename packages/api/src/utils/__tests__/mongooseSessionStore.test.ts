import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import Session from '@/models/session';
import { MongooseSessionStore } from '@/utils/mongooseSessionStore';

describe('MongooseSessionStore', () => {
  let store: MongooseSessionStore;

  beforeAll(async () => {
    await connectDB();
    store = new MongooseSessionStore({ sessionTTL: 1000 * 60 * 60 }); // 1 hour
  });

  afterEach(async () => {
    await clearDBCollections();
  });

  afterAll(async () => {
    await closeDB();
  });

  const makeSession = (overrides = {}) => ({
    cookie: {
      originalMaxAge: 3600000,
      expires: new Date(Date.now() + 3600000),
      httpOnly: true,
      path: '/',
    },
    passport: { user: 'test-user-id' },
    ...overrides,
  });

  describe('set()', () => {
    it('creates a new session', done => {
      const sessionData = makeSession();

      store.set('test-sid-1', sessionData as any, async err => {
        expect(err).toBeNull();

        const doc = await Session.findOne({ sid: 'test-sid-1' });
        expect(doc).not.toBeNull();
        expect(doc!.sid).toBe('test-sid-1');

        const parsed = JSON.parse(doc!.session);
        expect(parsed.passport.user).toBe('test-user-id');
        done();
      });
    });

    it('updates an existing session', done => {
      const sessionData = makeSession();

      store.set('test-sid-2', sessionData as any, err => {
        expect(err).toBeNull();

        const updatedSession = makeSession({
          passport: { user: 'updated-user-id' },
        });

        store.set('test-sid-2', updatedSession as any, async err2 => {
          expect(err2).toBeNull();

          const docs = await Session.find({ sid: 'test-sid-2' });
          expect(docs).toHaveLength(1);

          const parsed = JSON.parse(docs[0].session);
          expect(parsed.passport.user).toBe('updated-user-id');
          done();
        });
      });
    });
  });

  describe('get()', () => {
    it('retrieves a valid session', done => {
      const sessionData = makeSession();

      store.set('test-sid-3', sessionData as any, err => {
        expect(err).toBeNull();

        store.get('test-sid-3', (err2, session) => {
          expect(err2).toBeNull();
          expect(session).not.toBeNull();
          expect((session as any).passport).toEqual({ user: 'test-user-id' });
          done();
        });
      });
    });

    it('returns null for expired session', async () => {
      // Manually create an expired session
      await Session.create({
        sid: 'expired-sid',
        session: JSON.stringify(makeSession()),
        expires: new Date(Date.now() - 1000), // expired 1 second ago
      });

      return new Promise<void>((resolve, reject) => {
        store.get('expired-sid', (err, session) => {
          try {
            expect(err).toBeNull();
            expect(session).toBeNull();
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('returns null for non-existent session', done => {
      store.get('non-existent-sid', (err, session) => {
        expect(err).toBeNull();
        expect(session).toBeNull();
        done();
      });
    });
  });

  describe('destroy()', () => {
    it('removes a session', done => {
      const sessionData = makeSession();

      store.set('test-sid-4', sessionData as any, err => {
        expect(err).toBeNull();

        store.destroy('test-sid-4', async err2 => {
          expect(err2).toBeNull();

          const doc = await Session.findOne({ sid: 'test-sid-4' });
          expect(doc).toBeNull();
          done();
        });
      });
    });
  });

  describe('touch()', () => {
    it('updates session expiry', done => {
      const sessionData = makeSession();

      store.set('test-sid-5', sessionData as any, err => {
        expect(err).toBeNull();

        const newExpiry = new Date(Date.now() + 7200000); // 2 hours from now
        const touchSession = makeSession({
          cookie: {
            originalMaxAge: 7200000,
            expires: newExpiry,
            httpOnly: true,
            path: '/',
          },
        });

        store.touch('test-sid-5', touchSession as any, async err2 => {
          expect(err2).toBeNull();

          const doc = await Session.findOne({ sid: 'test-sid-5' });
          expect(doc).not.toBeNull();
          // Expiry should be updated to approximately the new value
          expect(doc!.expires.getTime()).toBeCloseTo(newExpiry.getTime(), -3);
          done();
        });
      });
    });
  });
});
