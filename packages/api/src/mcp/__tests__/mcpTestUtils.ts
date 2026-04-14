import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  type CallToolResult,
  CallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { createServer } from '../mcpServer';
import { McpContext } from '../tools/types';

/**
 * Connect an MCP server to an in-process Client via InMemoryTransport and
 * return the client. This is the officially supported way to test MCP servers
 * without accessing private SDK internals.
 */
export async function createTestClient(context: McpContext): Promise<Client> {
  const mcpServer = createServer(context);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

/**
 * Call a named MCP tool and return a properly-typed result.
 *
 * The SDK's `Client.callTool()` return type carries an index signature
 * `[x: string]: unknown` that widens all property accesses to `unknown`.
 * Re-parsing through `CallToolResultSchema` gives the concrete named type
 * needed for clean test assertions.
 */
export async function callTool(
  c: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const raw = await c.callTool({ name, arguments: args });
  return CallToolResultSchema.parse(raw);
}

/**
 * Extract the text from the first content item of a tool result.
 * Throws if the item is not a text block.
 */
export function getFirstText(result: CallToolResult): string {
  const item = result.content[0];
  if (!item || item.type !== 'text') {
    throw new Error(`Expected text content, got: ${JSON.stringify(item)}`);
  }
  return item.text;
}
