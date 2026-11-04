import mongoose from 'mongoose';
import request from 'supertest';

import app from '@/api-app';
import * as config from '@/config';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import Team from '@/models/team';
import User from '@/models/user';

import { startKeycloakTestProvider } from './keycloakProvider';

jest.mock('@/config', () => ({
  __esModule: true,
  ...jest.requireActual('@/config'),
  FRONTEND_URL: 'http://127.0.0.1:4500',
  FRONTEND_REDIRECT_BASE: 'http://127.0.0.1:4500',
  SESSION_MAX_AGE_SECONDS: 86400,
  SESSION_IDLE_TIMEOUT_SECONDS: 1800,
  KEYCLOAK_REQUIRED: false,
  KEYCLOAK: {
    issuer: '',
    clientId: 'hyperdx',
    clientSecret: 'test-only-secret',
    callbackUrl: 'http://127.0.0.1:4500/api/login/keycloak/callback',
  },
}));

describe('configured session lifetime', () => {
  let provider: Awaited<ReturnType<typeof startKeycloakTestProvider>>;
  const { realFetch } = globalThis as typeof globalThis & {
    realFetch: typeof fetch;
  };
  beforeAll(async () => {
    jest.mocked(fetch).mockImplementation(realFetch);
    provider = await startKeycloakTestProvider();
    if (config.KEYCLOAK) config.KEYCLOAK.issuer = provider.issuer;
    await connectDB();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    jest.mocked(fetch).mockImplementation(realFetch);
    await clearDBCollections();
  });
  afterAll(async () => {
    await provider.stop();
    await closeDB();
  });

  async function login(method: 'password' | 'keycloak') {
    const agent = request.agent(app);
    if (method === 'password') {
      const credentials = {
        email: 'password@example.com',
        password: 'TacoCat!2#4X',
      };
      await agent
        .post('/register/password')
        .send({ ...credentials, confirmPassword: credentials.password })
        .expect(200);
      await agent.post('/login/password').send(credentials).expect(303);
    } else {
      const team = await Team.create({ name: 'Test' });
      await User.create({
        email: provider.account.email,
        team: team._id,
        keycloak: { issuer: provider.issuer, subject: provider.account.sub },
      });
      const start = await agent.get('/login/keycloak').expect(302);
      const callback = await provider.authorize(start.headers.location);
      await agent.get(callback).expect(303);
    }
    const store = mongoose.connection.collection('sessions');
    const session = await store.findOne({ session: { $regex: '"passport"' } });
    if (!session) throw new Error('Missing authenticated session');
    return { agent, store, session, data: JSON.parse(session.session) };
  }

  it.each(['password', 'keycloak'] as const)(
    '%s sessions survive short token lifetimes but expire at 24 hours despite activity',
    async method => {
      const before = Date.now();
      const { agent, data, store, session } = await login(method);
      expect(data.authExpiresAt).toBeGreaterThanOrEqual(before + 86400000);
      expect(data.authExpiresAt).toBeLessThanOrEqual(Date.now() + 86400000);
      expect(data.cookie.originalMaxAge).toBe(1800000);
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 10 * 60 * 1000);
      const active = await agent.get('/me').expect(200);
      const cookie = active.headers['set-cookie'][0].split(';')[0];
      const updated = await store.findOne({ _id: session._id });
      expect(JSON.parse(updated?.session).authExpiresAt).toBe(
        data.authExpiresAt,
      );
      jest.spyOn(Date, 'now').mockReturnValue(now + 86400000);
      await request(app).get('/me').set('Cookie', cookie).expect(401);
      expect(await store.findOne({ _id: session._id })).toBeNull();
    },
  );

  it.each(['password', 'keycloak'] as const)(
    'rejects an idle %s session even if its cookie is replayed',
    async method => {
      const { agent, store, session } = await login(method);
      await store.updateOne(
        { _id: session._id },
        { $set: { expires: new Date(Date.now() - 1) } },
      );
      await agent.get('/me').expect(401);
    },
  );

  it('requires login again for sessions predating the configured absolute limit', async () => {
    const { agent, data, store, session } = await login('password');
    delete data.authExpiresAt;
    await store.updateOne(
      { _id: session._id },
      { $set: { session: JSON.stringify(data) } },
    );
    await agent.get('/me').expect(401);
  });

  it('invalidates sessions that retain a longer previous idle timeout', async () => {
    const { agent, data, store, session } = await login('password');
    data.cookie.originalMaxAge = 86400000;
    await store.updateOne(
      { _id: session._id },
      { $set: { session: JSON.stringify(data) } },
    );
    await agent.get('/me').expect(401);
    expect(await store.findOne({ _id: session._id })).toBeNull();
  });

  it('accepts an existing session with a shorter idle limit', async () => {
    const { agent, data, store, session } = await login('password');
    data.cookie.originalMaxAge = 300000;
    await store.updateOne(
      { _id: session._id },
      { $set: { session: JSON.stringify(data) } },
    );
    await agent.get('/me').expect(200);
  });
});
