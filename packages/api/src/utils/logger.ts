import {
  getPinoMixinFunction,
  getPinoTransport,
} from '@hyperdx/node-opentelemetry';
import type { Request, Response } from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';

import * as config from '@/config';

const MAX_LEVEL = config.HYPERDX_LOG_LEVEL ?? 'debug';

const hyperdxTransport = config.HYPERDX_API_KEY
  ? getPinoTransport(MAX_LEVEL, {
      detectResources: true,
    })
  : null;

// Configure transport based on environment and whether HyperDX is enabled
const getTransport = () => {
  const targets: any[] = [];

  // Add HyperDX transport if API key is configured
  if (hyperdxTransport) {
    targets.push(hyperdxTransport);
  }

  if (config.IS_DEV) {
    // In development, use pino-pretty for nice console output
    targets.push({
      target: 'pino-pretty',
      level: MAX_LEVEL,
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname,trace_id,span_id,trace_flags',
      },
    });
  } else {
    targets.push({
      target: 'pino/file',
      level: MAX_LEVEL,
      options: { destination: 1 }, // this writes to STDOUT
    });
  }

  // If only one target, return it directly; otherwise return multi-transport
  if (targets.length === 0) {
    return undefined;
  } else if (targets.length === 1) {
    return targets[0];
  } else {
    return { targets };
  }
};

const logger = pino({
  level: MAX_LEVEL,
  transport: getTransport(),
  mixin: getPinoMixinFunction,
});

export const expressLogger = pinoHttp({
  logger,
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    }
    return 'info';
  },
  customSuccessMessage: (req: Request, res: Response) => {
    return `HTTP ${req.method} ${req.originalUrl}`;
  },
  customErrorMessage: (req: Request, res: Response, err) => {
    return `HTTP ${req.method} ${req.originalUrl}`;
  },
  // enable this to debug request and response data
  serializers: {
    req: () => undefined,
    res: () => undefined,
  },
});

export default logger;
