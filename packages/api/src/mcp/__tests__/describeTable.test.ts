const mockQuery = jest.fn();
const mockGetConnectionById = jest.fn();

jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({}));
jest.mock('@/controllers/connection', () => ({
  getConnectionById: (...args: unknown[]) => mockGetConnectionById(...args),
}));
jest.mock('@/clickhouse', () => ({
  ClickhouseClient: jest.fn(() => ({ query: mockQuery })),
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerDescribeTable } from '@/mcp/tools/sources/describeTable';
import {
  shapeTableDescription,
  shapeTableListEntry,
} from '@/mcp/tools/sources/describeTableQueries';
import {
  describeTableSchema,
  encodeTableListCursor,
  validateDescribeTableInput,
} from '@/mcp/tools/sources/describeTableSchema';
import type { RegisterToolFn, ToolResult } from '@/mcp/tools/types';
import { getErrorCategory, type McpErrorResult } from '@/mcp/utils/errors';

const CONNECTION_ID = '65f5e4a3b9e77c001a567890';

type QueryArgs = { query: string; query_params: Record<string, unknown> };

const queryCalls = (): QueryArgs[] =>
  mockQuery.mock.calls.map(([args]: [QueryArgs]) => args);

function respondWith(routes: Record<string, unknown[] | Error>) {
  mockQuery.mockImplementation(async ({ query: sql }: QueryArgs) => {
    const rows =
      Object.entries(routes).find(([fragment]) =>
        sql.includes(fragment),
      )?.[1] ?? [];
    if (rows instanceof Error) throw rows;
    return { json: async () => ({ data: rows }) };
  });
}

function getHandler() {
  let handler:
    | ((args: Record<string, unknown>) => Promise<ToolResult>)
    | undefined;
  const registerTool: RegisterToolFn = (_name, config, h) => {
    handler = args => h(config.inputSchema.parse(args));
  };
  registerDescribeTable({
    server: new McpServer({ name: 'test', version: '1.0.0' }),
    context: { teamId: 'team-1', userId: 'user-1' },
    registerTool,
  });
  return handler!;
}

function errorCategory(result: ToolResult) {
  const isMcpError = (r: ToolResult): r is ToolResult & McpErrorResult =>
    r.isError === true;
  return isMcpError(result) ? getErrorCategory(result) : undefined;
}

const parseText = (result: ToolResult) => JSON.parse(result.content[0].text);

const TABLE_ROW = {
  name: 'events',
  engine: 'MergeTree',
  sorting_key: 'ServiceName, Timestamp',
  primary_key: 'ServiceName',
  partition_key: 'toDate(Timestamp)',
  comment: '',
  total_rows: '1200',
  total_bytes: '34567',
};

const COLUMN_ROWS = [
  {
    name: 'Timestamp',
    type: 'DateTime64(9)',
    default_kind: '',
    default_expression: '',
    comment: '',
    is_in_sorting_key: 1,
    is_in_primary_key: 0,
  },
  {
    name: 'Day',
    type: 'Date',
    default_kind: 'MATERIALIZED',
    default_expression: 'toDate(Timestamp)',
    comment: 'partition day',
    is_in_sorting_key: 0,
    is_in_primary_key: 0,
  },
];

describe('clickstack_describe_table', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetConnectionById.mockReset().mockResolvedValue({
      host: 'http://localhost:8123',
      username: 'default',
      password: '',
    });
  });

  describe('input validation', () => {
    it('caps sampleRows at 5 and defaults it to 0', () => {
      expect(
        describeTableSchema.safeParse({
          connectionId: CONNECTION_ID,
          database: 'default',
          table: 't',
          sampleRows: 6,
        }).success,
      ).toBe(false);
      const parsed = describeTableSchema.parse({
        connectionId: CONNECTION_ID,
        database: 'default',
      });
      expect(parsed.sampleRows).toBe(0);
      expect(parsed.limit).toBe(50);
    });

    it('rejects an empty database name', () => {
      expect(
        describeTableSchema.safeParse({
          connectionId: CONNECTION_ID,
          database: '',
        }).success,
      ).toBe(false);
    });

    it('rejects sampleRows without a table and cursor with a table', () => {
      expect(
        validateDescribeTableInput({ sampleRows: 2, cursor: undefined }),
      ).toMatch(/sampleRows requires table/);
      expect(
        validateDescribeTableInput({ table: 't', sampleRows: 0, cursor: 'x' }),
      ).toMatch(/cursor only applies when listing/);
      expect(
        validateDescribeTableInput({ table: 't', sampleRows: 3 }),
      ).toBeNull();
    });

    it('returns a user error for a malformed connectionId without a lookup', async () => {
      const result = await getHandler()({
        connectionId: 'not-an-id',
        database: 'default',
      });
      expect(result.isError).toBe(true);
      expect(mockGetConnectionById).not.toHaveBeenCalled();
    });

    it('returns a user error when the connection is not in the team', async () => {
      mockGetConnectionById.mockResolvedValue(null);
      const result = await getHandler()({
        connectionId: CONNECTION_ID,
        database: 'default',
      });
      expect(result.isError).toBe(true);
      expect(mockGetConnectionById).toHaveBeenCalledWith(
        'team-1',
        CONNECTION_ID,
        true,
      );
    });
  });

  describe('output shaping', () => {
    it('shapes a table description from system table rows', () => {
      expect(
        shapeTableDescription({
          database: 'default',
          table: { ...TABLE_ROW, total_rows: null, total_bytes: null },
          columns: COLUMN_ROWS,
          indices: [{ name: 'idx_day', type: 'minmax', expr: 'Day' }],
        }),
      ).toEqual({
        table: {
          database: 'default',
          name: 'events',
          engine: 'MergeTree',
          sortingKey: 'ServiceName, Timestamp',
          primaryKey: 'ServiceName',
          partitionKey: 'toDate(Timestamp)',
          approxTotalRows: null,
          approxTotalBytes: null,
        },
        columns: [
          {
            name: 'Timestamp',
            type: 'DateTime64(9)',
            inSortingKey: true,
            inPrimaryKey: false,
          },
          {
            name: 'Day',
            type: 'Date',
            defaultKind: 'MATERIALIZED',
            defaultExpression: 'toDate(Timestamp)',
            comment: 'partition day',
            inSortingKey: false,
            inPrimaryKey: false,
          },
        ],
        dataSkippingIndices: [
          { name: 'idx_day', type: 'minmax', expression: 'Day' },
        ],
      });
    });

    it('converts quoted 64-bit row counts to numbers', () => {
      expect(
        shapeTableListEntry({
          name: 'events',
          engine: 'MergeTree',
          total_rows: '42',
        }),
      ).toEqual({ name: 'events', engine: 'MergeTree', approxRows: 42 });
    });

    it('binds database and table names as query parameters', async () => {
      respondWith({ 'FROM system.tables': [TABLE_ROW] });
      await getHandler()({
        connectionId: CONNECTION_ID,
        database: "evil'db",
        table: 'events`; DROP TABLE x',
      });
      for (const { query: sql, query_params } of queryCalls()) {
        expect(sql).not.toContain('evil');
        expect(sql).not.toContain('DROP');
        expect(Object.values(query_params)).toContain("evil'db");
      }
    });

    it('pages the table list with an opaque cursor', async () => {
      respondWith({
        'FROM system.tables': [
          { name: 'a', engine: 'MergeTree', total_rows: '1' },
          { name: 'b', engine: 'View', total_rows: null },
          { name: 'c', engine: 'MergeTree', total_rows: '3' },
        ],
      });
      const output = parseText(
        await getHandler()({
          connectionId: CONNECTION_ID,
          database: 'default',
          limit: 2,
        }),
      );
      expect(output.tables).toEqual([
        { name: 'a', engine: 'MergeTree', approxRows: 1 },
        { name: 'b', engine: 'View', approxRows: null },
      ]);
      expect(output.nextCursor).toBe(encodeTableListCursor({ lastName: 'b' }));
    });

    it('rejects a malformed cursor', async () => {
      const result = await getHandler()({
        connectionId: CONNECTION_ID,
        database: 'default',
        cursor: 'garbage',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Invalid cursor/);
    });

    it('reports a missing database as a user error', async () => {
      respondWith({});
      const result = await getHandler()({
        connectionId: CONNECTION_ID,
        database: 'nope',
      });
      expect(result.isError).toBe(true);
      expect(errorCategory(result)).toBe('user');
      expect(result.content[0].text).toMatch(/Database "nope" not found/);
    });

    it('reports a missing table as a user error', async () => {
      respondWith({});
      const result = await getHandler()({
        connectionId: CONNECTION_ID,
        database: 'default',
        table: 'nope',
      });
      expect(result.isError).toBe(true);
      expect(errorCategory(result)).toBe('user');
      expect(result.content[0].text).toMatch(/default\.nope" not found/);
    });

    it('maps permission errors to user errors with a hint', async () => {
      respondWith({
        'FROM system.columns': new Error(
          'Code: 497. DB::Exception: default: Not enough privileges. (ACCESS_DENIED)',
        ),
      });
      const result = await getHandler()({
        connectionId: CONNECTION_ID,
        database: 'default',
        table: 'events',
      });
      expect(result.isError).toBe(true);
      expect(errorCategory(result)).toBe('user');
      expect(result.content[0].text).toMatch(/lacks the privileges/);
    });

    it('skips sampling by default', async () => {
      respondWith({ 'FROM system.tables': [TABLE_ROW] });
      const output = parseText(
        await getHandler()({
          connectionId: CONNECTION_ID,
          database: 'default',
          table: 'events',
        }),
      );
      expect(output.sampleRows).toBeUndefined();
      expect(queryCalls().some(q => q.query.includes('SELECT *'))).toBe(false);
    });

    it('trims oversized sample rows', async () => {
      respondWith({
        'FROM system.tables': [TABLE_ROW],
        'SELECT *': [{ Body: 'x'.repeat(50_000) }, { Body: 'short' }],
      });
      const output = parseText(
        await getHandler()({
          connectionId: CONNECTION_ID,
          database: 'default',
          table: 'events',
          sampleRows: 2,
        }),
      );
      expect(output.sampleRows).toHaveLength(2);
      expect(output.sampleRows[0].__hdx_trimmed).toBe(true);
      expect(output.sampleRows[1]).toEqual({ Body: 'short' });
    });

    it('keeps the schema when sampling fails', async () => {
      respondWith({
        'FROM system.tables': [TABLE_ROW],
        'SELECT *': new Error('ACCESS_DENIED'),
      });
      const output = parseText(
        await getHandler()({
          connectionId: CONNECTION_ID,
          database: 'default',
          table: 'events',
          sampleRows: 1,
        }),
      );
      expect(output.table.name).toBe('events');
      expect(output.sampleRowsError).toBe('ACCESS_DENIED');
    });
  });
});
