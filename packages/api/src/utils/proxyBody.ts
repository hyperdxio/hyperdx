import type { ClientRequest, IncomingHttpHeaders } from 'http';

import logger from '@/utils/logger';

type ParsedRequest = {
  headers: IncomingHttpHeaders;
  body?: unknown;
  _body?: boolean;
};

type ProxyRequest = Pick<
  ClientRequest,
  'getHeader' | 'setHeader' | 'removeHeader' | 'write' | 'destroy'
>;

export function writeProxyBody(proxyReq: ProxyRequest, req: ParsedRequest) {
  // body-parser sets _body only when it consumes the stream. Otherwise the
  // proxy must pipe the original bytes, even when req.body was set to {}.
  if (!req._body) return;

  try {
    const contentType = req.headers['content-type'];
    const mediaType = contentType?.split(';')[0].trim().toLowerCase();
    let body = req.body;

    if (typeof body !== 'string' && !Buffer.isBuffer(body)) {
      if (mediaType === 'application/json') {
        body = JSON.stringify(body);
      } else if (
        mediaType === 'application/x-www-form-urlencoded' &&
        body != null &&
        typeof body === 'object'
      ) {
        const params = new URLSearchParams();
        const entries: [string, unknown][] = Object.entries(body);
        for (const [key, value] of entries) {
          for (const item of Array.isArray(value) ? value : [value]) {
            params.append(key, String(item));
          }
        }
        body = params.toString();
      }
    }

    if (typeof body !== 'string' && !Buffer.isBuffer(body)) {
      throw new Error('Unsupported parsed ClickHouse proxy body');
    }

    // The parsers already decompressed and decoded the incoming payload.
    proxyReq.removeHeader('content-encoding');
    if (typeof body === 'string' && contentType) {
      const utf8ContentType = contentType.replace(
        /;\s*charset\s*=\s*(?:"[^"]*"|[^;]*)/i,
        '; charset=utf-8',
      );
      if (utf8ContentType !== contentType) {
        proxyReq.setHeader('content-type', utf8ContentType);
      }
    }

    if (proxyReq.getHeader('transfer-encoding')) {
      proxyReq.removeHeader('content-length');
    } else {
      proxyReq.setHeader('content-length', Buffer.byteLength(body));
    }
    proxyReq.write(body);
  } catch (err) {
    logger.error({ err }, 'Unable to forward ClickHouse proxy body');
    proxyReq.destroy(
      err instanceof Error ? err : new Error('Unable to forward proxy body'),
    );
  }
}
