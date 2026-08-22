import { sanitizeUrl } from '@braintree/sanitize-url';
import express, { RequestHandler, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { performance } from 'perf_hooks';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { CODE_VERSION } from '@/config';
import { getConnectionById } from '@/controllers/connection';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { validateRequestHeaders } from '@/middleware/validation';
import { recordOperationOutcome } from '@/utils/instrumentation';
import logger from '@/utils/logger';
import { IPV6_BRACKET_RE, isPrivateIp } from '@/utils/validators';
import { objectIdSchema } from '@/utils/zod';

// SLO operations for the ClickHouse proxy. Both paths swallow their errors
// (returning JSON / writing the response directly) so they never reach the API
// error middleware — they must report their own SLIs. See
// agent_docs/observability.md.
const CONNECTION_TEST_OPERATION = 'clickhouse_proxy.connection_test';
const QUERY_PROXY_OPERATION = 'clickhouse_proxy.query';

/**
 * Validates and sanitizes a URL path to prevent injection attacks.
 * - Recursively decodes to catch double/triple encoding of ? and &
 * - Rejects paths with encoded query string characters in pathname
 * - Prevents protocol-based attacks (javascript:, data:, etc.)
 * - Prevents host injection via protocol-relative URLs
 *
 * @param basePath - The path to validate (may include query string)
 * @returns Sanitized path with pathname and query string
 * @throws Error if path contains malicious patterns
 */
const validateAndSanitizePath = (basePath: string): string => {
  // Extract pathname portion (before any literal ?) for encoding attack check
  // Must be done BEFORE sanitizeUrl because it decodes percent-encoded chars
  const firstQuestionMark = basePath.indexOf('?');
  const rawPathname =
    firstQuestionMark >= 0 ? basePath.slice(0, firstQuestionMark) : basePath;

  // Recursively decode pathname to prevent double-encoding attacks
  // (e.g., %253F -> %3F -> ?, %2526 -> %26 -> &)
  let decodedPathname = rawPathname;
  let prevDecoded = '';
  const maxIterations = 10; // Prevent infinite loops
  let iterations = 0;
  while (decodedPathname !== prevDecoded && iterations < maxIterations) {
    prevDecoded = decodedPathname;
    try {
      decodedPathname = decodeURIComponent(decodedPathname);
    } catch {
      throw new Error('Invalid pathname: malformed URL encoding');
    }
    iterations++;
  }

  // Validate fully-decoded pathname doesn't contain query string characters
  if (decodedPathname.includes('?') || decodedPathname.includes('&')) {
    throw new Error('Invalid pathname: contains query string characters');
  }

  // Sanitize URL to prevent protocol-based attacks (javascript:, data:, etc.)
  const sanitizedPath = sanitizeUrl(basePath);
  if (sanitizedPath === 'about:blank') {
    throw new Error('Invalid pathname: potentially malicious URL');
  }

  // Use URL parsing to properly separate pathname from query params
  const parsedUrl = new URL(sanitizedPath, 'http://localhost');

  // Prevent host injection via protocol-relative URLs (e.g., //evil.com)
  if (parsedUrl.hostname !== 'localhost') {
    throw new Error('Invalid pathname: host injection attempt');
  }

  return `${parsedUrl.pathname}${parsedUrl.search}`;
};

const router = express.Router();

const CUSTOM_SETTING_KEY_SEP = '_';
const CUSTOM_SETTING_KEY_USER_SUFFIX = 'user';

declare module 'http' {
  interface IncomingMessage {
    /**
     * Set by body-parser once it has drained the request stream. It is the
     * only signal that separates a parsed empty body from an untouched one —
     * see planProxyBody.
     */
    _body?: boolean;
  }
}

const URLENCODED_MEDIA_TYPE = 'application/x-www-form-urlencoded';

/**
 * What to do with a request body the express parsers may have already
 * consumed.
 *
 * `skip` means the stream is still intact, so the proxy can pipe the original
 * bytes; writing here would corrupt or duplicate them.
 */
export type ProxyBodyPlan =
  | { action: 'write'; payload: string | Buffer }
  | { action: 'skip' };

const mediaTypeOf = (contentType: string | undefined): string =>
  (contentType ?? '').split(';', 1)[0].trim().toLowerCase();

const serializeUrlencoded = (body: object): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    // `extended: false` yields string | string[]; appending each element keeps
    // repeated keys repeated rather than collapsing them into "a,b".
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
    } else if (value !== undefined) {
      params.append(key, String(value));
    }
  }
  return params.toString();
};

/**
 * Decide how to re-inject a proxied request body.
 *
 * `bodyWasParsed` must come from body-parser's own `req._body` flag rather than
 * from the shape of `req.body`: every parser runs `req.body = req.body || {}`
 * *before* its content-type check, so an untouched `multipart/form-data`
 * request is indistinguishable from a parsed empty object by shape alone.
 * `_body` is the only signal that the stream was actually drained, and
 * body-parser uses it for the same purpose.
 */
