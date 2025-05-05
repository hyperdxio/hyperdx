import rateLimit, { Options } from 'express-rate-limit';

export default (config?: Partial<Options>) => {
  return rateLimit({
    ...config,
  });
};
