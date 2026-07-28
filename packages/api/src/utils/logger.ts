import {
  getPinoMixinFunction,
  getPinoTransport,
} from '@hyperdx/node-opentelemetry';
import type { Request, Response } from 'express';
import type { IncomingMessage } from 'http';
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

  if (config.IS_DEV || config.IS_CI) {
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

// pino-http's default request serializer copies `req.headers` verbatim, and
// in production the serializers below are left enabled, so without this the
// Authorization bearer and session cookie are written to stdout and shipped
// off-box via the HyperDX transport.
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  // A redirect can carry a token in its target.
  'res.headers.location',
];

// `redact` addresses object paths, so it cannot reach a credential embedded in
// a URL string. These two routes each take a standalone bearer token as a path
// segment, which pino-http emits via `req.url` and which the custom message
// builders interpolate into `msg`.
const TOKEN_PATH_RE = /\/(ext\/silence-alert|team\/setup)\/[^/?#]+/g;

export const scrubUrlTokens = (url: string): string =>
  url.replace(TOKEN_PATH_RE, '/$1/[REDACTED]');

const logger = pino({
  level: MAX_LEVEL,
  transport: getTransport(),
  mixin: getPinoMixinFunction,
  redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
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
    return `HTTP ${req.method} ${scrubUrlTokens(req.originalUrl)}`;
  },
  customErrorMessage: (req: Request, res: Response, err) => {
    return `HTTP ${req.method} ${scrubUrlTokens(req.originalUrl)}`;
  },
  customProps: (req: Request, res: Response) => {
    const user = req.user;
    if (user) {
      return {
        userId: user._id?.toString(),
        userEmail: user.email,
      };
    }
    return {};
  },
  // Only disable req/res serializers in development/CI
  ...(config.IS_DEV || config.IS_CI
    ? {
        serializers: {
          req: () => undefined,
          res: () => undefined,
        },
      }
    : {
        serializers: {
          // Wraps the default rather than replacing it, so header redaction
          // and every other standard field are preserved — only the URL is
          // scrubbed.
          req: (req: IncomingMessage) => {
            const serialised = pino.stdSerializers.req(req);
            return { ...serialised, url: scrubUrlTokens(serialised.url) };
          },
        },
      }),
});

export default logger;
