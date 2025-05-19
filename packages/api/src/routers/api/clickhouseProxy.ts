import express, { RequestHandler, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { getConnectionById } from '@/controllers/connection';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { validateRequestHeaders } from '@/middleware/validation';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

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
      };
      next();
    } catch (e) {
      console.error('Error fetching connection info:', e);
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
    pathRewrite: {
      '^/clickhouse-proxy': '',
    },
    router: _req => {
      if (!_req._hdx_connection?.host) {
        throw new Error('[createProxyMiddleware] Connection not found');
      }
      return _req._hdx_connection.host;
    },
    on: {
      proxyReq: (proxyReq, _req) => {
        const newPath = _req.params[0];
        // @ts-expect-error _req.query is type ParamQs, which doesn't play nicely with URLSearchParams. TODO: Replace with getting query params from _req.url eventually
        const qparams = new URLSearchParams(_req.query);
        if (_req._hdx_connection?.username && _req._hdx_connection?.password) {
          proxyReq.setHeader(
            'X-ClickHouse-User',
            _req._hdx_connection.username,
          );
          proxyReq.setHeader('X-ClickHouse-Key', _req._hdx_connection.password);
        }
        if (_req.method === 'POST') {
          // TODO: Use fixRequestBody after this issue is resolved: https://github.com/chimurai/http-proxy-middleware/issues/1102
          proxyReq.write(_req.body);
        }
        proxyReq.path = `/${newPath}?${qparams}`;
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
