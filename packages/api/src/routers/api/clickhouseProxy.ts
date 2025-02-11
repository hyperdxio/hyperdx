import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '@/config';
import { getConnectionById } from '@/controllers/connection';
import { getNonNullUserWithTeam } from '@/middleware/auth';
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

router.get(
  '/*',
  validateRequest({
    query: z.object({
      hyperdx_connection_id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { hyperdx_connection_id } = req.query;

      const connection = await getConnectionById(
        teamId.toString(),
        hyperdx_connection_id,
        true,
      );

      if (!connection) {
        res.status(404).send('Connection not found');
        return;
      }

      const newPath = req.params[0];
      const qparams = new URLSearchParams(req.query);
      qparams.delete('hyperdx_connection_id');

      return createProxyMiddleware({
        target: connection.host,
        changeOrigin: true,
        pathFilter: (path, req) => {
          // TODO: allow other methods
          return req.method === 'GET';
        },
        pathRewrite: {
          '^/clickhouse-proxy': '',
        },
        headers: {
          ...(connection.username
            ? { 'X-ClickHouse-User': connection.username }
            : {}),
          ...(connection.password
            ? { 'X-ClickHouse-Key': connection.password }
            : {}),
        },
        on: {
          proxyReq: (proxyReq, req) => {
            proxyReq.path = `/${newPath}?${qparams.toString()}`;
          },
          proxyRes: (proxyRes, req, res) => {
            // since clickhouse v24, the cors headers * will be attached to the response by default
            // which will cause the browser to block the response
            if (req.headers['access-control-request-method']) {
              proxyRes.headers['access-control-allow-methods'] =
                req.headers['access-control-request-method'];
            }

            if (req.headers['access-control-request-headers']) {
              proxyRes.headers['access-control-allow-headers'] =
                req.headers['access-control-request-headers'];
            }

            if (req.headers.origin) {
              proxyRes.headers['access-control-allow-origin'] =
                req.headers.origin;
              proxyRes.headers['access-control-allow-credentials'] = 'true';
            }
          },
          error: (err, _req, _res) => {
            console.error('Proxy error:', err);
            res.writeHead(500, {
              'Content-Type': 'application/json',
            });
            res.end(
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
      })(req, res, next);
    } catch (e) {
      console.error('Router error:', e);
      res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : 'Internal server error',
      });
    }
  },
);

export default router;
