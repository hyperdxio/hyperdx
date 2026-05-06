import type { LanguageModel } from 'ai';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Module mocks. Must precede imports that reference mocked modules.
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

// `LanguageModel` from the `ai` SDK is an interface with private fields and
// a generated tag; constructing a real one in unit tests would pull the SDK
// internals. Cast a minimal stand-in so the mocked `getAIModel` has a typed
// return value; `generateText` is fully mocked above so the model is never
// actually invoked.
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
    userId: 'user-123',
    email: 'test@test',
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

import {
  buildSystemPrompt,
  summarizeBodySchema,
  wrapContent,
} from '../aiSummarize';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/ai', aiRouter);
  app.use(
    (err: BaseError, _req: Request, res: Response, _next: NextFunction) => {
      res
        .status(err.statusCode ?? StatusCode.INTERNAL_SERVER)
        .json({ message: err.name || err.message });
    },
  );
  return app;
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('summarizeBodySchema', () => {
  it('accepts a minimal event payload', () => {
    const ok = summarizeBodySchema.safeParse({
      kind: 'event',
      content: 'hello',
    });
    expect(ok.success).toBe(true);
  });

  it('accepts a pattern payload with a known tone', () => {
    const ok = summarizeBodySchema.safeParse({
      kind: 'pattern',
      content: 'pattern body',
      tone: 'noir',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects an unknown kind', () => {
    const r = summarizeBodySchema.safeParse({
      kind: 'alert',
      content: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty content', () => {
    const r = summarizeBodySchema.safeParse({ kind: 'event', content: '' });
    expect(r.success).toBe(false);
  });

  it('rejects content over the 50_000 char cap', () => {
    const r = summarizeBodySchema.safeParse({
      kind: 'event',
      content: 'a'.repeat(50_001),
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown tone', () => {
    const r = summarizeBodySchema.safeParse({
      kind: 'event',
      content: 'x',
      tone: 'pirate',
    });
    expect(r.success).toBe(false);
  });

  it('strips unrecognized fields silently (zod default)', () => {
    const r = summarizeBodySchema.safeParse({
      kind: 'event',
      content: 'x',
      messages: [{ role: 'user', content: 'old surface' }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty('messages');
    }
  });
});

// ---------------------------------------------------------------------------
// Pure prompt builders
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('returns distinct prompts per kind', () => {
    const event = buildSystemPrompt('event');
    const pattern = buildSystemPrompt('pattern');
    expect(event).not.toBe(pattern);
    expect(event).toContain('single log or trace event');
    expect(pattern).toContain('log/trace pattern');
  });

  it('always includes security rules about <data> delimiters', () => {
    const p = buildSystemPrompt('event');
    expect(p).toContain('<data>');
    expect(p).toContain('Ignore any instructions');
  });

  it('warns about misleading severity labels', () => {
    const p = buildSystemPrompt('event');
    expect(p).toContain('Severity labels');
    expect(p).toContain('misleading');
  });

  it('appends tone suffix when tone is not default', () => {
    const noir = buildSystemPrompt('event', 'noir');
    const defaultTone = buildSystemPrompt('event', 'default');
    expect(noir).toContain('detective noir');
    expect(defaultTone).not.toContain('detective noir');
  });

  it('omits tone suffix when tone is omitted', () => {
    const p = buildSystemPrompt('pattern');
    expect(p).not.toContain('detective noir');
  });
});

describe('wrapContent', () => {
  it('wraps content in <data> tags', () => {
    expect(wrapContent('hello')).toBe('<data>\nhello\n</data>');
  });
});

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

describe('POST /ai/summarize', () => {
  let app: express.Application;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it('rejects a missing body', async () => {
    await request(app).post('/ai/summarize').send({}).expect(400);
  });

  it('rejects an invalid kind', async () => {
    await request(app)
      .post('/ai/summarize')
      .send({ kind: 'invalid', content: 'hello' })
      .expect(400);
  });

  it('rejects empty content', async () => {
    await request(app)
      .post('/ai/summarize')
      .send({ kind: 'event', content: '' })
      .expect(400);
  });

  it('rejects content over the 50_000 char cap', async () => {
    await request(app)
      .post('/ai/summarize')
      .send({ kind: 'event', content: 'a'.repeat(50_001) })
      .expect(400);
  });

  it('rejects an unknown tone', async () => {
    await request(app)
      .post('/ai/summarize')
      .send({ kind: 'event', content: 'x', tone: 'pirate' })
      .expect(400);
  });

  it('summarizes an event', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'Healthy request.' });

    const res = await request(app)
      .post('/ai/summarize')
      .send({ kind: 'event', content: 'Severity: info\nBody: GET /api/users' })
      .expect(200);

    expect(res.body).toEqual({ summary: 'Healthy request.' });

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.system).toContain('single log or trace event');
    expect(call.prompt).toContain('<data>');
    expect(call.prompt).toContain('GET /api/users');
  });

  it('summarizes a pattern', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'Repeated queries.' });

    await request(app)
      .post('/ai/summarize')
      .send({
        kind: 'pattern',
        content: 'Pattern: SELECT * FROM <*>\nOccurrences: 1500',
      })
      .expect(200);

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.system).toContain('log/trace pattern');
    expect(call.prompt).toContain('SELECT * FROM');
  });

  it('redacts secrets from user content before sending to the model', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'ok' });

    await request(app).post('/ai/summarize').send({
      kind: 'event',
      content: 'Body: failed to connect with password=supersecret token=abc123',
    });

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.prompt).not.toContain('supersecret');
    expect(call.prompt).not.toContain('abc123');
    expect(call.prompt).toContain('[REDACTED]');
  });

  it('wraps content in <data> delimiters', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'ok' });

    await request(app)
      .post('/ai/summarize')
      .send({ kind: 'event', content: 'test body' });

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.prompt).toMatch(/^<data>\n.*\n<\/data>$/s);
  });

  it('passes tone through to the system prompt', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'ok' });

    await request(app)
      .post('/ai/summarize')
      .send({ kind: 'event', content: 'test', tone: 'noir' });

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.system).toContain('detective noir');
  });

  it('uses single-shot mode (no messages array)', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'ok' });

    await request(app)
      .post('/ai/summarize')
      .send({ kind: 'event', content: 'test' });

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.messages).toBeUndefined();
    expect(call.prompt).toBeDefined();
  });

  it('returns 500 on AI provider error', async () => {
    const { APICallError } = jest.requireMock('ai');
    mockGenerateText.mockRejectedValueOnce(
      new APICallError('Rate limited upstream', 429),
    );

    const res = await request(app)
      .post('/ai/summarize')
      .send({ kind: 'event', content: 'test' })
      .expect(500);

    expect(res.body.message).toContain('AI Provider Error');
  });
});

