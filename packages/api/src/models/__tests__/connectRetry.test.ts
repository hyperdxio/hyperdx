import mongoose from 'mongoose';

// --- mocks (hoisted; names must be prefixed with `mock`) ---
const mockCounterAdd = jest.fn();
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockConfig: { MONGO_URI: string | undefined } = {
  MONGO_URI: 'mongodb://localhost:27017/hyperdx-test',
};

jest.mock('@/config', () => mockConfig);
jest.mock('@/utils/instrumentation', () => ({
  getCounter: () => ({ add: (...args: unknown[]) => mockCounterAdd(...args) }),
}));
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: mockLogger,
}));

import { connectDBWithRetry } from '@/models';

describe('connectDBWithRetry', () => {
  let connectSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.MONGO_URI = 'mongodb://localhost:27017/hyperdx-test';
    connectSpy = jest.spyOn(mongoose, 'connect');
  });

  afterEach(() => {
    connectSpy.mockRestore();
  });

  // Tiny delays so retry tests run in milliseconds with real timers.
  const fastRetry = { baseDelayMs: 1, maxDelayMs: 2 };

  it('connects on the first attempt without retrying', async () => {
    connectSpy.mockResolvedValueOnce(mongoose);

    await connectDBWithRetry();

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(mockCounterAdd).not.toHaveBeenCalled();
  });

  it('retries a failed initial connect until it succeeds', async () => {
    connectSpy
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(mongoose);

    await connectDBWithRetry(undefined, fastRetry);

    expect(connectSpy).toHaveBeenCalledTimes(3);
    expect(mockCounterAdd).toHaveBeenCalledTimes(2);
    expect(mockCounterAdd).toHaveBeenCalledWith(1, {
      event: 'initial_connect_retry',
    });
    // Recovery after retries is worth an affirmative log line.
    expect(mockLogger.info).toHaveBeenCalledWith(
      { attempt: 3 },
      expect.stringContaining('after retrying'),
    );
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    connectSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      connectDBWithRetry(undefined, { ...fastRetry, maxAttempts: 3 }),
    ).rejects.toThrow('ECONNREFUSED');

    expect(connectSpy).toHaveBeenCalledTimes(3);
    // The final attempt throws rather than counting another retry.
    expect(mockCounterAdd).toHaveBeenCalledTimes(2);
  });

  it('does not retry when MONGO_URI is unset (config error)', async () => {
    mockConfig.MONGO_URI = undefined;

    await expect(connectDBWithRetry(undefined, fastRetry)).rejects.toThrow(
      'MONGO_URI is not set',
    );

    expect(connectSpy).not.toHaveBeenCalled();
    expect(mockCounterAdd).not.toHaveBeenCalled();
  });
});
