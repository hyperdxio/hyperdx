import PQueue from '@esm2cjs/p-queue';
import { trace } from '@opentelemetry/api';

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

/** Total serialized size budget split evenly across the batch's results. */
const SQL_BATCH_RESPONSE_BUDGET = 100_000;
const SQL_SINGLE_RESPONSE_LIMIT = 50_000;

const batchQueryCounter = getCounter('hyperdx.mcp.sql.batch.queries', {
  description: 'Queries run by clickstack_sql in batch mode, by outcome.',
});

export type SqlBatchQuery = {
  id?: string;
  sql: string;
  connectionId?: string;
  sourceId?: string;
};

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
        const prepared = await prepareSqlQuery(
          {
            sql: query.sql,
            connectionId: query.connectionId ?? defaults.connectionId,
            sourceId: query.sourceId ?? defaults.sourceId,
          },
          lookupSource,
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
  let trimmed = 0;
  for (const entry of results) {
    summary[entry.status] += 1;
    if (entry.note !== undefined) trimmed += 1;
    batchQueryCounter.add(1, { status: entry.status });
  }
  trace.getActiveSpan()?.setAttributes({
    'mcp.sql.batch.size': summary.total,
    'mcp.sql.batch.ok': summary.ok,
    'mcp.sql.batch.error': summary.error,
    'mcp.sql.batch.timeout': summary.timeout,
    'mcp.sql.batch.trimmed': trimmed,
  });

  const text = JSON.stringify({ summary, results }, null, 2);
  if (summary.ok === 0) {
    return mcpUserError(text);
  }
  return { content: [{ type: 'text', text }] };
}