export const planProxyBody = (
  contentType: string | undefined,
  body: unknown,
  bodyWasParsed: boolean,
): ProxyBodyPlan => {
  // Nothing consumed the stream — let it pipe through untouched.
  if (!bodyWasParsed || body == null) {
    return { action: 'skip' };
  }

  // express.text() already hands back exactly what was on the wire.
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return { action: 'write', payload: body };
  }

  // A JSON scalar (number, boolean) — nothing to re-encode as a form.
  if (typeof body !== 'object') {
    return { action: 'write', payload: JSON.stringify(body) };
  }

  if (mediaTypeOf(contentType) === URLENCODED_MEDIA_TYPE) {
    return { action: 'write', payload: serializeUrlencoded(body) };
  }

  // Only the json and urlencoded parsers produce object bodies, so anything
  // left is JSON. Matching on the media type rather than the raw header is
  // what lets `application/json; charset=utf-8` through — express.json()
  // ignores content-type parameters, and so must we.
  return { action: 'write', payload: JSON.stringify(body) };
};

router.post(
  '/test',
  validateRequest({
    body: z.object({
      host: z.string().url(),
      username: z.string().optional(),
      password: z.string().optional(),
    }),
  }),
  async (req, res) => {
    const { host, username, password } = req.body;

    // Restrict to http/https to prevent file://, gopher://, etc.
    const parsedHost = new URL(host);
    if (parsedHost.protocol !== 'http:' && parsedHost.protocol !== 'https:') {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid protocol' });
    }
    const hostname = parsedHost.hostname.replace(IPV6_BRACKET_RE, '');
    if (isPrivateIp(hostname)) {
      return res.status(400).json({ success: false, error: 'Invalid host' });
    }

    const startedAt = performance.now();
    try {
      const result = await fetch(`${host}/?query=SELECT 1`, {
        headers: {
          'X-ClickHouse-User': username || '',
          'X-ClickHouse-Key': password || '',
        },
        signal: AbortSignal.timeout(2000),
      });
      // For status codes 204-399
      if (!result.ok) {
        recordOperationOutcome({
          operation: CONNECTION_TEST_OPERATION,
          outcome: 'error',
          durationMs: performance.now() - startedAt,
        });
        // Do not reflect the raw response body to avoid leaking internal
        // service responses in case of a misconfigured or SSRF host.
        return res.status(result.status).json({
          success: false,
          error: 'Error connecting to ClickHouse server',
        });
      }
      const data = await result.json();
      recordOperationOutcome({
        operation: CONNECTION_TEST_OPERATION,
        outcome: 'success',
        durationMs: performance.now() - startedAt,
      });
      return res.json({ success: data === 1 });
    } catch (e: any) {
      recordOperationOutcome({
        operation: CONNECTION_TEST_OPERATION,
        outcome: 'error',
        durationMs: performance.now() - startedAt,
      });
      // fetch returns a 400+ error and throws
      console.error(e);
      const errorMessage =
        e.cause?.code === 'ENOTFOUND'
          ? `Unable to resolve host: ${e.cause.hostname}`
          : e.cause?.message ||
            e.message ||
            'Error connecting to ClickHouse server';

      return res.status(500).json({
        success: false,
        error:
          errorMessage +
          ', please check the host and credentials and try again.',
      });
    }
  },
);

const hasConnectionId = validateRequestHeaders(
  z.object({
    'x-hyperdx-connection-id': objectIdSchema,
  }),
);

const getConnection: RequestHandler =
  // prettier-ignore-next-line
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const connection_id = req.headers['x-hyperdx-connection-id']!; // ! because zod already validated
      delete req.headers['x-hyperdx-connection-id'];
      const hyperdx_connection_id = Array.isArray(connection_id)
        ? connection_id.join('')
        : connection_id;

      const connection = await getConnectionById(
        teamId.toString(),
        hyperdx_connection_id,
        true,
      );

      if (!connection) {
        res.status(404).send('Connection not found');
        return;
      }

      req._hdx_connection = {
        host: connection.host,
        id: connection.id,
        name: connection.name,
        password: connection.password,
        username: connection.username,
        hyperdxSettingPrefix: connection.hyperdxSettingPrefix,
      };
      next();
    } catch (e) {
      console.error('Error setting up proxy hdx connection', e);
      next(e);
    }
  };

