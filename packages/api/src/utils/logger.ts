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

// pino-http wraps a user-supplied `req` serializer with
// `wrapRequestSerializer` (its `wrapSerializers` option defaults to true), so
// what arrives here is already the output of `pino.stdSerializers.req`, not the
// raw IncomingMessage. Running the std serializer over it a second time would
// look for `remoteAddress`/`remotePort` on a `socket` that no longer exists and
// drop the client IP and port from every request log line.
//
// Mutating in place rather than spreading: the wrapper builds a fresh object
// per call, and this keeps the prototype's non-enumerable `raw` back-reference
// that a spread would lose.
export const scrubbedRequestSerializer = (
  req: pino.SerializedRequest,
): pino.SerializedRequest => {
  if (req.url) {
    req.url = scrubUrlTokens(req.url);
  }
  return req;
};

/**
 * Which serializers pino-http gets, as a pure function of one boolean, so the
 * branch that actually ships can be asserted in a test. The production branch
 * is otherwise unreachable under Jest — `IS_CI` is true there — so an inverted
 * condition or a dropped serializer would leave every test green while sending
 * unscrubbed URLs to stdout.
 *
 * Serializers are disabled outside production because pino-pretty already
 * prints the request line and the full req/res objects are noise locally.
 */
export function selectRequestSerializers(isDevOrCi: boolean): {
  serializers: NonNullable<pino.LoggerOptions['serializers']>;
} {
  return isDevOrCi
    ? { serializers: { req: () => undefined, res: () => undefined } }
    : { serializers: { req: scrubbedRequestSerializer } };
}

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
  customSuccessMessage: (req: Request, _res: Response) => {
    return `HTTP ${req.method} ${scrubUrlTokens(req.originalUrl)}`;
  },
  customErrorMessage: (req: Request, _res: Response, _err) => {
    return `HTTP ${req.method} ${scrubUrlTokens(req.originalUrl)}`;
  },
  customProps: (req: Request, _res: Response) => {
    const user = req.user;
    if (user) {
      return {
        userId: user._id?.toString(),
        userEmail: user.email,
      };
    }
    return {};
  },
  ...selectRequestSerializers(config.IS_DEV || config.IS_CI),
});

export default logger;
