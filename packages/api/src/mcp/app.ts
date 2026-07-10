import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { MCP_ALLOWED_HOSTS } from '@/config';
import { validateUserAccessKey } from '@/middleware/auth';
import logger from '@/utils/logger';
import rateLimiter, { rateLimiterKeyGenerator } from '@/utils/rateLimiter';

import { createServer } from './mcpServer';
import { McpContext } from './tools/types';

// When MCP_ALLOWED_HOSTS is set, pass an explicit allowlist so the SDK accepts
// those Host header values (plus the localhost defaults it always allows).
// Without it, createMcpExpressApp() defaults to host '127.0.0.1' and rejects
// any non-localhost Host with "Invalid Host" — which breaks reaching the MCP
// over a service DNS name (e.g. the CI eval runner hitting `hyperdx:8000`).
const app =
  MCP_ALLOWED_HOSTS.length > 0
    ? createMcpExpressApp({
        allowedHosts: [...MCP_ALLOWED_HOSTS, '127.0.0.1', 'localhost', '::1'],
      })
    : createMcpExpressApp();

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
