import express from 'express';
import request from 'supertest';

import rateLimiter, { rateLimiterKeyGenerator } from '@/utils/rateLimiter';

describe('rateLimiterKeyGenerator', () => {
  const buildApp = () => {
    const app = express();
    app.use(
      rateLimiter({
        windowMs: 60 * 1000,
        max: 2,
        keyGenerator: rateLimiterKeyGenerator,
      }),
      (_req: express.Request, res: express.Response) => res.sendStatus(200),
    );
    return app;
  };

  const get = (app: express.Application, authorization: string) =>
    request(app).get('/').set('Authorization', authorization);

  it('counts one access key against one bucket whatever precedes Bearer', async () => {
    const app = buildApp();

    expect((await get(app, 'Bearer key-a')).status).toBe(200);
    expect((await get(app, 'Bearer key-a')).status).toBe(200);
    expect((await get(app, 'xBearer key-a')).status).toBe(429);
  });

  it('gives each access key its own bucket', async () => {
    const app = buildApp();

    expect((await get(app, 'Bearer key-a')).status).toBe(200);
    expect((await get(app, 'Bearer key-a')).status).toBe(200);
    expect((await get(app, 'Bearer key-b')).status).toBe(200);
  });

  it('falls back to the request IP when the header carries no access key', async () => {
    const app = buildApp();

    expect((await get(app, 'Basic dXNlcjph')).status).toBe(200);
    expect((await get(app, 'Basic dXNlcjpi')).status).toBe(200);
    expect((await get(app, 'Basic dXNlcjpj')).status).toBe(429);
  });
});