const proxyMiddleware: RequestHandler =
  // prettier-ignore-next-line
  createProxyMiddleware({
    target: '', // doesn't matter. it should be overridden by the router
    changeOrigin: true,
    pathFilter: (path, _req) => {
      return _req.method === 'GET' || _req.method === 'POST';
    },
    pathRewrite: function (path, req) {
      const sanitizedPath = validateAndSanitizePath(
        path.replace(/^\/clickhouse-proxy/, ''),
      );

      const parsedUrl = new URL(sanitizedPath, 'http://localhost');
      const { searchParams, pathname } = parsedUrl;

      // Append user email as custom ClickHouse setting for query log annotation if the prefix was set
      const hyperdxSettingPrefix = req._hdx_connection?.hyperdxSettingPrefix;
      if (hyperdxSettingPrefix) {
        const userEmail = req.user?.email;
        if (userEmail) {
          const userSettingKey = `${hyperdxSettingPrefix}${CUSTOM_SETTING_KEY_SEP}${CUSTOM_SETTING_KEY_USER_SUFFIX}`;
          searchParams.set(userSettingKey, userEmail);
        } else {
          logger.debug('hyperdxSettingPrefix set, no session user found');
        }
      }

      return `${pathname}?${searchParams.toString()}`;
    },
    router: _req => {
      if (!_req._hdx_connection?.host) {
        throw new Error('[createProxyMiddleware] Connection not found');
      }
      return _req._hdx_connection.host;
    },
    on: {
      proxyReq: (proxyReq, _req, res) => {
        // set user-agent to the hyperdx version identifier
        proxyReq.setHeader('user-agent', `hyperdx ${CODE_VERSION}`);

        if (_req._hdx_connection?.username) {
          proxyReq.setHeader(
            'X-ClickHouse-User',
            _req._hdx_connection.username,
          );
        }
        // Passwords can be empty
        if (_req._hdx_connection?.password) {
          proxyReq.setHeader('X-ClickHouse-Key', _req._hdx_connection.password);
        }

        if (_req.method !== 'POST') {
          console.error(`Unsupported method ${_req.method}`);
          return res.sendStatus(405);
        }

        const plan = planProxyBody(
          _req.headers['content-type'],
          _req.body,
          _req._body === true,
        );

        if (plan.action === 'skip') {
          return;
        }

        try {
          // Re-serialization can change the byte count (whitespace
          // normalization, urlencoded round-trips) and the upstream reads
          // exactly Content-Length bytes, so the header has to follow the
          // payload we are about to write.
          if (!proxyReq.getHeader('transfer-encoding')) {
            proxyReq.setHeader(
              'content-length',
              Buffer.byteLength(plan.payload),
            );
          }
          proxyReq.write(plan.payload);
        } catch (e) {
          // Continuing body-less surfaces to the user as an opaque 400 from
          // ClickHouse; fail the hop so the proxy's error handler reports it.
          console.error('clickhouseProxy error writing body', e);
          proxyReq.destroy(
            e instanceof Error
              ? e
              : new Error('Failed to forward request body to ClickHouse'),
          );
        }
      },
      proxyRes: (proxyRes, _req, res) => {
        const startedAt = (res as Response).locals?.hdxProxyStartedAt;
        const statusCode = proxyRes.statusCode ?? 0;
        recordOperationOutcome({
          operation: QUERY_PROXY_OPERATION,
          // A response (even a 4xx/5xx from ClickHouse) means the proxy hop
          // itself worked; outcome reflects whether ClickHouse served it.
          outcome: statusCode < 400 ? 'success' : 'error',
          durationMs:
            typeof startedAt === 'number' ? performance.now() - startedAt : 0,
        });

        // since clickhouse v24, the cors headers * will be attached to the response by default
        // which will cause the browser to block the response
        if (_req.headers['access-control-request-method']) {
          proxyRes.headers['access-control-allow-methods'] =
            _req.headers['access-control-request-method'];
        }

        if (_req.headers['access-control-request-headers']) {
          proxyRes.headers['access-control-allow-headers'] =
            _req.headers['access-control-request-headers'];
        }

        if (_req.headers.origin) {
          proxyRes.headers['access-control-allow-origin'] = _req.headers.origin;
          proxyRes.headers['access-control-allow-credentials'] = 'true';
        }
      },
      error: (err, _req, _res) => {
        const startedAt = (_res as Response).locals?.hdxProxyStartedAt;
        recordOperationOutcome({
          operation: QUERY_PROXY_OPERATION,
          // No usable response from ClickHouse (connection refused, timeout,
          // DNS failure, ...) — a hard availability failure for the proxy.
          outcome: 'error',
          durationMs:
            typeof startedAt === 'number' ? performance.now() - startedAt : 0,
        });
        console.error('Proxy error:', err);
        (_res as Response).writeHead(500, {
          'Content-Type': 'application/json',
        });
        _res.end(
          JSON.stringify({
            success: false,
            error: err.message || 'Failed to connect to ClickHouse server',
          }),
        );
      },
    },
    // ...(config.IS_DEV && {
    //   logger: console,
    // }),
  });

// Stamp a start time so the proxy callbacks can record query SLO latency.
const markProxyStart: RequestHandler = (_req, res, next) => {
  res.locals.hdxProxyStartedAt = performance.now();
  next();
};

router.get(
  '/*',
  hasConnectionId,
  getConnection,
  markProxyStart,
  proxyMiddleware,
);
router.post(
  '/*',
  hasConnectionId,
  getConnection,
  markProxyStart,
  proxyMiddleware,
);

export default router;
