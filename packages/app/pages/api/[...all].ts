import { NextApiRequest, NextApiResponse } from 'next';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

import { IS_DEV } from '@/config';

const DEFAULT_SERVER_URL = `http://127.0.0.1:${process.env.HYPERDX_API_PORT}`;

export const config = {
  api: {
    externalResolver: true,
    bodyParser: true,
  },
};

export default (req: NextApiRequest, res: NextApiResponse) => {
  const proxy = createProxyMiddleware({
    changeOrigin: true,
    // logger: console, // DEBUG
    pathRewrite: { '^/api': '' },
    target: process.env.NEXT_PUBLIC_SERVER_URL || DEFAULT_SERVER_URL,
    autoRewrite: true,
    /**
     * Fix bodyParser
     **/
    on: {
      proxyReq: fixRequestBody,
    },
    // ...(IS_DEV && {
    //   logger: console,
    // }),
  });
  return proxy(req, res, error => {
    if (error) {
      console.error(error);
      res.status(500).send('API proxy error');
      return;
    }
    res.status(404).send('Not found');
  });
};
