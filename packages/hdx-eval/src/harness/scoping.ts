import { createServer, request as httpRequest, type Server } from 'http';
import { request as httpsRequest } from 'https';

import type { McpScoping } from './types';

// ─── Pure policy core ────────────────────────────────────────────────────────
// Everything below `startScopingProxy` is side-effect free and unit-tested
// without a network. The proxy applies a structural policy — it never
// parses SQL:
//   1. Sources whose kind is in `hideSourceKinds` are removed from
//      clickstack_list_sources output, and any tool call whose `sourceId`
//      references one is rejected with a not-found error (mirroring the
//      server's own wording so the agent recovers naturally).
//   2. clickstack_sql's `connectionId` is rewritten to
//      `pinSqlConnectionId`, so raw SQL always executes under the
//      restricted ClickHouse user's grants. The database stays the
//      enforcement boundary; the proxy only decides *as whom* SQL runs.

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

export type RequestDecision =
  | { action: 'forward'; body: string; rewriteListSources: boolean }
  | { action: 'reject'; response: Record<string, unknown> };

/**
 * Decide what to do with an incoming JSON-RPC request body. Non-tool-call
 * traffic (initialize, tools/list, notifications) is forwarded untouched.
 */
export function decideRequest(
  scoping: McpScoping,
  hiddenSourceIds: ReadonlySet<string>,
  rawBody: string,
): RequestDecision {
  let parsed: JsonRpcRequest;
  try {
    parsed = JSON.parse(rawBody) as JsonRpcRequest;
  } catch {
    return { action: 'forward', body: rawBody, rewriteListSources: false };
  }
  if (parsed?.method !== 'tools/call' || !parsed.params?.name) {
    return { action: 'forward', body: rawBody, rewriteListSources: false };
  }

  const toolName = parsed.params.name;
  const args = parsed.params.arguments ?? {};

  const sourceId = args.sourceId;
  if (typeof sourceId === 'string' && hiddenSourceIds.has(sourceId)) {
    // Mirror the server's own not-found wording so the agent recovers
    // the same way it would from a genuinely unknown id.
    return {
      action: 'reject',
      response: {
        jsonrpc: '2.0',
        id: parsed.id ?? null,
        result: {
          content: [
            {
              type: 'text',
              text: `Source not found: ${sourceId}. Call clickstack_list_sources to discover available source IDs.`,
            },
          ],
          isError: true,
        },
      },
    };
  }

  if (
    toolName.endsWith('clickstack_sql') &&
    scoping.pinSqlConnectionId &&
    args.connectionId !== scoping.pinSqlConnectionId
  ) {
    const pinned: JsonRpcRequest = {
      ...parsed,
      params: {
        ...parsed.params,
        arguments: { ...args, connectionId: scoping.pinSqlConnectionId },
      },
    };
    return {
      action: 'forward',
      body: JSON.stringify(pinned),
      rewriteListSources: false,
    };
  }

  return {
    action: 'forward',
    body: rawBody,
    rewriteListSources: toolName.endsWith('clickstack_list_sources'),
  };
}

