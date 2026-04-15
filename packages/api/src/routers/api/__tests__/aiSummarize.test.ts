import type { LanguageModel } from 'ai';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mock setup — must precede imports that reference mocked modules
// ---------------------------------------------------------------------------

const mockGenerateText = jest.fn();

jest.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  APICallError: class extends Error {
    statusCode: number;
    constructor(msg: string, statusCode: number) {
      super(msg);
      this.name = 'APICallError';
      this.statusCode = statusCode;
    }
  },
  Output: { object: jest.fn() },
}));

const mockModel = { modelId: 'test-model' } as unknown as LanguageModel;

jest.mock('@/controllers/ai', () => ({
  getAIModel: () => mockModel,
  getAIMetadata: jest.fn(),
  getChartConfigFromResolvedConfig: jest.fn(),
}));

jest.mock('@/controllers/sources', () => ({
  getSource: jest.fn(),
}));

jest.mock('@/middleware/auth', () => ({
  getNonNullUserWithTeam: jest.fn().mockReturnValue({
    teamId: 'team-123',
  }),
}));

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/utils/zod', () => ({
  objectIdSchema: {
    _def: { typeName: 'ZodString' },
    parse: (v: string) => v,
  },
}));

// ---------------------------------------------------------------------------

import aiRouter from '@/routers/api/ai';
import { BaseError, StatusCode } from '@/utils/errors';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/ai', aiRouter);
  // Minimal error handler matching the app's pattern
  app.use(
    (err: BaseError, _req: Request, res: Response, _next: NextFunction) => {
      res
        .status(err.statusCode ?? StatusCode.INTERNAL_SERVER)
        .json({ message: err.name || err.message });
    },
  );
  return app;
}

describe('POST /ai/summarize', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it('rejects missing required fields', async () => {
    await request(app).post('/ai/summarize').send({}).expect(400);
  });

  it('rejects invalid type value', async () => {
    await request(app)
      .post('/ai/summarize')
      .send({ type: 'invalid', content: 'hello' })
      .expect(400);
  });

  it('rejects empty content', async () => {
    await request(app)
      .post('/ai/summarize')
      .send({ type: 'event', content: '' })
      .expect(400);
  });

  it('returns summary for event type', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'This event represents a healthy HTTP GET request.',
    });

    const res = await request(app)
      .post('/ai/summarize')
      .send({ type: 'event', content: 'Severity: info\nBody: GET /api/users' })
      .expect(200);

    expect(res.body).toEqual({
      summary: 'This event represents a healthy HTTP GET request.',
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const call = mockGenerateText.mock.calls[0][0];
    expect(call.model).toBe(mockModel);
    expect(call.system).toContain('single log or trace event');
    expect(call.prompt).toContain('GET /api/users');
  });

  it('returns summary for pattern type', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'This pattern shows repeated database queries.',
    });

    const res = await request(app)
      .post('/ai/summarize')
      .send({
        type: 'pattern',
        content: 'Pattern: SELECT * FROM <*>\nOccurrences: 1500',
      })
      .expect(200);

    expect(res.body).toEqual({
      summary: 'This pattern shows repeated database queries.',
    });

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.system).toContain('log/trace pattern');
    expect(call.prompt).toContain('SELECT * FROM <*>');
  });

  it('uses different system prompts for event vs pattern', async () => {
    mockGenerateText.mockResolvedValue({ text: 'summary' });

    await request(app)
      .post('/ai/summarize')
      .send({ type: 'event', content: 'test event' });

    await request(app)
      .post('/ai/summarize')
      .send({ type: 'pattern', content: 'test pattern' });

    const eventSystem = mockGenerateText.mock.calls[0][0].system;
    const patternSystem = mockGenerateText.mock.calls[1][0].system;

    expect(eventSystem).not.toBe(patternSystem);
    expect(eventSystem).toContain('single log or trace event');
    expect(patternSystem).toContain('log/trace pattern');
  });

  it('returns 500 on AI provider error', async () => {
    const { APICallError } = jest.requireMock('ai');
    mockGenerateText.mockRejectedValueOnce(
      new APICallError('Rate limited', 429),
    );

    const res = await request(app)
      .post('/ai/summarize')
      .send({ type: 'event', content: 'test' })
      .expect(500);

    expect(res.body.message).toContain('AI Provider Error');
  });
});
