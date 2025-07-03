import cookieParser from 'cookie-parser';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

import { csrfProtection, csrfToken } from '../csrf';

describe('CSRF middleware', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(
      session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false },
      }),
    );
    app.use(csrfToken);
    app.use(csrfProtection);

    // Test routes
    app.get('/test', (req, res) => {
      res.json({
        message: 'GET request successful',
        sessionId: req.session?.id,
        hasSession: !!req.session,
      });
    });

    app.post('/test', (req, res) => {
      res.json({
        message: 'POST request successful',
        sessionId: req.session?.id,
        hasSession: !!req.session,
      });
    });
  });

  it('should allow GET requests without CSRF token', async () => {
    const response = await request(app).get('/test').expect(200);
    expect(response.body.message).toBe('GET request successful');
  });

  it('should provide CSRF token in response header on GET requests', async () => {
    const response = await request(app).get('/test').expect(200);
    expect(response.headers['x-csrf-token']).toBeDefined();
    expect(typeof response.headers['x-csrf-token']).toBe('string');
  });

  it('should reject POST requests without CSRF token', async () => {
    await request(app).post('/test').send({ data: 'test' }).expect(403);
  });

  it('should accept POST requests with valid CSRF token', async () => {
    // Use the same agent for both requests to maintain session
    const agent = request.agent(app);

    // First get CSRF token (this also establishes the session and sets cookie)
    const getResponse = await agent.get('/test').expect(200);
    const csrfToken = getResponse.headers['x-csrf-token'];

    expect(csrfToken).toBeDefined();
    expect(typeof csrfToken).toBe('string');

    // The agent should automatically include cookies from the first request
    // Make POST request with the same agent and token
    await agent
      .post('/test')
      .set('x-csrf-token', csrfToken)
      .send({ data: 'test' })
      .expect(200);
  });

  it('should reject POST requests with invalid CSRF token', async () => {
    await request(app)
      .post('/test')
      .set('x-csrf-token', 'invalid-token')
      .send({ data: 'test' })
      .expect(403);
  });
});
