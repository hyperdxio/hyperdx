import { getLoggedInAgent, getServer } from '@/fixtures';

const mockGenerateText = jest.fn();
const mockGetAIModel = jest.fn(() => ({ modelId: 'test-model' }));

jest.mock('ai', () => {
  const real = jest.requireActual('ai');
  return {
    ...real,
    generateText: (...args: unknown[]) =>
      mockGenerateText(...(args as [unknown])),
  };
});

jest.mock('@/controllers/ai', () => {
  const real = jest.requireActual('@/controllers/ai');
  return {
    ...real,
    getAIModel: () => mockGetAIModel(),
  };
});

describe('ai router summarize', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('POST /ai/summarize returns summary text for valid event payload', async () => {
    const { agent } = await getLoggedInAgent(server);
    mockGenerateText.mockResolvedValueOnce({
      text: 'Summary output',
    });

    const response = await agent
      .post('/ai/summarize')
      .send({
        kind: 'event',
        context: {
          title: 'Failed request',
          body: 'timeout while calling payment provider',
          severity: 'error',
          attributes: [{ key: 'http.status_code', value: '504' }],
        },
      })
      .expect(200);

    expect(response.body).toMatchObject({
      summary: 'Summary output',
      kind: 'event',
      tone: 'default',
    });
    expect(mockGetAIModel).toHaveBeenCalledTimes(1);
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it('POST /ai/summarize rejects oversize payloads via validation', async () => {
    const { agent } = await getLoggedInAgent(server);

    await agent
      .post('/ai/summarize')
      .send({
        kind: 'pattern',
        context: {
          pattern: 'x'.repeat(3000),
          count: 100,
        },
      })
      .expect(400);

    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('POST /ai/summarize fails fast when AI is not configured', async () => {
    const { agent } = await getLoggedInAgent(server);
    mockGetAIModel.mockImplementationOnce(() => {
      throw new Error(
        'No AI provider configured. Set AI_PROVIDER and AI_API_KEY environment variables.',
      );
    });

    const response = await agent
      .post('/ai/summarize')
      .send({
        kind: 'event',
        context: {
          title: 'Failed request',
          body: 'timeout while calling payment provider',
          severity: 'error',
        },
      })
      .expect(400);

    expect(response.body.message).toContain('AI summary is not enabled');
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(mockGetAIModel).toHaveBeenCalledTimes(1);
  });
});
