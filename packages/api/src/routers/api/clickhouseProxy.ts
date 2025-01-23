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
      }).then(res => res.json());
      return res.json({ success: result === 1 });
    } catch (e) {
      return res.json({ success: false });
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
            console.error(err);
          },
        },
        // ...(config.IS_DEV && {
        //   logger: console,
        // }),
      })(req, res, next);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
