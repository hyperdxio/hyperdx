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

// Use a stable mock user id for rate-limit test setup/teardown
const MOCK_USER_ID = 'user-123';
jest.mock('@/middleware/auth', () => ({
  getNonNullUserWithTeam: jest.fn().mockReturnValue({
    teamId: 'team-123',
    userId: MOCK_USER_ID,
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

import { buildSystemPrompt, redactSecrets, wrapContent } from '../aiSummarize';

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
// Pure function tests
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('returns distinct prompts per kind', () => {
    const event = buildSystemPrompt('event');
    const pattern = buildSystemPrompt('pattern');
    const alert = buildSystemPrompt('alert');
    expect(event).not.toBe(pattern);
    expect(pattern).not.toBe(alert);
    expect(event).toContain('single log or trace event');
    expect(pattern).toContain('log/trace pattern');
    expect(alert).toContain('firing alert');
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
});

describe('wrapContent', () => {
  it('wraps content in <data> tags', () => {
    expect(wrapContent('hello')).toBe('<data>\nhello\n</data>');
  });
});

describe('redactSecrets', () => {
  it('redacts password= values', () => {
    expect(redactSecrets('conn: password=secret123')).toBe(
      'conn: password=[REDACTED]',
    );
  });

  it('redacts various secret-ish keys', () => {
    expect(redactSecrets('api_key=abc123 token=xyz')).toContain(
      'api_key=[REDACTED]',
    );
    expect(redactSecrets('api_key=abc123 token=xyz')).toContain(
      'token=[REDACTED]',
    );
  });

  it('redacts Bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer eyJhbG.xyz.abc')).toContain(
      'Bearer [REDACTED]',
    );
  });

  it('redacts JWT-shaped strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoxfQ.abcdef';
    expect(redactSecrets(`token: ${jwt}`)).toContain('[REDACTED_JWT]');
  });

  it('leaves non-secret text alone', () => {
    expect(redactSecrets('error: database timeout after 30s')).toBe(
      'error: database timeout after 30s',
    );
  });

  it('redacts JSON-shape secrets (quoted key/value)', () => {
    const input = '{"password":"s3cret","user":"alice"}';
    const out = redactSecrets(input);
    expect(out).not.toContain('s3cret');
    expect(out).toContain('"password":"[REDACTED]"');
    expect(out).toContain('"user":"alice"');
  });

  it('redacts JSON-shape with whitespace', () => {
    const input = '{ "api_key" : "abc123" }';
    const out = redactSecrets(input);
    expect(out).not.toContain('abc123');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts HTTP-style secret headers', () => {
    expect(redactSecrets('X-Api-Key: abc123')).toContain(
      'X-Api-Key: [REDACTED]',
    );
    expect(redactSecrets('X-Auth-Token: xyz')).toContain(
      'X-Auth-Token: [REDACTED]',
    );
  });
});

// ---------------------------------------------------------------------------
// HTTP integration tests
// ---------------------------------------------------------------------------

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

  it('rejects invalid kind value', async () => {
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

  it('returns summary for event kind', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Healthy request.',
    });

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

  it('returns summary for pattern kind', async () => {
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

  it('returns summary for alert kind', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'Alert is a flake.' });

    await request(app)
      .post('/ai/summarize')
      .send({
        kind: 'alert',
        content: 'Alert: p99 latency > 500ms, current: 520ms',
      })
      .expect(200);

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.system).toContain('firing alert');
  });

  it('redacts secrets from user content before sending to LLM', async () => {
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

  it('uses messages array when conversation history is provided', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: 'follow-up reply' });

    await request(app)
      .post('/ai/summarize')
      .send({
        kind: 'event',
        content: 'new follow-up question',
        messages: [
          { role: 'user', content: 'original question' },
          { role: 'assistant', content: 'original answer' },
        ],
      });

    const call = mockGenerateText.mock.calls[0][0];
    expect(call.messages).toBeDefined();
    expect(call.prompt).toBeUndefined();
    expect(call.messages).toHaveLength(3);
    expect(call.messages[0].role).toBe('user');
    expect(call.messages[1].role).toBe('assistant');
    expect(call.messages[2].content).toContain('<data>');
  });

  it('returns 500 on AI provider error', async () => {
    const { APICallError } = jest.requireMock('ai');
    mockGenerateText.mockRejectedValueOnce(
      new APICallError('Rate limited', 429),
    );

    const res = await request(app)
      .post('/ai/summarize')
      .send({ kind: 'event', content: 'test' })
      .expect(500);

    expect(res.body.message).toContain('AI Provider Error');
  });
});
