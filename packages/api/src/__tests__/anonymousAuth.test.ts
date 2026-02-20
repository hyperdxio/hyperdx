import express from 'express';
import request from 'supertest';

import * as config from '@/config';
import * as teamController from '@/controllers/team';
import { isUserAuthenticated } from '@/middleware/auth';
import rootRouter from '@/routers/api/root';

// Minimal Express app for testing middleware
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.get('/test', isUserAuthenticated, (req, res) => {
    res.json({ userId: req.user?._id, email: req.user?.email });
  });
  return app;
}

describe('Anonymous Auth Middleware', () => {
  const originalIsAnonymous = config.IS_ANONYMOUS_AUTH_ENABLED;
  const originalIsLocal = config.IS_LOCAL_APP_MODE;

  afterEach(() => {
    Object.defineProperty(config, 'IS_ANONYMOUS_AUTH_ENABLED', {
      value: originalIsAnonymous,
      writable: true,
    });
    Object.defineProperty(config, 'IS_LOCAL_APP_MODE', {
      value: originalIsLocal,
      writable: true,
    });
    jest.restoreAllMocks();
  });

  it('should inject anonymous user when provisioned', async () => {
    Object.defineProperty(config, 'IS_ANONYMOUS_AUTH_ENABLED', {
      value: true,
      writable: true,
    });
    Object.defineProperty(config, 'IS_LOCAL_APP_MODE', {
      value: false,
      writable: true,
    });

    const mockUser = {
      _id: 'anon-user-id',
      email: 'anonymous@hyperdx.io',
      team: 'anon-team-id',
    };
    jest
      .spyOn(teamController, 'getAnonymousUser')
      .mockReturnValue(mockUser as any);

    const app = createTestApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('anon-user-id');
    expect(res.body.email).toBe('anonymous@hyperdx.io');
  });

  it('should return 503 when anonymous user not yet provisioned', async () => {
    Object.defineProperty(config, 'IS_ANONYMOUS_AUTH_ENABLED', {
      value: true,
      writable: true,
    });
    Object.defineProperty(config, 'IS_LOCAL_APP_MODE', {
      value: false,
      writable: true,
    });

    jest.spyOn(teamController, 'getAnonymousUser').mockReturnValue(null);

    const app = createTestApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(503);
  });

  it('should return 401 when anonymous auth is disabled and not authenticated', async () => {
    Object.defineProperty(config, 'IS_ANONYMOUS_AUTH_ENABLED', {
      value: false,
      writable: true,
    });
    Object.defineProperty(config, 'IS_LOCAL_APP_MODE', {
      value: false,
      writable: true,
    });

    const app = createTestApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
  });
});

describe('Anonymous Auth Route Blocking', () => {
  const originalIsAnonymous = config.IS_ANONYMOUS_AUTH_ENABLED;

  afterEach(() => {
    Object.defineProperty(config, 'IS_ANONYMOUS_AUTH_ENABLED', {
      value: originalIsAnonymous,
      writable: true,
    });
  });

  it('should block login route in anonymous mode', async () => {
    Object.defineProperty(config, 'IS_ANONYMOUS_AUTH_ENABLED', {
      value: true,
      writable: true,
    });

    const app = express();
    app.use(express.json());
    app.use(rootRouter);

    const res = await request(app)
      .post('/login/password')
      .send({ email: 'test@test.com', password: 'test' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('authDisabled');
  });

  it('should block register route in anonymous mode', async () => {
    Object.defineProperty(config, 'IS_ANONYMOUS_AUTH_ENABLED', {
      value: true,
      writable: true,
    });

    const app = express();
    app.use(express.json());
    app.use(rootRouter);

    const res = await request(app)
      .post('/register/password')
      .send({
        email: 'test@test.com',
        password: 'TestPass!2#4X',
        confirmPassword: 'TestPass!2#4X',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('authDisabled');
  });
});
