import express from 'express';
import request from 'supertest';

import mcpRouter from '@/mcp/app';
import { createServer } from '@/mcp/mcpServer';

jest.mock('@/middleware/auth', () => ({
  getAccessKeyFromRequest: () => undefined,
  validateUserAccessKey: (req: any, _res: any, next: any) => {
    req.user = { _id: 'user1', team: 'team1' };
    next();
  },
}));
const mockFindById = jest.fn();
jest.mock('@/models/team', () => ({
  __esModule: true,
  default: { findById: (...a: unknown[]) => mockFindById(...a) },
}));
jest.mock('@/mcp/mcpServer', () => ({
  createServer: jest.fn(() => ({
    connect: jest.fn(),
    close: jest.fn(),
  })),
}));

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

describe('mcp app knowledge graph flag', () => {
  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpRouter);

  it.each([
    [{ isKnowledgeGraphEnabled: true }, true],
    [{ isKnowledgeGraphEnabled: false }, false],
    [{}, false],
    [null, false],
  ])('team %j gives context flag %s', async (team, expected) => {
    mockFindById.mockReturnValue({
      select: jest.fn().mockResolvedValue(team),
    });
    await request(app).post('/mcp').send({});
    expect(createServer).toHaveBeenLastCalledWith(
      expect.objectContaining({ isKnowledgeGraphEnabled: expected }),
    );
  });

  it('falls back to false and still responds when the lookup rejects', async () => {
    mockFindById.mockReturnValue({
      select: jest.fn().mockRejectedValue(new Error('mongo down')),
    });
    await request(app).post('/mcp').send({});
    expect(createServer).toHaveBeenLastCalledWith(
      expect.objectContaining({ isKnowledgeGraphEnabled: false }),
    );
  });
});
