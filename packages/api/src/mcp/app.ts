import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

import * as config from '@/config';
import { validateUserAccessKey } from '@/middleware/auth';
import logger from '@/utils/logger';
import rateLimiter, { rateLimiterKeyGenerator } from '@/utils/rateLimiter';

import { createServer } from './mcpServer';
import { McpContext } from './tools/types';
import { userAgentClientInfo } from './utils/mcpClient';

// The SDK applies localhost-only DNS-rebinding protection by default, which
// rejects any request whose Host header isn't localhost. Managed agents (and
// any remote MCP client) reach us over a public tunnel/domain, so allowlist the
// configured public hosts alongside localhost. Matching is port-agnostic, so we
// pass bare hostnames.
export const buildAllowedHosts = (
  urls: (string | undefined)[],
  extraHosts = '',
): string[] => {
  const hosts = ['localhost', '127.0.0.1', '[::1]'];
  for (const url of urls) {
    if (!url) continue;
    try {
      hosts.push(new URL(url).hostname);
    } catch {
      // ignore a malformed URL — it just won't be allowlisted
    }
  }
  // Bare hostnames rather than URLs, so an operator can name the API's own
  // host without inventing a scheme for it.
  for (const host of extraHosts.split(',')) {
    const trimmed = host.trim();
    if (trimmed) hosts.push(trimmed);
  }
  return hosts;
};

const app = createMcpExpressApp({
  // FRONTEND_URL is always allowlisted — the endpoint is reachable through the
  // app origin in every deployment. The managed-agents URL is added only when
  // that feature is on, and HDX_MCP_ALLOWED_HOSTS covers a deployment that
  // serves the API on a hostname of its own.
  allowedHosts: buildAllowedHosts(
    [
      config.IS_MANAGED_AGENTS_ENABLED
        ? config.getManagedAgentsMcpUrl()
        : undefined,
      config.FRONTEND_URL,
    ],
    config.MCP_ALLOWED_HOSTS,
  ),
});

const mcpRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 600, // 10 req/s
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimiterKeyGenerator,
});

// This transport is stateless: a fresh server/transport is created per POST, so
// we neither offer a server-initiated SSE stream (GET) nor client-terminable
// sessions (DELETE). Per the Streamable HTTP spec a server that doesn't offer
// these MUST respond 405; SDK clients treat 405 as "not offered, continue"
// whereas any other status (e.g. the SDK's default doomed SSE stream on GET, or
// a 400) aborts the connection. See issue #2686.
//
// OPTIONS is intentionally not handled here: the global CORS middleware in
// api-app.ts short-circuits preflight before this router runs, and it must —
// answering OPTIONS with a 405 would break browser CORS preflight.
const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res.set('Allow', 'POST').sendStatus(405);
};
app.get('/', mcpRateLimiter, methodNotAllowed);
app.delete('/', mcpRateLimiter, methodNotAllowed);

app.post('/', mcpRateLimiter, validateUserAccessKey, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  const teamId = req.user?.team;

  if (!teamId) {
    logger.warn('MCP request rejected: no teamId');
    res.sendStatus(403);
    return;
  }

  const userId = req.user?._id?.toString();
  if (!userId) {
    logger.warn('MCP request rejected: no userId');
    res.sendStatus(403);
    return;
  }

  const context: McpContext = {
    teamId: teamId.toString(),
    userId,
    mcpClient: userAgentClientInfo(req.get('User-Agent')),
  };

  setTraceAttributes({
    'mcp.team.id': context.teamId,
    'mcp.user.id': userId,
  });

  logger.info({ teamId: context.teamId, userId }, 'MCP request received');

  const server = createServer(context);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await server.close();
    await transport.close();
  }
});

export default app;
