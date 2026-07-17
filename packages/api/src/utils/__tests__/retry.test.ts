import { withRetry } from '@/utils/retry';

describe('withRetry', () => {
  it('should return successfully if function succeeds on first try', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValueOnce('success');

    const result = await withRetry(fn, { initialDelayMs: 10, jitter: false });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after reaching maxRetries', async () => {
    const error = new Error('persistent fail');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, { maxRetries: 3, initialDelayMs: 10, jitter: false }),
    ).rejects.toThrow('persistent fail');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should not retry on 4xx client errors except 429', async () => {
    const error400 = new Error('bad request') as any;
    error400.status = 400;

    const fn400 = jest.fn().mockRejectedValue(error400);

    await expect(
      withRetry(fn400, { initialDelayMs: 10, jitter: false }),
    ).rejects.toThrow('bad request');
    expect(fn400).toHaveBeenCalledTimes(1); // aborted early
  });

  it('should not retry on 3xx redirect responses', async () => {
    const redirectError = new Error('redirect') as any;
    redirectError.status = 302;

    const fn = jest.fn().mockRejectedValue(redirectError);

    await expect(
      withRetry(fn, { initialDelayMs: 10, jitter: false }),
    ).rejects.toThrow('redirect');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on 429 Too Many Requests', async () => {
    const error429 = new Error('rate limited') as any;
    error429.status = 429;

    const fn429 = jest
      .fn()
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce('success');

    const result = await withRetry(fn429, {
      initialDelayMs: 10,
      jitter: false,
    });
    expect(result).toBe('success');
    expect(fn429).toHaveBeenCalledTimes(2);
  });

  it('should retry on 5xx server errors', async () => {
    const error500 = new Error('internal server error') as any;
    error500.status = 500;

    const fn500 = jest
      .fn()
      .mockRejectedValueOnce(error500)
      .mockResolvedValueOnce('success');

    const result = await withRetry(fn500, {
      initialDelayMs: 10,
      jitter: false,
    });
    expect(result).toBe('success');
    expect(fn500).toHaveBeenCalledTimes(2);
  });

  it('should strictly obey retryOnlyOnStatus if provided', async () => {
    const error500 = new Error('internal server error') as any;
    error500.status = 500;

    const error429 = new Error('rate limited') as any;
    error429.status = 429;

    const fn = jest
      .fn()
      .mockRejectedValueOnce(error500) // Should throw immediately since not in retryOnlyOnStatus
      .mockResolvedValueOnce('success');

    await expect(
      withRetry(fn, {
        initialDelayMs: 10,
        jitter: false,
        retryOnlyOnStatus: [429], // Only retry 429s
      }),
    ).rejects.toThrow('internal server error');
    expect(fn).toHaveBeenCalledTimes(1);

    const fn2 = jest
      .fn()
      .mockRejectedValueOnce(error429) // Should retry
      .mockResolvedValueOnce('success2');

    const result = await withRetry(fn2, {
      initialDelayMs: 10,
      jitter: false,
      retryOnlyOnStatus: [429],
    });
    expect(result).toBe('success2');
    expect(fn2).toHaveBeenCalledTimes(2);
  });
});
