/**
 * Query lifecycle controller for the Berg backend.
 *
 * Every public entry point goes through `startQuery`, which enforces:
 *   1. SELECT-only in v1 — write SQL is rejected with `forbidden_write`
 *      before it ever reaches Athena.
 *   2. Team isolation — when a `sourceId` is supplied it must belong to the
 *      requesting user's team or the query is refused with
 *      `source_not_found` (mapped to HTTP 404).
 *
 * The Athena and Glue clients are instantiated once per process; the AWS
 * SDK transparently reuses HTTP/2 connections, and the lambda-style "new
 * client per request" pattern would defeat that.
 */

import { AthenaClient } from '@berg/common-utils/dist/athena';

import * as cfg from '@/config';
import { Source } from '@/models/source';
import { classifyQuery } from '@/utils/queryClassifier';

const athena = new AthenaClient({ region: cfg.ATHENA_REGION });

export interface StartQueryOptions {
  sql: string;
  teamId: string;
  sourceId?: string;
}

/**
 * Start a query and either return its full result set (sync path) or a
 * `{ executionId, status: 'running' }` handoff (async path) when the
 * configured sync timeout elapses before completion.
 */
export async function startQuery(opts: StartQueryOptions) {
  if (classifyQuery(opts.sql) === 'write') {
    const e: Error & { code?: string } = new Error(
      'Write operations are not permitted in v1',
    );
    e.code = 'forbidden_write';
    throw e;
  }

  // Default catalog/database for Athena's QueryExecutionContext: when the
  // caller passes a sourceId (or explicit catalog/database in the body
  // post-Phase-1.3) we use the Source's federated catalog so the SQL can
  // reference tables as `"db"."table"` without three-part qualification.
  // Falls back to the deployment-wide GLUE_CATALOG_ID when no Source is
  // attached to the query (e.g. SQL editor).
  //
  // Glue catalog IDs may be `<account>:<name>` (e.g.
  // `<aws-account-id>:s3tablescatalog/<catalog-name>`); Athena's
  // `QueryExecutionContext.Catalog` wants the name without the account
  // prefix. Strip when present.
  const toAthenaCatalogName = (id: string): string => {
    const idx = id.indexOf(':');
    return idx > 0 ? id.slice(idx + 1) : id;
  };
  let catalog: string | undefined = toAthenaCatalogName(cfg.GLUE_CATALOG_ID);
  let database: string | undefined;

  if (opts.sourceId) {
    const source = await Source.findOne({
      _id: opts.sourceId,
      team: opts.teamId,
    });
    if (!source) {
      const e: Error & { code?: string } = new Error(
        'Source not found or not accessible',
      );
      e.code = 'source_not_found';
      throw e;
    }
    catalog = source.catalog ? toAthenaCatalogName(source.catalog) : catalog;
    database = source.database || undefined;
    // Update lastQueriedAt; intentionally non-blocking — surfacing a write
    // failure here would mask the actual query result the caller is after.
    Source.updateOne(
      { _id: source._id },
      { $set: { lastQueriedAt: new Date() } },
    ).catch(() => {});
  }

  return athena.executeSync(opts.sql, {
    workgroup: cfg.ATHENA_WORKGROUP,
    outputLocation: cfg.ATHENA_OUTPUT_LOCATION,
    region: cfg.ATHENA_REGION,
    syncTimeoutMs: cfg.ATHENA_SYNC_TIMEOUT_MS,
    resultReuseTtlMin: cfg.ATHENA_RESULT_REUSE_TTL_MIN,
    catalog,
    database,
  });
}

export function getQueryStatus(executionId: string) {
  return athena.getStatus(executionId);
}

export function getQueryResults(executionId: string, nextToken?: string) {
  return athena.getResults(executionId, nextToken);
}

export function cancelQuery(executionId: string) {
  return athena.cancel(executionId);
}
