import { useQuery } from '@tanstack/react-query';

import { hdxServer } from '@/api';

export type AthenaJsTypeLabel =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'array'
  | 'map'
  | 'row'
  | 'json'
  | 'unknown';

export interface AthenaColumn {
  name: string;
  type: string;
  jsType: AthenaJsTypeLabel;
}

export interface AthenaQueryResult {
  rows: Record<string, unknown>[];
  schema: AthenaColumn[];
  scannedBytes: number;
  executionId: string;
  status: 'queued' | 'running' | 'finished' | 'failed' | 'cancelled';
  nextToken?: string;
}

interface UseRunQueryOptions {
  /** Stable cache key suffix; used to keep different callers separate. */
  key: string;
  sql: string | null | undefined;
  /** Optional Source ownership check on the API side. */
  sourceId?: string;
  enabled?: boolean;
}

/**
 * Runs a SELECT against `/api/v1/query`. The endpoint returns the full
 * result set when the query finishes inside the sync window, or
 * `{ executionId, status: 'running' }` if it's still going — callers that
 * care about long-running queries should use the dedicated polling hook
 * Task 9 will introduce. For Catalog's Sample/Stats tabs the queries are
 * tiny and finish well inside the sync window.
 */
export function useRunQuery({
  key,
  sql,
  sourceId,
  enabled = true,
}: UseRunQueryOptions) {
  return useQuery<AthenaQueryResult>({
    queryKey: ['runQuery', key, sql, sourceId ?? null],
    enabled: enabled && !!sql,
    queryFn: () =>
      hdxServer('v1/query', {
        method: 'POST',
        json: { sql, sourceId },
      }).json<AthenaQueryResult>(),
  });
}
