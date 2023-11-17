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

export default client;
