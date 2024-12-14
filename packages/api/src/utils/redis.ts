import { createClient } from 'redis';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import logger from '@/utils/logger';

const client = config.REDIS_URL
  ? createClient({
      url: config.REDIS_URL,
    })
  : null;

// check if client is initialized
if (client == null) {
  logger.warn('Redis client is not initialized');
  // IMPLEMENT: use local in-memory cache
}

client?.on('error', (err: any) => {
  logger.error('Redis error: ', serializeError(err));
});

// TODO: add tests
class SimpleCache<T> {
  constructor(
    private readonly key: string,
    private readonly ttlInMs: number,
    private readonly fetcher: () => Promise<T>,
    private readonly shouldRefreshOnResult: (result: T) => boolean = () => true,
  ) {}

  async refresh() {
    if (client == null) {
      throw new Error('Redis client is not initialized');
    }
    const dt = Date.now();
    const result = await this.fetcher();
    if (this.shouldRefreshOnResult(result)) {
      logger.info({
        message: 'SimpleCache: refresh',
        key: this.key,
        duration: Date.now() - dt,
      });
      await client.set(this.key, JSON.stringify(result), {
        PX: this.ttlInMs,
      });
    }
    return result;
  }

  async get(): Promise<T> {
    if (client == null) {
      throw new Error('Redis client is not initialized');
    }
    const cached = await client.get(this.key);
    if (cached != null) {
      logger.info({
        message: 'SimpleCache: cache hit',
        key: this.key,
      });
      return JSON.parse(cached);
    }
    logger.info({
      message: 'SimpleCache: cache miss',
      key: this.key,
    });
    const result = await this.refresh();
    return result;
  }
}

export default client;

export { client as redisClient, SimpleCache };
