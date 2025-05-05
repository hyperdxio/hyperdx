import rateLimit, { Options } from 'express-rate-limit';

export default (config?: Partial<Options>) => async (req, rs, next) => {
  return rateLimit({
    ...config,
  })(req, rs, next);
};
