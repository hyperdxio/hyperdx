import rateLimit, { Options } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

import redisClient from './redis';

export default (config?: Partial<Options>) => async (req, rs, next) => {
  return rateLimit({
    ...config,
    // Redis store configuration
    store: new RedisStore({
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
    }),
  })(req, rs, next);
};
