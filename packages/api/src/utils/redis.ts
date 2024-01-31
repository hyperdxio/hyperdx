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

// TODO: add tests
class SimpleCache<T> {
  constructor(
    private readonly key: string,
    private readonly ttlInMs: number,
    private readonly fetcher: () => Promise<T>,
    private readonly shouldRefreshOnResult: (result: T) => boolean = () => true,
  ) {}

  async refresh() {
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
