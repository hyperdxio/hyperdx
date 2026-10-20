// Unit tests for clickstack_sql batch mode (the `queries` argument). Mocks
// runConfigTile and getSource so the batch runner can be driven without
// ClickHouse or Mongo.

const mockRunConfigTile = jest.fn();
const mockGetSource = jest.fn();

jest.mock('@/mcp/tools/query/helpers', () => {
  const actual = jest.requireActual('@/mcp/tools/query/helpers');
  return {
    ...actual,
    runConfigTile: (...args: unknown[]) => mockRunConfigTile(...args),
  };
});

jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({
  getSource: (...args: unknown[]) => mockGetSource(...args),
}));
jest.mock('@/controllers/connection', () => ({}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import mongoose from 'mongoose';

import { registerSql } from '@/mcp/tools/query/sql';
import {
  SQL_BATCH_CONCURRENCY,
  SQL_BATCH_DEADLINE_MS,
  SQL_BATCH_RESPONSE_BUDGET,
} from '@/mcp/tools/query/sqlBatch';
import type { McpContext, RegisterToolFn, ToolResult } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';

type Handler = Parameters<RegisterToolFn>[2];

const connectionId = new mongoose.Types.ObjectId().toString();
const otherConnectionId = new mongoose.Types.ObjectId().toString();
const sourceId = new mongoose.Types.ObjectId().toString();

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

function rowsResult(rows: unknown[]) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify({ result: rows }) },
    ],
  };
}

type TileArg = {
  config: { sqlTemplate: string; connectionId: string; sourceId?: string };
};

function tileArgs(): TileArg['config'][] {
  return mockRunConfigTile.mock.calls.map(
    ([, tile]: [unknown, TileArg]) => tile.config,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunConfigTile.mockImplementation((_team, tile: TileArg) =>
    Promise.resolve(rowsResult([{ sql: tile.config.sqlTemplate }])),
  );
  mockGetSource.mockResolvedValue({ connection: connectionId });
});

