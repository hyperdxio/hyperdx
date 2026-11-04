import mongoose from 'mongoose';
import request from 'supertest';

import app from '@/api-app';
import * as config from '@/config';
import { clearDBCollections, closeDB, connectDB } from '@/fixtures';
import Team from '@/models/team';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user';

import { startKeycloakTestProvider } from './keycloakProvider';

jest.mock('@/config', () => ({
  __esModule: true,
  ...jest.requireActual('@/config'),
  FRONTEND_URL: 'http://127.0.0.1:4500',
  FRONTEND_REDIRECT_BASE: 'http://127.0.0.1:4500',
  KEYCLOAK_REQUIRED: false,
  KEYCLOAK: {
    issuer: '',
    clientId: 'hyperdx',
    clientSecret: 'test-only-secret',
    callbackUrl: 'http://127.0.0.1:4500/api/login/keycloak/callback',
  },
}));

describe('Keycloak OIDC routes with real provider, Passport, and Mongo sessions', () => {
  let provider: Awaited<ReturnType<typeof startKeycloakTestProvider>>;
  const { realFetch } = globalThis as typeof globalThis & {
    realFetch: typeof fetch;
  };

  beforeAll(async () => {
    jest.mocked(fetch).mockImplementation(realFetch);
    provider = await startKeycloakTestProvider();
    if (config.KEYCLOAK) config.KEYCLOAK.issuer = provider.issuer;
    await connectDB();
    await User.init();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    jest.mocked(fetch).mockImplementation(realFetch);
    provider.settings.idTokenTtl = 300;
    await clearDBCollections();
  });
  afterAll(async () => {
    await provider.stop();
    await closeDB();
  });

  async function mappedUser() {
    const team = await Team.create({ name: 'Existing team' });
    return User.create({
      email: provider.account.email,
      team: team._id,
      keycloak: { issuer: provider.issuer, subject: provider.account.sub },
    });
  }

  async function login(agent = request.agent(app), suffix = '') {
    const start = await agent.get(`/login/keycloak${suffix}`).expect(302);
    const callback = await provider.authorize(start.headers.location);
    const result = await agent.get(callback).expect(303);
    return { agent, start, callback, result };
  }

  it('uses code flow with PKCE, state, nonce and a fixed callback', async () => {
    const response = await request
      .agent(app)
      .get('/login/keycloak?redirect=https://evil.example')
      .expect(302);
    const authorization = new URL(response.headers.location);
    expect(authorization.origin).toBe(provider.issuer);
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(authorization.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorization.searchParams.get('state')).toBeTruthy();
    expect(authorization.searchParams.get('nonce')).toBeTruthy();
    expect(authorization.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:4500/api/login/keycloak/callback',
    );
    expect(response.headers.location).not.toContain('test-only-secret');
  });

  it('creates a Passport session, rotates its ID and retains no OIDC tokens', async () => {
    const user = await mappedUser();
    const { agent, start, result } = await login();
    expect(result.headers.location).toBe('http://127.0.0.1:4500/');
    const beforeCookie = start.headers['set-cookie'][0].split(';')[0];
    const afterCookie = result.headers['set-cookie'][0].split(';')[0];
    expect(afterCookie).not.toBe(beforeCookie);
    const me = await agent.get('/me').expect(200);
    expect(me.body.id).toBe(user.id);
    await request(app).get('/me').set('Cookie', beforeCookie).expect(401);
    const sessions = await mongoose.connection
      .collection('sessions')
      .find({})
      .toArray();
    const session = sessions
      .map(s => JSON.parse(s.session))
      .find(s => s.passport);
    expect(session.passport.user).toBe(user.id);
    expect(session.keycloak.expiresAt).toBeGreaterThan(Date.now());
    expect(JSON.stringify(sessions)).not.toMatch(
      /access_token|refresh_token|id_token|test-only-secret/,
    );
  });

  it('rejects unknown identities without creating accounts', async () => {
    const { agent, result } = await login();
    expect(result.headers.location).toContain('err=keycloak');
    await agent.get('/me').expect(401);
    expect(await User.countDocuments()).toBe(0);
  });

  it('accepts an invitation through the existing team membership model', async () => {
    const team = await Team.create({ name: 'Inviting team' });
    await TeamInvite.create({
      teamId: team._id,
      email: provider.account.email,
      token: 'invite-token',
    });
    const { agent } = await login(request.agent(app), '?token=invite-token');
    const me = await agent.get('/me').expect(200);
    expect(me.body.team._id).toBe(team.id);
    expect(await TeamInvite.countDocuments()).toBe(0);
    const members = await agent.get('/team/members').expect(200);
    expect(members.body.data[0].hasPasswordAuth).toBe(false);
    expect(JSON.stringify(members.body)).not.toMatch(/hash|salt/);
  });

  it.each(['nonce', 'codeVerifier', 'createdAt'])(
    'rejects a callback with invalid stored %s',
    async field => {
      await mappedUser();
      const agent = request.agent(app);
      const start = await agent.get('/login/keycloak').expect(302);
      const callback = await provider.authorize(start.headers.location);
      const store = mongoose.connection.collection('sessions');
      const session = await store.findOne({ session: { $regex: '"oidc"' } });
      if (!session) throw new Error('Missing OIDC transaction');
      const data = JSON.parse(session.session);
      data.oidc[field] =
        field === 'createdAt' ? Date.now() - 11 * 60 * 1000 : 'incorrect';
      await store.updateOne(
        { _id: session._id },
        { $set: { session: JSON.stringify(data) } },
      );
      const rejected = await agent.get(callback).expect(303);
      expect(rejected.headers.location).toContain('err=keycloak');
      await agent.get('/me').expect(401);
    },
  );

  it('rejects an authorization response from another issuer', async () => {
    await mappedUser();
    const agent = request.agent(app);
    const start = await agent.get('/login/keycloak').expect(302);
    const callback = new URL(
      await provider.authorize(start.headers.location),
      config.FRONTEND_URL,
    );
    callback.searchParams.set('iss', 'https://other.example.com');
    expect(
      (await agent.get(callback.pathname + callback.search).expect(303)).headers
        .location,
    ).toContain('err=keycloak');
    await agent.get('/me').expect(401);
  });

  it('rejects a token whose signature was altered in transit', async () => {
    await mappedUser();
    jest.mocked(fetch).mockImplementation(async (input, init) => {
      const response = await realFetch(input, init);
      if (new URL(response.url).pathname !== '/token') return response;
      const body = await response.json();
      body.id_token = body.id_token.slice(0, -8) + 'tampered';
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: response.headers,
      });
    });
    const { agent, result } = await login();
    expect(result.headers.location).toContain('err=keycloak');
    await agent.get('/me').expect(401);
  });

  it('rejects an expired ID token', async () => {
    await mappedUser();
    provider.settings.idTokenTtl = -120;
    const { agent, result } = await login();
    expect(result.headers.location).toContain('err=keycloak');
    await agent.get('/me').expect(401);
  });

  it('preserves password registration/login in optional mode and rejects that session in required mode', async () => {
    const credentials = {
      email: 'local@example.com',
      password: 'TacoCat!2#4X',
      confirmPassword: 'TacoCat!2#4X',
    };
    await request(app).post('/register/password').send(credentials).expect(200);
    const agent = request.agent(app);
    await agent
      .post('/login/password')
      .type('form')
      .send(credentials)
      .expect(303);
    await agent.get('/me').expect(200);
    const members = await agent.get('/team/members').expect(200);
    expect(members.body.data[0].hasPasswordAuth).toBe(true);
    expect(JSON.stringify(members.body)).not.toMatch(/hash|salt/);
    jest.replaceProperty(config, 'KEYCLOAK_REQUIRED', true);
    await agent.get('/me').expect(401);
  });

  it('exposes only nonsecret rollout flags through installation', async () => {
    const response = await request(app).get('/installation').expect(200);
    expect(response.body).toEqual({
      isTeamExisting: false,
      keycloakEnabled: true,
      keycloakRequired: false,
    });
  });

  it.each(['missing', 'wrong', 'provider_error'])(
    'rejects %s state/callback without a session',
    async failure => {
      await mappedUser();
      const agent = request.agent(app);
      const start = await agent.get('/login/keycloak').expect(302);
      const callback = new URL(
        await provider.authorize(start.headers.location),
        config.FRONTEND_URL,
      );
      if (failure === 'missing') callback.searchParams.delete('state');
      if (failure === 'wrong') callback.searchParams.set('state', 'incorrect');
      if (failure === 'provider_error') {
        callback.searchParams.delete('code');
        callback.searchParams.set('error', 'access_denied');
      }
      const rejected = await agent
        .get(callback.pathname + callback.search)
        .expect(303);
      expect(rejected.headers.location).toContain('err=keycloak');
      await agent.get('/me').expect(401);
    },
  );

  it('rejects an unsolicited callback and replay of a completed callback', async () => {
    await request(app)
      .get('/login/keycloak/callback?code=unsolicited&state=x')
      .expect(303);
    await mappedUser();
    const { agent, callback } = await login();
    const replay = await agent.get(callback).expect(303);
    expect(replay.headers.location).toContain('err=keycloak');
  });

  it('enforces absolute session expiry even when the Mongo cookie is still live', async () => {
    await mappedUser();
    const { agent } = await login();
    const store = mongoose.connection.collection('sessions');
    const session = await store.findOne({ session: { $regex: '"passport"' } });
    if (!session) throw new Error('Missing authenticated session');
    const data = JSON.parse(session.session);
    data.keycloak.expiresAt = Date.now() - 1;
    await store.updateOne(
      { _id: session._id },
      { $set: { session: JSON.stringify(data) } },
    );
    await agent.get('/me').expect(401);
  });

  it('caps unusually long ID token lifetimes at the existing session limit', async () => {
    await mappedUser();
    provider.settings.idTokenTtl = 60 * 86400;
    await login();
    const session = await mongoose.connection
      .collection('sessions')
      .findOne({ session: { $regex: '"passport"' } });
    if (!session) throw new Error('Missing authenticated session');
    const data = JSON.parse(session.session);
    expect(data.keycloak.expiresAt).toBeLessThanOrEqual(
      Date.now() + 30 * 86400000,
    );
  });

  it('requires same-origin POST logout and invalidates the stored session', async () => {
    await mappedUser();
    const { agent, result } = await login();
    const cookie = result.headers['set-cookie'][0].split(';')[0];
    await agent.get('/logout').expect(405);
    await agent
      .post('/logout')
      .set('Origin', 'https://evil.example')
      .expect(403);
    await agent.get('/me').expect(200);
    const logout = await agent
      .post('/logout')
      .set('Origin', config.FRONTEND_URL)
      .expect(303);
    const destination = new URL(logout.headers.location);
    expect(destination.origin).toBe(provider.issuer);
    expect(destination.searchParams.get('client_id')).toBe('hyperdx');
    expect(destination.searchParams.get('post_logout_redirect_uri')).toBe(
      'http://127.0.0.1:4500/login',
    );
    await request(app).get('/me').set('Cookie', cookie).expect(401);
  });

  it('blocks every password entry point and old password sessions in required mode', async () => {
    jest.replaceProperty(config, 'KEYCLOAK_REQUIRED', true);
    for (const path of [
      '/login/password',
      '/register/password',
      '/team/setup/invite',
    ]) {
      await request(app)
        .post(path)
        .send({
          email: 'local@example.com',
          password: 'TacoCat!2#4X',
          confirmPassword: 'TacoCat!2#4X',
        })
        .expect(403);
    }
    expect(await User.countDocuments()).toBe(0);
  });
});
