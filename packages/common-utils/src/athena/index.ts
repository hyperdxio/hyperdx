/**
 * AWS Athena query client used by the Berg backend.
 *
 * The pod's IRSA identity is used implicitly — the AWS SDK picks up
 * credentials from the environment / instance metadata.  No credentials
 * appear in code or configuration here.
 *
 * Every query passes `ResultReuseConfiguration` so repeated queries hit
 * Athena's result cache when possible.
 */

import {
  AthenaClient as SdkAthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
} from '@aws-sdk/client-athena';

import { convertCellValue, convertTrinoTypeToJsType } from './typeMapping';
import {
  AthenaColumn,
  AthenaError,
  AthenaErrorCode,
  AthenaQueryResult,
  AthenaQueryStatus,
  ExecuteOptions,
} from './types';

export type { AthenaJsType } from './typeMapping';
export { convertCellValue, convertTrinoTypeToJsType } from './typeMapping';
export * from './types';

const STATE_MAP: Record<string, AthenaQueryStatus> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'finished',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const POLL_INITIAL_DELAY_MS = 250;
const POLL_MAX_DELAY_MS = 2000;
const POLL_BACKOFF_FACTOR = 1.5;

export interface AthenaClientOptions {
  region: string;
}

export class AthenaClient {
  private sdk: SdkAthenaClient;

  constructor(opts: AthenaClientOptions) {
    this.sdk = new SdkAthenaClient({ region: opts.region });
  }

