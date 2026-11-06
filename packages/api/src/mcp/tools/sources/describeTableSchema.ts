import { z } from 'zod';

import {
  decodeCursor as decodeCursorPayload,
  encodeCursor as encodeCursorPayload,
} from '@/utils/pagination';

const DEFAULT_TABLE_LIST_LIMIT = 50;
const MAX_TABLE_LIST_LIMIT = 500;
export const MAX_SAMPLE_ROWS = 5;

const tableListCursorSchema = z.object({ lastName: z.string() });

export type TableListCursor = z.infer<typeof tableListCursorSchema>;

export function encodeTableListCursor(payload: TableListCursor): string {
  return encodeCursorPayload(payload);
}

export function decodeTableListCursor(raw: string): TableListCursor | null {
  return decodeCursorPayload(raw, tableListCursorSchema);
}

export const describeTableSchema = z.object({
  connectionId: z
    .string()
    .describe(
      'Connection to inspect. Call clickstack_list_sources to find connection IDs.',
    ),
  database: z.string().min(1).describe('ClickHouse database name.'),
  table: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Table to describe. Omit to list the tables in the database instead.',
    ),
  sampleRows: z
    .number()
    .int()
    .min(0)
    .max(MAX_SAMPLE_ROWS)
    .optional()
    .default(0)
    .describe(
      `Number of rows to sample from the table (0-${MAX_SAMPLE_ROWS}). Only valid with table. Default: 0.`,
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_TABLE_LIST_LIMIT)
    .optional()
    .default(DEFAULT_TABLE_LIST_LIMIT)
    .describe(
      'Maximum tables returned per page when listing. Use cursor to fetch further pages.',
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      'Opaque pagination cursor returned by a previous listing call as `nextCursor`. ' +
        'Pass it back unchanged to get the next page.',
    ),
});

export type DescribeTableInput = z.infer<typeof describeTableSchema>;

/**
 * Checks the option combinations a flat Zod object cannot express. Returns an
 * error message, or null when the input is consistent.
 */
export function validateDescribeTableInput(
  input: Pick<DescribeTableInput, 'table' | 'sampleRows' | 'cursor'>,
): string | null {
  if (input.table == null && input.sampleRows > 0) {
    return 'sampleRows requires table. Pass a table name, or omit sampleRows to list tables.';
  }
  if (input.table != null && input.cursor) {
    return 'cursor only applies when listing tables. Omit table to page through the table list, or omit cursor to describe the table.';
  }
  return null;
}