type ListSourcesOutput = {
  sources?: Array<Record<string, unknown>>;
  connections?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

/**
 * Rewrite the JSON text payload of a clickstack_list_sources result:
 * drop hidden-kind sources (returning their ids), pin the remaining
 * sources' `connectionId`, and reduce the connections list to the pinned
 * one so the agent's world model is consistent.
 */
export function rewriteListSourcesText(
  scoping: McpScoping,
  text: string,
): { text: string; hiddenIds: string[] } {
  let output: ListSourcesOutput;
  try {
    output = JSON.parse(text) as ListSourcesOutput;
  } catch {
    return { text, hiddenIds: [] };
  }
  if (!Array.isArray(output.sources)) return { text, hiddenIds: [] };

  const hiddenIds: string[] = [];
  const kept = output.sources.filter(s => {
    if (
      typeof s.kind === 'string' &&
      scoping.hideSourceKinds.includes(s.kind)
    ) {
      if (typeof s.id === 'string') hiddenIds.push(s.id);
      return false;
    }
    return true;
  });

  const pin = scoping.pinSqlConnectionId;
  const rewritten: ListSourcesOutput = {
    ...output,
    sources: pin ? kept.map(s => ({ ...s, connectionId: pin })) : kept,
  };
  if (pin && Array.isArray(output.connections)) {
    rewritten.connections = output.connections.filter(c => c.id === pin);
  }
  return { text: JSON.stringify(rewritten, null, 2), hiddenIds };
}

/**
 * Apply `rewriteText` to the tool-result text inside a raw MCP HTTP
 * response payload — either a plain JSON-RPC body or an SSE stream with
 * `data:` lines. Unrecognized payloads pass through unchanged.
 */
export function rewriteToolResponsePayload(
  payload: string,
  contentType: string,
  rewriteText: (text: string) => string,
): string {
  const rewriteMessage = (raw: string): string => {
    try {
      const msg = JSON.parse(raw) as {
        result?: { content?: Array<{ type?: string; text?: string }> };
      };
      const item = msg?.result?.content?.[0];
      if (item?.type === 'text' && typeof item.text === 'string') {
        item.text = rewriteText(item.text);
        return JSON.stringify(msg);
      }
    } catch {
      // Not JSON — leave untouched.
    }
    return raw;
  };

  if (contentType.includes('text/event-stream')) {
    return payload
      .split('\n')
      .map(line =>
        line.startsWith('data: ')
          ? `data: ${rewriteMessage(line.slice(6))}`
          : line,
      )
      .join('\n');
  }
  return rewriteMessage(payload);
}

/** Extract the first tool-result text from a raw MCP HTTP response payload. */
export function extractToolResultText(payload: string): string | null {
  const tryParse = (raw: string): string | null => {
    try {
      const msg = JSON.parse(raw) as {
        result?: { content?: Array<{ type?: string; text?: string }> };
      };
      const item = msg?.result?.content?.[0];
      return item?.type === 'text' && typeof item.text === 'string'
        ? item.text
        : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(payload);
  if (direct !== null) return direct;
  for (const line of payload.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const text = tryParse(line.slice(6));
    if (text !== null) return text;
  }
  return null;
}

// ─── Proxy server ────────────────────────────────────────────────────────────

export type ScopingProxyHandle = {
  url: string;
  close(): Promise<void>;
};

/** Headers that must not be forwarded verbatim between hops.
 *  `content-encoding` is response-side: undici's fetch transparently
 *  decompresses the body, so forwarding the original encoding header with
 *  a decompressed payload would corrupt the client's view. */
const HOP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'keep-alive',
]);

async function readBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch the upstream source inventory once so hidden-source rejection works
 * even before the agent's first list_sources call. The HyperDX MCP accepts a
 * bare stateless tools/call. Throws on failure — running the arm without
 * the hidden-id set would silently void the isolation guarantee.
 */
async function fetchHiddenSourceIds(
  upstreamUrl: string,
  headers: Record<string, string>,
  scoping: McpScoping,
): Promise<Set<string>> {
  const res = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'tools/call',
      params: { name: 'clickstack_list_sources', arguments: {} },
    }),
  });
  const payload = await res.text();
  if (!res.ok) {
    throw new Error(
      `scoping proxy: upstream list_sources probe failed (${res.status}): ${payload.slice(0, 200)}`,
    );
  }
  const text = extractToolResultText(payload);
  if (text === null) {
    throw new Error(
      'scoping proxy: could not parse upstream list_sources response',
    );
  }
  return new Set(rewriteListSourcesText(scoping, text).hiddenIds);
}

/**
 * Start a local HTTP proxy in front of an MCP server that enforces an
 * `McpScoping` policy. Returns the proxy URL to hand to Claude Code and a
 * `close` disposer. One proxy per run — it is stateless apart from the
 * hidden-source-id set.
 */
