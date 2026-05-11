import { NextApiRequest, NextApiResponse } from 'next';
import { createProxyMiddleware } from 'http-proxy-middleware';

const DEFAULT_SERVER_URL = `http://127.0.0.1:${process.env.HYPERDX_API_PORT}`;

export const config = {
  api: {
    externalResolver: true,
    bodyParser: false,
  },
};

// In Vercel preview deployments we inline the entire Express API into the
// Next.js serverless function so a single deployment serves both the app and
// the API. In all other environments (Docker fullstack, standalone production)
// we proxy `/api/*` to a separately-deployed API service as before.
const isInlineApi = process.env.HDX_PREVIEW_INLINE_API === 'true';

export default (req: NextApiRequest, res: NextApiResponse) => {
  if (isInlineApi) {
    // Lazy require so non-preview production builds — where the webpack
    // externals hook in next.config.mjs marks @hyperdx/api as external —
    // never attempt to resolve a module that isn't bundled.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const inlineApi = require('@hyperdx/api/build/serverless');
    const handler = inlineApi.default ?? inlineApi;
    return handler(req, res);
  }

  const proxy = createProxyMiddleware({
    changeOrigin: true,
    // logger: console, // DEBUG
    pathRewrite: { '^/api': '' },
    target: process.env.SERVER_URL || DEFAULT_SERVER_URL,
    autoRewrite: true,
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
