export type AthenaQueryStatus =
  | 'queued'
  | 'running'
  | 'finished'
  | 'failed'
  | 'cancelled';

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
  /** Column name as returned by Athena */
  name: string;
  /** Raw Trino type string (e.g. "varchar", "decimal(10,2)") */
  type: string;
  /** Mapped JS type label (string|number|boolean|date|array|map|row|json|unknown) */
  jsType: AthenaJsTypeLabel;
}

export interface AthenaQueryResult {
  rows: Record<string, unknown>[];
  schema: AthenaColumn[];
  scannedBytes: number;
  executionId: string;
  status: AthenaQueryStatus;
  /** Token for fetching the next page of results, if any. */
  nextToken?: string;
}

export interface ExecuteOptions {
  workgroup: string;
  outputLocation: string;
  region: string;
  /**
   * Catalog (and optional database) to set as Athena's
   * `QueryExecutionContext`.  When set, SQL identifiers don't need to
   * three-part-qualify the catalog — `"db"."table"` resolves under
   * this catalog.  Required for federated catalogs like
   * `s3tablescatalog/<bucket>` whose names contain characters Athena
   * doesn't accept inside quoted SQL identifiers.
   */
  catalog?: string;
  database?: string;
  /**
   * How long Athena's `ResultReuseByAgeConfiguration` allows a cached result
   * to be reused.  Defaults to 60 minutes when omitted.
   */
  resultReuseTtlMin?: number;
  /**
   * Maximum time `executeSync` will poll before falling back to a "running"
   * result.  Defaults to 30000ms when omitted.  Only used by `executeSync`.
   */
  syncTimeoutMs?: number;
  /** Optional abort signal forwarded to the underlying SDK calls. */
  signal?: AbortSignal;
}

export type AthenaErrorCode =
  | 'access_denied'
  | 'column_not_found'
  | 'syntax_error'
  | 'table_not_found'
  | 'throttled'
  | 'internal'
  | 'timeout'
  | 'unknown';

export interface AthenaError extends Error {
  code: AthenaErrorCode;
  /**
   * `true` when the Athena/Trino error class is safe to retry (currently
   * `ThrottlingException` and `InternalServerException`).  `false` for user
   * errors (syntax, AccessDenied, missing column/table).
   */
  retryable: boolean;
}
