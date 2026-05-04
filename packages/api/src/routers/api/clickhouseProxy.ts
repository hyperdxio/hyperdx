import { sanitizeUrl } from '@braintree/sanitize-url';
import { parameterizedQueryToSql } from '@hyperdx/common-utils/dist/clickhouse';
import opentelemetry from '@opentelemetry/api';
import express, { RequestHandler, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { CODE_VERSION, IS_DEV } from '@/config';
import { getConnectionById } from '@/controllers/connection';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { validateRequestHeaders } from '@/middleware/validation';
import logger from '@/utils/logger';
import { objectIdSchema } from '@/utils/zod';

// Synced with Vercel Limits: https://vercel.com/docs/functions/configuring-functions/duration?framework=nextjs#duration-limits
const MAX_CLICKHOUSE_PROXY_TIMEOUT_SECONDS = 800;

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
export const validateAndSanitizePath = (basePath: string): string => {
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
        const errorText = await result.text();
        return res.status(result.status).json({
          success: false,
          error: errorText || 'Error connecting to ClickHouse server',
        });
      }
      const data = await result.json();
      return res.json({ success: data === 1 });
    } catch (e: any) {
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
    proxyTimeout: MAX_CLICKHOUSE_PROXY_TIMEOUT_SECONDS * 1000,
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

        let body = _req.body;
        if (_req.headers['content-type'] === 'application/json') {
          try {
            body = JSON.stringify(body);
          } catch (e) {
            console.error(e);
          }
        }

        // Add request body to the active span (dev only — avoids leaking
        // arbitrary SQL into production traces).
        if (IS_DEV) {
          const span = opentelemetry.trace.getActiveSpan();
          if (span && body) {
            try {
              // Extract query params (param_* prefix) and reconstruct the full SQL
              const params: Record<string, string> = {};
              for (const [key, value] of Object.entries(_req.query)) {
                if (key.startsWith('param_') && typeof value === 'string') {
                  params[key.slice(6)] = value; // Remove 'param_' prefix
                }
              }
              const sql = parameterizedQueryToSql({ sql: body, params });
              span.setAttribute('http.request.body', sql);
            } catch {
              // Fall back to raw body if parameterization fails
              span.setAttribute('http.request.body', body);
            }
          }
        }

        try {
          // TODO: Use fixRequestBody after this issue is resolved: https://github.com/chimurai/http-proxy-middleware/issues/1102
          proxyReq.write(body);
        } catch (e) {
          console.error(
            `clickhouseProxy error writing body, body is type ${typeof body}`,
          );
        }
      },
      proxyRes: (proxyRes, _req, res) => {
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

        // Add a custom header to indicate that the response is a mixed response when applicable
        // since the Clickhouse Web SDK allows accessing headers but not status codes.
        if (proxyRes.statusCode === 207) {
          proxyRes.headers['X-ClickHouse-Mixed-Response'] = 'true';
        }

        if (proxyRes.statusCode === 206) {
          proxyRes.headers['X-ClickHouse-Service-Unavailable'] = 'true';
        }
      },
      error: (err, _req, _res) => {
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

router.get('/*', hasConnectionId, getConnection, proxyMiddleware);
router.post('/*', hasConnectionId, getConnection, proxyMiddleware);

export default router;
