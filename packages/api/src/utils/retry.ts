import { serializeError } from 'serialize-error';

import logger from './logger';

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitter?: boolean;
  retryOnlyOnStatus?: number[];
}

/**
 * Executes a promise-returning function with exponential backoff and retries.
 * Automatically skips retries for redirects and 4xx client errors (excluding
 * 429 Too Many Requests).
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffFactor = 2,
    jitter = true,
  } = options;

  let attempt = 0;
  let currentDelay = initialDelayMs;

  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;

      if (attempt >= maxRetries) {
        throw error;
      }

      // Extract HTTP status statusCode first to handle slack webhook errors.
      const status =
        error?.statusCode ??
        error?.status ??
        error?.response?.status ??
        error?.original?.response?.status ??
        error?.original?.status ??
        error?.code;
      const isStatusNumber = typeof status === 'number';

      // A redirect response is deterministic and retrying would re-send the
      // request body to the same endpoint without changing the outcome.
      if (isStatusNumber && status >= 300 && status < 400) {
        throw error;
      }

      if (options.retryOnlyOnStatus && options.retryOnlyOnStatus.length > 0) {
        // If an explicit whitelist of retryable statuses is provided, ONLY retry those.
        if (!isStatusNumber || !options.retryOnlyOnStatus.includes(status)) {
          throw error;
        }
      } else {
        // Default behavior: Do not retry 4xx errors (except 429 Too Many Requests)
        if (isStatusNumber && status >= 400 && status < 500 && status !== 429) {
          throw error;
        }
      }

      const jitterMs = jitter ? Math.random() * 500 : 0;
      const delay = Math.min(currentDelay + jitterMs, maxDelayMs);

      logger.warn(
        {
          error: serializeError(error),
          attempt,
          maxRetries,
          delayMs: delay,
        },
        'Retry attempt failed, retrying...',
      );

      await new Promise(resolve => setTimeout(resolve, delay));
      currentDelay *= backoffFactor;
    }
  }

  throw new Error('Unreachable');
};