export async function startScopingProxy(opts: {
  upstreamUrl: string;
  headers?: Record<string, string>;
  scoping: McpScoping;
}): Promise<ScopingProxyHandle> {
  const upstreamHeaders = opts.headers ?? {};
  const hiddenSourceIds = await fetchHiddenSourceIds(
    opts.upstreamUrl,
    upstreamHeaders,
    opts.scoping,
  );

  const target = new URL(opts.upstreamUrl);
  const requestUpstream =
    target.protocol === 'https:' ? httpsRequest : httpRequest;

  const server: Server = createServer(async (req, res) => {
    let rawBody = '';
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        rawBody = await readBody(req);
      }
    } catch {
      res.writeHead(400).end();
      return;
    }

    let forwardBody = rawBody;
    let rewriteListSources = false;
    if (req.method === 'POST' && rawBody) {
      const decision = decideRequest(opts.scoping, hiddenSourceIds, rawBody);
      if (decision.action === 'reject') {
        const body = JSON.stringify(decision.response);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }
      forwardBody = decision.body;
      rewriteListSources = decision.rewriteListSources;
    }

    // Forward with the client's headers (minus hop-by-hop), overlaying the
    // configured upstream headers (Authorization). Node lowercases incoming
    // header names, so overlay case-insensitively — a duplicate
    // `authorization`/`Authorization` pair would reach the upstream as a
    // comma-joined value and fail bearer parsing. `accept-encoding` is
    // forced to identity so the rewrite path never sees compressed bodies.
    const headers: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_HEADERS.has(key.toLowerCase())) continue;
      if (typeof value === 'string') headers[key] = value;
    }
    for (const [key, value] of Object.entries(upstreamHeaders)) {
      delete headers[key.toLowerCase()];
      headers[key] = value;
    }
    headers['accept-encoding'] = 'identity';
    if (forwardBody) headers['content-length'] = Buffer.byteLength(forwardBody);

    // Raw node:http instead of fetch: no body timeout (the MCP SSE GET
    // stream stays open for the whole run — undici's 300s bodyTimeout
    // would sever it and crash the pipe), and true bidirectional streaming.
    const upstreamReq = requestUpstream(
      target,
      { method: req.method, headers },
      upstreamRes => {
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(upstreamRes.headers)) {
          if (HOP_HEADERS.has(key)) continue;
          if (typeof value === 'string') responseHeaders[key] = value;
        }
        const status = upstreamRes.statusCode ?? 502;

        if (rewriteListSources) {
          const chunks: Buffer[] = [];
          upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            const rewritten = rewriteToolResponsePayload(
              Buffer.concat(chunks).toString('utf8'),
              upstreamRes.headers['content-type'] ?? '',
              text => {
                const result = rewriteListSourcesText(opts.scoping, text);
                // Keep the deny set fresh — sources may be recreated
                // between proxy start and this call.
                for (const id of result.hiddenIds) hiddenSourceIds.add(id);
                return result.text;
              },
            );
            res.writeHead(status, responseHeaders);
            res.end(rewritten);
          });
          upstreamRes.on('error', () => res.destroy());
          return;
        }

        res.writeHead(status, responseHeaders);
        upstreamRes.pipe(res);
        upstreamRes.on('error', () => res.destroy());
      },
    );

    upstreamReq.on('error', e => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: `scoping proxy error: ${e instanceof Error ? e.message : e}`,
          },
        }),
      );
    });
    // If the client goes away (run teardown, SSE reconnect), release the
    // upstream connection too.
    res.on('close', () => upstreamReq.destroy());

    upstreamReq.end(forwardBody || undefined);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('scoping proxy: failed to bind a local port');
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
        // Sever any open SSE streams so close() cannot hang.
        server.closeAllConnections();
      }),
  };
}
