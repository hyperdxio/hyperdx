import _ from 'lodash';
import expressWinston from 'express-winston';
import winston, { addColors } from 'winston';
import { getWinsonTransport } from '@hyperdx/node-opentelemetry';

import {
  APP_TYPE,
  HYPERDX_API_KEY,
  HYPERDX_INGESTOR_ENDPOINT,
  IS_DEV,
  IS_PROD,
} from '../config';

import type { IUser } from '../models/user';

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

const MAX_LEVEL = IS_PROD ? 'debug' : 'debug';
const DEFAULT_FORMAT = IS_DEV
  ? winston.format.combine(
      winston.format.errors({ stack: true }),
      winston.format.colorize({ all: true }),
      winston.format.timestamp({ format: 'MM/DD/YY HH:MM:SS' }),
      winston.format.printf(
        info => `[${info.level}] ${info.timestamp} ${info.message}`,
      ),
    )
  : winston.format.combine(
      winston.format.errors({ stack: true }),
      winston.format.json(),
    );

const hyperdxTransport = HYPERDX_API_KEY
  ? getWinsonTransport(MAX_LEVEL, {
      bufferSize: APP_TYPE === 'scheduled-task' ? 1 : 100,
      ...(HYPERDX_INGESTOR_ENDPOINT && { baseUrl: HYPERDX_INGESTOR_ENDPOINT }),
    })
  : null;

export const expressLogger = expressWinston.logger({
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
