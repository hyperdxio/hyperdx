import { createClient } from 'redis';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import logger from '@/utils/logger';

const client = createClient({
  url: config.REDIS_URL,
});

client.on('error', (err: any) => {
  logger.error('Redis error: ', serializeError(err));
});

class SimpleCache<T> {
  constructor(
    private readonly key: string,
    private readonly ttlInMs: number,
    private readonly fetcher: () => Promise<T>,
  ) {
    this.key = key;
    this.ttlInMs = ttlInMs;
  }

  async get(): Promise<T | null> {
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
    const result = await this.fetcher();
    await client.set(this.key, JSON.stringify(result), {
      PX: this.ttlInMs,
    });
    return result;
  }
}

export default client;

export { client as redisClient, SimpleCache };
