import PQueue from '@esm2cjs/p-queue';
import { trace } from '@opentelemetry/api';
import { z } from 'zod';

import type { ToolResult } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import { DeadlineExceededError, withDeadline } from '@/mcp/utils/timeout';
import { getCounter } from '@/utils/instrumentation';

import { runConfigTile } from './helpers';
import { createSourceLookup, prepareSqlQuery } from './prepareSql';

export const MAX_SQL_BATCH_QUERIES = 10;

/** @internal Exported for testing only. */
export const SQL_BATCH_CONCURRENCY = 5;

/**
 * Whole-call budget shared by every query in the batch. Each query still has
 * ClickHouse's own max_execution_time; this bounds the call as a whole so a
 * queue of slow queries cannot run past the client's patience.
 */
export const SQL_BATCH_DEADLINE_MS = 60_000;

/**
 * Serialized size budget for the whole batch response. It is split evenly
 * across queries up front, then enforced on the final payload, because
 * trimToolResponse keeps at least ten rows per result whatever their size.
 */
export const SQL_BATCH_RESPONSE_BUDGET = 100_000;
const SQL_SINGLE_RESPONSE_LIMIT = 50_000;

const batchQueryCounter = getCounter('hyperdx.mcp.sql.batch.queries', {
  description: 'Queries run by clickstack_sql in batch mode, by outcome.',
});

const BATCH_TRIM_NOTE =
  'Rows were dropped to fit the batch response size budget. Narrow the time ' +
  'range, add filters, or run fewer queries per call.';

export const sqlBatchQuerySchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "Label echoed back on this query's result. Results also carry their array index.",
    ),
  sql: z
    .string()
    .describe('Raw ClickHouse SQL, with the same macros as the sql field.'),
  connectionId: z
    .string()
    .optional()
    .describe('Overrides the top-level connectionId for this query.'),
  sourceId: z
    .string()
    .optional()
    .describe(
      'Overrides the top-level sourceId for this query, so $__sourceTable expands to it.',
    ),
});

export type SqlBatchQuery = z.infer<typeof sqlBatchQuerySchema>;

type SqlBatchStatus = 'ok' | 'error' | 'timeout';

type SqlBatchEntry = {
  index: number;
  id?: string;
  status: SqlBatchStatus;
  error?: string;
  [key: string]: unknown;
};

function textOf(result: ToolResult): string {
  const block = result.content?.[0];
  return block?.type === 'text' ? block.text : '';
}

/**
 * Lift the `{ result, note?, hints? }` payload runConfigTile serialized back
 * into an object so it nests in the batch response instead of as a string.
 */
function parsePayload(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed != null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return { ...parsed };
    }
  } catch {
    // Fall through to the raw text.
  }
  return { raw: text };
}

/** The row array of an ok entry: `result` itself, or ClickHouse's `result.data`. */
function rowsOf(entry: SqlBatchEntry): unknown[] | undefined {
  const { result } = entry;
  if (Array.isArray(result)) return result;
  if (
    result != null &&
    typeof result === 'object' &&
    'data' in result &&
    Array.isArray(result.data)
  ) {
    return result.data;
  }
  return undefined;
}

function setRows(entry: SqlBatchEntry, rows: unknown[]) {
  const { result } = entry;
  entry.result =
    result != null && typeof result === 'object' && !Array.isArray(result)
      ? { ...result, data: rows }
      : rows;
  entry.note = BATCH_TRIM_NOTE;
}

/**
 * Halve the rows of the largest result until the serialized payload fits the
 * budget, or no rows are left to drop.
 */
function fitToBudget(
  payload: { results: SqlBatchEntry[] },
  budget: number,
): void {
  const sizeOf = (value: unknown) => JSON.stringify(value, null, 2).length;
  while (sizeOf(payload) > budget) {
    let target: SqlBatchEntry | undefined;
    let targetSize = 0;
    for (const entry of payload.results) {
      if (!rowsOf(entry)?.length) continue;
      const size = sizeOf(entry);
      if (size > targetSize) {
        target = entry;
        targetSize = size;
      }
    }
    if (!target) return;
    const rows = rowsOf(target) ?? [];
    setRows(target, rows.slice(0, Math.floor(rows.length / 2)));
  }
}

export async function runSqlBatch({
  teamId,
  queries,
  defaults,
  startDate,
  endDate,
}: {
  teamId: string;
  queries: SqlBatchQuery[];
  defaults: { connectionId: string; sourceId?: string };
  startDate: Date;
  endDate: Date;
}): Promise<ToolResult> {
  const seenIds = new Set<string>();
  for (const { id } of queries) {
    if (id === undefined) continue;
    if (seenIds.has(id)) {
      return mcpUserError(
        `Duplicate query id "${id}". Give each query in queries a unique id, or omit it.`,
      );
    }
    seenIds.add(id);
  }

  const maxResponseChars = Math.min(
    SQL_SINGLE_RESPONSE_LIMIT,
    Math.floor(SQL_BATCH_RESPONSE_BUDGET / queries.length),
  );
  const lookupSource = createSourceLookup(teamId);
  const queue = new PQueue({ concurrency: SQL_BATCH_CONCURRENCY });
  // Fixed before anything is queued so every query races the same budget.
  const deadlineAt = Date.now() + SQL_BATCH_DEADLINE_MS;

  const results = await Promise.all(
    queries.map(async (query, index): Promise<SqlBatchEntry> => {
      const base = {
        index,
        ...(query.id !== undefined ? { id: query.id } : {}),
      };
      try {
        const prepared = await withDeadline(
          () =>
            prepareSqlQuery(
              {
                sql: query.sql,
                connectionId: query.connectionId ?? defaults.connectionId,
                sourceId: query.sourceId ?? defaults.sourceId,
              },
              lookupSource,
            ),
          deadlineAt,
        );
        if ('error' in prepared) {
          return { ...base, status: 'error', error: textOf(prepared.error) };
        }

        const result: ToolResult = await queue.add(() =>
          withDeadline(
            signal =>
              runConfigTile(teamId, prepared.tile, startDate, endDate, {
                abortSignal: signal,
                maxResponseChars,
                lookupSource,
              }),
            deadlineAt,
          ),
        );
        if (result.isError) {
          return { ...base, status: 'error', error: textOf(result) };
        }
        return { ...base, status: 'ok', ...parsePayload(textOf(result)) };
      } catch (err) {
        if (err instanceof DeadlineExceededError) {
          return { ...base, status: 'timeout', error: err.message };
        }
        return {
          ...base,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const summary = { total: results.length, ok: 0, error: 0, timeout: 0 };
  for (const entry of results) {
    summary[entry.status] += 1;
    batchQueryCounter.add(1, { status: entry.status });
  }
  const payload = { summary, results };
  fitToBudget(payload, SQL_BATCH_RESPONSE_BUDGET);
  const trimmed = results.filter(entry => entry.note !== undefined).length;
  trace.getActiveSpan()?.setAttributes({
    'mcp.sql.batch.size': summary.total,
    'mcp.sql.batch.ok': summary.ok,
    'mcp.sql.batch.error': summary.error,
    'mcp.sql.batch.timeout': summary.timeout,
    'mcp.sql.batch.trimmed': trimmed,
  });

  const text = JSON.stringify(payload, null, 2);
  if (summary.ok === 0) {
    return mcpUserError(text);
  }
  return { content: [{ type: 'text', text }] };
}
