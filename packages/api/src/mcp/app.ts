import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import * as config from '../config';
import { LOCAL_APP_TEAM } from '../controllers/team';
import { validateUserAccessKey } from '../middleware/auth';
import logger from '../utils/logger';
import { createServer } from './mcpServer';
import { McpContext } from './tools/types';

const app = createMcpExpressApp();

const mcpMiddleware = config.IS_LOCAL_APP_MODE ? [] : [validateUserAccessKey];

app.all('/', ...mcpMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  const teamId = config.IS_LOCAL_APP_MODE ? LOCAL_APP_TEAM._id : req.user?.team;

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

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

export default app;
