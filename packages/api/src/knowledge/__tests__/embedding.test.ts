import {
  embedText,
  incidentEmbeddingText,
} from '@/knowledge/incidents/embedding';

const mockEmbed = jest.fn();
const mockGetEmbeddingModel = jest.fn();
jest.mock('ai', () => ({ embed: (...a: unknown[]) => mockEmbed(...a) }));
jest.mock('@/controllers/ai', () => ({
  getEmbeddingModel: () => mockGetEmbeddingModel(),
}));

const model = { id: 'fake' };

describe('embedText', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null without a model and does not call embed', async () => {
    mockGetEmbeddingModel.mockReturnValue(null);
    expect(await embedText('db is slow')).toBeNull();
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it('returns null for blank text without calling the model', async () => {
    mockGetEmbeddingModel.mockReturnValue(model);
    expect(await embedText('  \n ')).toBeNull();
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it('returns the vector from the model', async () => {
    mockGetEmbeddingModel.mockReturnValue(model);
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2] });
    expect(await embedText('db is slow')).toEqual([0.1, 0.2]);
    expect(mockEmbed).toHaveBeenCalledWith({
      model,
      value: 'db is slow',
      maxRetries: 2,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('propagates provider errors to the caller', async () => {
    mockGetEmbeddingModel.mockReturnValue(model);
    mockEmbed.mockRejectedValue(new Error('rate limited'));
    await expect(embedText('x')).rejects.toThrow('rate limited');
  });
});

describe('incidentEmbeddingText', () => {
  it('joins title, summary, root cause and resolution with newlines', () => {
    const row = {
      title: 'T',
      summary: 'S',
      root_cause: 'R',
      resolution: 'X',
    };
    expect(incidentEmbeddingText(row)).toBe('T\nS\nR\nX');
  });
});
