import { getWinstonTransport } from '@hyperdx/node-opentelemetry';
import expressWinston from 'express-winston';
import winston, { addColors } from 'winston';

import {
  APP_TYPE,
  HYPERDX_API_KEY,
  HYPERDX_LOG_LEVEL,
  IS_PROD,
} from '@/config';

// LOCAL DEV ONLY
addColors({
  error: 'bold red',
  warn: 'bold yellow',
  info: 'white',
  http: 'gray',
  verbose: 'bold magenta',
  debug: 'green',
  silly: 'cyan',
});

const MAX_LEVEL = HYPERDX_LOG_LEVEL ?? 'debug';
const DEFAULT_FORMAT = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const hyperdxTransport = HYPERDX_API_KEY
  ? getWinstonTransport(MAX_LEVEL, {
      bufferSize: APP_TYPE === 'scheduled-task' ? 1 : 100,
    })
  : null;

export const expressLogger = expressWinston.logger({
  level: MAX_LEVEL,
  format: DEFAULT_FORMAT,
  msg: IS_PROD
    ? undefined
    : 'HTTP {{res.statusCode}} {{req.method}} {{req.url}} {{res.responseTime}}ms',
  transports: [
    new winston.transports.Console(),
    ...(hyperdxTransport ? [hyperdxTransport] : []),
  ],
  meta: IS_PROD,
});

const logger = winston.createLogger({
  level: MAX_LEVEL,
  format: DEFAULT_FORMAT,
  transports: [
    new winston.transports.Console(),
    ...(hyperdxTransport ? [hyperdxTransport] : []),
  ],
});

export default logger;
