import express from 'express';
import request from 'supertest';

import mcpRouter, { buildAllowedHosts } from '@/mcp/app';

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

describe('buildAllowedHosts', () => {
  it('always includes the localhost defaults', () => {
    expect(buildAllowedHosts([])).toEqual(['localhost', '127.0.0.1', '[::1]']);
  });

  it('adds the bare hostname of a configured URL (drops path and port)', () => {
    const hosts = buildAllowedHosts([
      'https://78fc-1-2-3.ngrok-free.app/mcp',
      'http://localhost:30287',
    ]);
    expect(hosts).toContain('78fc-1-2-3.ngrok-free.app');
    expect(hosts).toContain('localhost');
    // No port, no path leaked into the allowlist.
    expect(hosts).not.toContain('localhost:30287');
  });

  it('adds bare hostnames from the extra-hosts list', () => {
    // The MCP endpoint is mounted on the API app, so a deployment serving the
    // API on its own hostname has to be able to name it.
    const hosts = buildAllowedHosts(
      ['https://app.example.com'],
      'api.example.com, mcp.example.com',
    );
    expect(hosts).toContain('api.example.com');
    expect(hosts).toContain('mcp.example.com');
    expect(hosts).toContain('app.example.com');
  });

  it('ignores undefined and malformed URLs rather than throwing', () => {
    expect(() => buildAllowedHosts([undefined, 'not a url', ''])).not.toThrow();
    expect(buildAllowedHosts([undefined, 'not a url'])).toEqual([
      'localhost',
      '127.0.0.1',
      '[::1]',
    ]);
  });
});
