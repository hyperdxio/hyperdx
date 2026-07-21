import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

import { validateUserAccessKey } from '@/middleware/auth';
import logger from '@/utils/logger';
import rateLimiter, { rateLimiterKeyGenerator } from '@/utils/rateLimiter';

import { createServer } from './mcpServer';
import { McpContext } from './tools/types';

const app = createMcpExpressApp();

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
// OPTIONS is handled explicitly for the same reason: Express's automatic OPTIONS
// response would build its Allow header from every registered route (GET, POST,
// DELETE) and advertise GET/DELETE as usable. Routing it through the same 405
// keeps the advertised contract honest — POST is the only supported method.
const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res.set('Allow', 'POST').sendStatus(405);
};
app.get('/', mcpRateLimiter, methodNotAllowed);
app.delete('/', mcpRateLimiter, methodNotAllowed);
app.options('/', mcpRateLimiter, methodNotAllowed);

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
