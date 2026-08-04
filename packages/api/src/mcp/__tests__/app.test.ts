import express from 'express';
import request from 'supertest';

import mcpRouter from '@/mcp/app';

// The MCP transport is stateless, so GET (standalone SSE stream) and DELETE
// (session termination) are not offered and must return 405 so spec-compliant
// SDK clients continue connecting rather than aborting. See issue #2686.
describe('mcp app transport methods', () => {
  const app = express();
  app.use('/mcp', mcpRouter);

  it('returns 405 with Allow: POST for GET', async () => {
    const res = await request(app).get('/mcp');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });

  it('returns 405 with Allow: POST for DELETE', async () => {
    const res = await request(app).delete('/mcp');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});
