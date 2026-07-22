import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { validateUserAccessKey } from '@/middleware/auth';
import logger from '@/utils/logger';
import rateLimiter, { rateLimiterKeyGenerator } from '@/utils/rateLimiter';

import { createServer } from './mcpServer';
import { McpContext } from './tools/types';
import { userAgentClientInfo } from './utils/mcpClient';

const app = createMcpExpressApp();

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
