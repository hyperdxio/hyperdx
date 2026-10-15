import type { ClientRequest, IncomingMessage, ServerResponse } from 'http';

import logger from '@/utils/logger';

type ParsedRequest = Pick<IncomingMessage, 'headers'> & {
  _hdxProxyBody?: Buffer;
};

type ProxyRequest = Pick<
  ClientRequest,
  'getHeader' | 'setHeader' | 'removeHeader' | 'write' | 'destroy'
>;

export function captureProxyBody(
  req: IncomingMessage & ParsedRequest & { path?: string },
  _res: ServerResponse,
  body: Buffer,
) {
  if (/^\/clickhouse-proxy(?:\/|$)/i.test(req.path ?? '')) {
    // verify receives inflated bytes before parsing can change their values.
    req._hdxProxyBody = body;
  }
}

export function writeProxyBody(proxyReq: ProxyRequest, req: ParsedRequest) {
  const body = req._hdxProxyBody;
  // No parser consumed this stream, so let the proxy pipe the original bytes.
  if (body === undefined) return;

  try {
    proxyReq.removeHeader('content-encoding');
    if (proxyReq.getHeader('transfer-encoding')) {
      proxyReq.removeHeader('content-length');
    } else {
      proxyReq.setHeader('content-length', body.length);
    }
    proxyReq.write(body);
  } catch (err) {
    logger.error({ err }, 'Unable to forward ClickHouse proxy body');
    proxyReq.destroy(
      err instanceof Error ? err : new Error('Unable to forward proxy body'),
    );
  }
}
