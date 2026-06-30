import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import * as config from '@/config';
import { validateUserAccessKey } from '@/middleware/auth';
import logger from '@/utils/logger';
import rateLimiter, { rateLimiterKeyGenerator } from '@/utils/rateLimiter';

import { createServer } from './mcpServer';
import { McpContext } from './tools/types';

// The SDK applies localhost-only DNS-rebinding protection by default, which
// rejects any request whose Host header isn't localhost. Managed agents (and
// any remote MCP client) reach us over a public tunnel/domain, so allowlist the
// configured public hosts alongside localhost. Matching is port-agnostic, so we
// pass bare hostnames.
export const buildAllowedHosts = (urls: (string | undefined)[]): string[] => {
  const hosts = ['localhost', '127.0.0.1', '[::1]'];
  for (const url of urls) {
    if (!url) continue;
    try {
      hosts.push(new URL(url).hostname);
    } catch {
      // ignore a malformed URL — it just won't be allowlisted
    }
  }
  return hosts;
};

const app = createMcpExpressApp({
  allowedHosts: buildAllowedHosts([
    process.env.HDX_MANAGED_AGENTS_MCP_URL,
    config.FRONTEND_URL,
  ]),
});

const mcpRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 600, // 10 req/s
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimiterKeyGenerator,
});

app.all('/', mcpRateLimiter, validateUserAccessKey, async (req, res) => {
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