describe('clickstack_sql batch mode', () => {
  it('rejects a call that passes both sql and queries', async () => {
    const result = await buildHandler()({
      connectionId,
      sql: 'SELECT 1',
      queries: [{ sql: 'SELECT 2' }],
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('exactly one of sql');
    expect(mockRunConfigTile).not.toHaveBeenCalled();
  });

  it('rejects a call that passes neither sql nor queries', async () => {
    const result = await buildHandler()({ connectionId });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('exactly one of sql');
  });

  it('rejects duplicate query ids before running anything', async () => {
    const result = await buildHandler()({
      connectionId,
      queries: [
        { id: 'a', sql: 'SELECT 1' },
        { id: 'a', sql: 'SELECT 2' },
      ],
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Duplicate query id "a"');
    expect(mockRunConfigTile).not.toHaveBeenCalled();
  });

  it('returns results in input order with index and id', async () => {
    mockRunConfigTile.mockImplementation(
      (_team, tile: TileArg) =>
        new Promise(resolve =>
          // Finish in reverse order to prove ordering is by input, not completion.
          setTimeout(
            () => resolve(rowsResult([{ sql: tile.config.sqlTemplate }])),
            tile.config.sqlTemplate === 'SELECT 1' ? 20 : 1,
          ),
        ),
    );

    const result = await buildHandler()({
      connectionId,
      queries: [{ id: 'first', sql: 'SELECT 1' }, { sql: 'SELECT 2' }],
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result));
    expect(parsed.summary).toEqual({ total: 2, ok: 2, error: 0, timeout: 0 });
    expect(parsed.results).toEqual([
      {
        index: 0,
        id: 'first',
        status: 'ok',
        result: [{ sql: 'SELECT 1' }],
      },
      { index: 1, status: 'ok', result: [{ sql: 'SELECT 2' }] },
    ]);
  });

  it('reports a query that fails validation without blocking the others', async () => {
    const result = await buildHandler()({
      connectionId,
      queries: [
        { id: 'macro', sql: 'SELECT 1 WHERE $__filter(ServiceName, $svc)' },
        { id: 'noSource', sql: 'SELECT count() FROM $__sourceTable' },
        { id: 'good', sql: 'SELECT 3' },
      ],
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result));
    expect(parsed.summary).toMatchObject({ ok: 1, error: 2 });
    expect(parsed.results[0].error).toContain('only resolve for a tile');
    expect(parsed.results[1].error).toContain(
      '$__sourceTable needs a sourceId',
    );
    expect(parsed.results[2].status).toBe('ok');
    expect(tileArgs().map(c => c.sqlTemplate)).toEqual(['SELECT 3']);
  });

  it('reports ClickHouse errors and thrown errors per query', async () => {
    mockRunConfigTile.mockImplementation((_team, tile: TileArg) => {
      if (tile.config.sqlTemplate === 'BAD') {
        return Promise.resolve(mcpUserError('Syntax error near BAD'));
      }
      if (tile.config.sqlTemplate === 'THROW') {
        return Promise.reject(new Error('connection reset'));
      }
      return Promise.resolve(rowsResult([]));
    });

    const result = await buildHandler()({
      connectionId,
      queries: [{ sql: 'BAD' }, { sql: 'THROW' }, { sql: 'SELECT 1' }],
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result));
    expect(parsed.results.map((r: { status: string }) => r.status)).toEqual([
      'error',
      'error',
      'ok',
    ]);
    expect(parsed.results[0].error).toContain('Syntax error near BAD');
    expect(parsed.results[1].error).toContain('connection reset');
  });

  it('returns isError when every query fails, keeping per-query errors', async () => {
    mockRunConfigTile.mockResolvedValue(mcpUserError('Unknown table'));

    const result = await buildHandler()({
      connectionId,
      queries: [{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }],
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(textOf(result));
    expect(parsed.summary).toMatchObject({ ok: 0, error: 2 });
    expect(parsed.results[0].error).toContain('Unknown table');
  });

  it('inherits top-level connectionId and sourceId unless a query overrides them', async () => {
    const otherSourceId = new mongoose.Types.ObjectId().toString();
    mockGetSource.mockImplementation((_team, id: string) =>
      Promise.resolve({
        connection: id === otherSourceId ? otherConnectionId : connectionId,
      }),
    );

    const result = await buildHandler()({
      connectionId,
      sourceId,
      queries: [
        { sql: 'SELECT 1' },
        {
          sql: 'SELECT 2',
          connectionId: otherConnectionId,
          sourceId: otherSourceId,
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(tileArgs()).toEqual([
      expect.objectContaining({
        sqlTemplate: 'SELECT 1',
        connectionId,
        sourceId,
      }),
      expect.objectContaining({
        sqlTemplate: 'SELECT 2',
        connectionId: otherConnectionId,
        sourceId: otherSourceId,
      }),
    ]);
  });

  it('flags a connection override that conflicts with the inherited source', async () => {
    const result = await buildHandler()({
      connectionId,
      sourceId,
      queries: [
        { sql: 'SELECT 1' },
        { sql: 'SELECT 2', connectionId: otherConnectionId },
      ],
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.results[0].status).toBe('ok');
    expect(parsed.results[1].status).toBe('error');
    expect(parsed.results[1].error).toContain('does not match the connection');
  });

  it('looks each source up once per call, including during execution', async () => {
    await buildHandler()({
      connectionId,
      sourceId,
      queries: [{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }, { sql: 'SELECT 3' }],
    });

    // runConfigTile is mocked, so call the lookup it was handed the way the
    // real raw SQL path does and check it reuses the cached read.
    for (const call of mockRunConfigTile.mock.calls) {
      await call[4].lookupSource(sourceId);
    }
    expect(mockGetSource).toHaveBeenCalledTimes(1);
  });

  it('times out a query whose source lookup outlives the deadline', async () => {
    jest.useFakeTimers();
    try {
      mockGetSource.mockReturnValue(new Promise(() => {}));

      const pending = buildHandler()({
        connectionId,
        queries: [
          { id: 'stuck', sql: 'SELECT 1', sourceId },
          { id: 'free', sql: 'SELECT 2' },
        ],
      });
      await jest.advanceTimersByTimeAsync(SQL_BATCH_DEADLINE_MS);
      const parsed = JSON.parse(textOf(await pending));

      expect(parsed.results[0]).toMatchObject({
        id: 'stuck',
        status: 'timeout',
      });
      expect(parsed.results[1]).toMatchObject({ id: 'free', status: 'ok' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('drops rows until the whole response fits the budget', async () => {
    // trimToolResponse keeps ten rows per result however large they are, so
    // ten such results would blow far past the batch budget on their own.
    const bigRow = { body: 'x'.repeat(2_000) };
    mockRunConfigTile.mockResolvedValue({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ result: { data: Array(10).fill(bigRow) } }),
        },
      ],
    });

    const result = await buildHandler()({
      connectionId,
      queries: Array.from({ length: 10 }, (_, i) => ({ sql: `SELECT ${i}` })),
    });

    const text = textOf(result);
    expect(text.length).toBeLessThanOrEqual(SQL_BATCH_RESPONSE_BUDGET);
    const parsed = JSON.parse(text);
    expect(parsed.summary.ok).toBe(10);
    for (const entry of parsed.results) {
      expect(entry.result.data.length).toBeGreaterThan(0);
      expect(entry.result.data.length).toBeLessThan(10);
      expect(entry.note).toContain('batch response size budget');
    }
  });

  it('leaves results under the budget untouched', async () => {
    const result = await buildHandler()({
      connectionId,
      queries: [{ sql: 'SELECT 1' }],
    });

    expect(JSON.parse(textOf(result)).results[0].note).toBeUndefined();
  });

  it(`runs at most ${SQL_BATCH_CONCURRENCY} queries at once`, async () => {
    let inFlight = 0;
    let peak = 0;
    mockRunConfigTile.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return rowsResult([]);
    });

    const result = await buildHandler()({
      connectionId,
      queries: Array.from({ length: 10 }, (_, i) => ({ sql: `SELECT ${i}` })),
    });

    expect(JSON.parse(textOf(result)).summary.ok).toBe(10);
    expect(peak).toBe(SQL_BATCH_CONCURRENCY);
  });

  it('times out queries past the shared deadline without starting queued ones', async () => {
    const base = 1_000_000_000_000;
    let now = base;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

    try {
      mockRunConfigTile.mockImplementation(
        (_team, tile: TileArg) =>
          new Promise(resolve =>
            setImmediate(() => {
              // Once every slot has started, the first query to finish moves
              // the clock past the budget, so the query still waiting for a
              // slot must fail without being issued.
              if (tile.config.sqlTemplate === 'SELECT 0') {
                now = base + 10 * 60_000;
              }
              resolve(rowsResult([]));
            }),
          ),
      );

      const queries = Array.from(
        { length: SQL_BATCH_CONCURRENCY + 1 },
        (_, i) => ({ sql: `SELECT ${i}` }),
      );
      const result = await buildHandler()({
        connectionId,
        queries,
        startTime: new Date(base - 60_000).toISOString(),
        endTime: new Date(base).toISOString(),
      });

      const parsed = JSON.parse(textOf(result));
      const last = parsed.results.at(-1);
      expect(last.status).toBe('timeout');
      expect(last.error).toContain('deadline');
      expect(parsed.summary.timeout).toBe(1);
      expect(tileArgs().map(c => c.sqlTemplate)).not.toContain(
        `SELECT ${SQL_BATCH_CONCURRENCY}`,
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('splits the response budget across the batch', async () => {
    await buildHandler()({
      connectionId,
      queries: Array.from({ length: 4 }, (_, i) => ({ sql: `SELECT ${i}` })),
    });

    for (const call of mockRunConfigTile.mock.calls) {
      expect(call[4]).toMatchObject({ maxResponseChars: 25_000 });
    }
  });

  it('caps a single query at the single-query response limit', async () => {
    await buildHandler()({
      connectionId,
      queries: [{ sql: 'SELECT 1' }],
    });

    expect(mockRunConfigTile.mock.calls[0][4]).toMatchObject({
      maxResponseChars: 50_000,
    });
  });
});
