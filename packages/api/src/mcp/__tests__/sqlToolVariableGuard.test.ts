// Unit test for the clickstack_sql input guard that rejects the variable
// macros. Mocks runConfigTile so the accepted cases prove "the guard let this
// through" without needing ClickHouse: the guard returns before any query, so
// whether runConfigTile was called is exactly the signal under test.

const mockRunConfigTile = jest.fn();

jest.mock('@/mcp/tools/query/helpers', () => {
  const actual = jest.requireActual('@/mcp/tools/query/helpers');
  return {
    ...actual,
    runConfigTile: (...args: unknown[]) => mockRunConfigTile(...args),
  };
});

jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({}));
jest.mock('@/controllers/connection', () => ({}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import mongoose from 'mongoose';

import { registerSql } from '@/mcp/tools/query/sql';
import type { McpContext, RegisterToolFn, ToolResult } from '@/mcp/tools/types';

type Handler = Parameters<RegisterToolFn>[2];

// The accepted cases run on past the guard into buildTile, which parses this
// through objectIdSchema.
const connectionId = new mongoose.Types.ObjectId().toString();

function buildHandler(): Handler {
  let captured: Handler | undefined;
  const registerTool: RegisterToolFn = (_name, _config, handler) => {
    captured = handler;
  };
  const context: McpContext = { teamId: 'team-1', userId: 'user-1' };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerSql({ server, context, registerTool });
  if (!captured) throw new Error('handler was not registered');
  return captured;
}

function textOf(result: ToolResult): string {
  const item = result.content[0];
  if (!item || item.type !== 'text') throw new Error('expected text content');
  return item.text;
}

const okResult = {
  content: [{ type: 'text' as const, text: JSON.stringify({ result: [] }) }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRunConfigTile.mockResolvedValue(okResult);
});

describe('clickstack_sql variable macro guard', () => {
  it.each([
    ['$__filter with an expression', '$__filter(ServiceName, $service)'],
    ['$__filter with one argument', '$__filter($service)'],
    ['$__conditionalAll', "$__conditionalAll(ServiceName != 'api', $service)"],
  ])('rejects %s before issuing a query', async (_label, macro) => {
    const handler = buildHandler();
    const result = await handler({
      connectionId,
      sql: `SELECT 1 AS value WHERE ${macro}`,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('only resolve for a tile on a dashboard');
    // The point of rejecting up front: ClickHouse never sees the literal
    // macro text, so the agent gets this instead of a syntax error on '$'.
    expect(mockRunConfigTile).not.toHaveBeenCalled();
  });

  it('does NOT reject $__filters, which takes no variable context', async () => {
    // The regression that matters. $__filters (plural) is a different macro
    // that every dashboard-scoped raw SQL query is told to use, and the
    // singular name is a prefix of it.
    const handler = buildHandler();
    const result = await handler({
      connectionId,
      sql: 'SELECT 1 AS value WHERE $__filters',
    });

    expect(result.isError).toBeFalsy();
    expect(mockRunConfigTile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['$__timeFilter', 'SELECT 1 WHERE $__timeFilter(Timestamp)'],
    ['a bare $ reference', "SELECT 1 WHERE Body LIKE '%$service%'"],
    ['a commented-out macro', 'SELECT 1 -- $__filter(a, $b)'],
  ])('does not reject %s', async (_label, sql) => {
    const handler = buildHandler();
    const result = await handler({ connectionId, sql });

    expect(result.isError).toBeFalsy();
    expect(mockRunConfigTile).toHaveBeenCalledTimes(1);
  });

  it('rejects before parsing the time range is even relevant', async () => {
    // Ordering check: an invalid time range is reported first, so a caller
    // fixing one problem at a time is not bounced between the two.
    const handler = buildHandler();
    const result = await handler({
      connectionId,
      sql: 'SELECT 1 WHERE $__filter(ServiceName, $service)',
      startTime: 'not-a-date',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid');
  });
});
