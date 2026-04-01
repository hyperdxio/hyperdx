import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { validateUserAccessKey } from '../middleware/auth';
import logger from '../utils/logger';
import { createServer } from './mcpServer';
import { McpContext } from './tools/types';

const app = createMcpExpressApp();

app.all('/', validateUserAccessKey, async (req, res) => {
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
  const context: McpContext = {
    teamId: teamId.toString(),
    userId,
  };

  setTraceAttributes({
    'mcp.team.id': context.teamId,
    ...(userId && { 'mcp.user.id': userId }),
  });

  logger.info({ teamId: context.teamId, userId }, 'MCP request received');

  const server = createServer(context);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await server.close();
  }
});

export default app;