  /**
   * Start a query, internally poll for completion up to `syncTimeoutMs`,
   * then return the rows.  If the timeout elapses before completion, the
   * caller gets back `{ executionId, status: 'running' }` so it can poll
   * via `getStatus` / `getResults` later.
   */
  async executeSync(
    sql: string,
    opts: ExecuteOptions,
  ): Promise<AthenaQueryResult> {
    const id = await this.startQuery(sql, opts);
    const finishedBy = Date.now() + (opts.syncTimeoutMs ?? 30000);
    let delay = POLL_INITIAL_DELAY_MS;
    while (Date.now() < finishedBy) {
      const status = await this.getStatus(id);
      if (status === 'finished') {
        return this.getResults(id);
      }
      if (status === 'failed' || status === 'cancelled') {
        throw await this.fetchExecutionError(id, status);
      }
      const remaining = finishedBy - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(delay, POLL_MAX_DELAY_MS, remaining));
      delay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY_MS);
    }
    return {
      rows: [],
      schema: [],
      scannedBytes: 0,
      executionId: id,
      status: 'running',
    };
  }

  /** Start a query and return its execution id immediately. */
  async executeAsync(
    sql: string,
    opts: ExecuteOptions,
  ): Promise<{ executionId: string }> {
    const executionId = await this.startQuery(sql, opts);
    return { executionId };
  }

  async getStatus(executionId: string): Promise<AthenaQueryStatus> {
    const r = await this.sdk.send(
      new GetQueryExecutionCommand({ QueryExecutionId: executionId }),
    );
    const state = r.QueryExecution?.Status?.State ?? 'QUEUED';
    return STATE_MAP[state] ?? 'queued';
  }

  /**
   * Fetch one page of results.  When `nextToken` is omitted Athena returns
   * the column header as the first row; we strip it.  When `nextToken` is
   * passed we keep all rows verbatim (subsequent pages don't repeat the
   * header).
   */
  async getResults(
    executionId: string,
    nextToken?: string,
  ): Promise<AthenaQueryResult> {
    const exec = await this.sdk.send(
      new GetQueryExecutionCommand({ QueryExecutionId: executionId }),
    );
    const scannedBytes = Number(
      exec.QueryExecution?.Statistics?.DataScannedInBytes ?? 0,
    );
    const state = exec.QueryExecution?.Status?.State ?? 'QUEUED';
    const status = STATE_MAP[state] ?? 'queued';

    const r = await this.sdk.send(
      new GetQueryResultsCommand({
        QueryExecutionId: executionId,
        NextToken: nextToken,
        MaxResults: 1000,
      }),
    );

    const colInfo = r.ResultSet?.ResultSetMetadata?.ColumnInfo ?? [];
    const schema: AthenaColumn[] = colInfo.map(c => ({
      name: c.Name ?? '',
      type: c.Type ?? 'varchar',
      jsType: convertTrinoTypeToJsType(c.Type ?? 'varchar'),
    }));

    const rawRows = r.ResultSet?.Rows ?? [];
    // First row of the first page is the column header repeat — skip it.
    const dataRows = nextToken == null ? rawRows.slice(1) : rawRows;
    const rows = dataRows.map(row => {
      const out: Record<string, unknown> = {};
      schema.forEach((col, i) => {
        out[col.name] = convertCellValue(
          row.Data?.[i]?.VarCharValue,
          col.jsType,
        );
      });
      return out;
    });

    return {
      rows,
      schema,
      scannedBytes,
      executionId,
      status,
      nextToken: r.NextToken,
    };
  }

  /** Stop a running query.  No-op if the query already finished. */
  async cancel(executionId: string): Promise<void> {
    await this.sdk.send(
      new StopQueryExecutionCommand({ QueryExecutionId: executionId }),
    );
  }

  private async startQuery(sql: string, opts: ExecuteOptions): Promise<string> {
    const r = await this.sdk.send(
      new StartQueryExecutionCommand({
        QueryString: sql,
        WorkGroup: opts.workgroup,
        ResultConfiguration: { OutputLocation: opts.outputLocation },
        ResultReuseConfiguration: {
          ResultReuseByAgeConfiguration: {
            Enabled: true,
            MaxAgeInMinutes: opts.resultReuseTtlMin ?? 60,
          },
        },
      }),
    );
    if (!r.QueryExecutionId)
      throw makeError('unknown', 'No QueryExecutionId returned');
    return r.QueryExecutionId;
  }

  private async fetchExecutionError(
    id: string,
    status: 'failed' | 'cancelled',
  ): Promise<AthenaError> {
    const exec = await this.sdk.send(
      new GetQueryExecutionCommand({ QueryExecutionId: id }),
    );
    const reason =
      exec.QueryExecution?.Status?.StateChangeReason ?? `Query ${status}`;
    return classifyAthenaError(reason);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function makeError(
  code: AthenaErrorCode,
  message: string,
  retryable = false,
): AthenaError {
  return Object.assign(new Error(message), {
    code,
    retryable,
  });
}

/**
 * Classify an Athena `StateChangeReason` (or other diagnostic message) into
 * one of our `AthenaErrorCode` buckets.  Only `throttled` (and `internal`)
 * are flagged as `retryable`; user errors surface directly so the UI can
 * show the message instead of spinning on a doomed retry loop.
 */
export function classifyAthenaError(message: string): AthenaError {
  const m = message.toLowerCase();
  if (m.includes('access denied') || m.includes('accessdenied')) {
    return makeError('access_denied', message, false);
  }
  if (
    m.includes('column') &&
    (m.includes('not exist') || m.includes('cannot be resolved'))
  ) {
    return makeError('column_not_found', message, false);
  }
  if (
    (m.includes('table') || m.includes('relation')) &&
    (m.includes('not found') || m.includes('does not exist'))
  ) {
    return makeError('table_not_found', message, false);
  }
  if (m.includes('syntax error')) {
    return makeError('syntax_error', message, false);
  }
  if (m.includes('throttl')) {
    return makeError('throttled', message, true);
  }
  if (m.includes('internalserverexception') || m.includes('internal error')) {
    return makeError('internal', message, true);
  }
  if (m.includes('timeout') || m.includes('timed out')) {
    return makeError('timeout', message, false);
  }
  return makeError('unknown', message, false);
}