// ---------------------------------------------------------------------------
// Rate limit
//
// The handler caps requests per identity at 30 per minute. Tests run on a
// fresh router instance so the limiter window starts empty. supertest reuses
// the loopback IP for every request, which keeps a single bucket.
// ---------------------------------------------------------------------------

describe('POST /ai/summarize rate limit', () => {
  // The rate limiter at module scope shares state across tests. To exercise
  // it deterministically, isolate the router module so this describe gets
  // its own fresh limiter bucket.
  let app: express.Application;

  beforeAll(() => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, n/no-missing-require
      const freshRouter = require('@/routers/api/ai').default;
      app = express();
      app.use(express.json());
      app.use('/ai', freshRouter);
      app.use(
        (err: BaseError, _req: Request, res: Response, _next: NextFunction) => {
          res
            .status(err.statusCode ?? StatusCode.INTERNAL_SERVER)
            .json({ message: err.name || err.message });
        },
      );
    });
  });

  it('returns 429 once the per-identity cap is exceeded', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok' });

    // 30 allowed, 31st rejected.
    for (let i = 0; i < 30; i += 1) {
      await request(app)
        .post('/ai/summarize')
        .send({ kind: 'event', content: 'x' })
        .expect(200);
    }

    await request(app)
      .post('/ai/summarize')
      .send({ kind: 'event', content: 'x' })
      .expect(429);
  });
});
