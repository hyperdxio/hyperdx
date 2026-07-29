import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import express from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

import { parseTimeRange } from '@/mcp/tools/query/helpers';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { processRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import {
  getCounter,
  getHistogram,
  recordDuration,
} from '@/utils/instrumentation';
import logger from '@/utils/logger';
import { externalDashboardSearchRequestSchema } from '@/utils/zod';

import { runSearchConfig, type SearchErrorCode } from './utils/search';

const searchQueryDuration = getHistogram('hyperdx.search.query.duration_ms', {
  description: 'Duration of external API v2 search queries against ClickHouse.',
  unit: 'ms',
});
const searchQueryErrors = getCounter('hyperdx.search.query_errors', {
  description:
    'Count of external API v2 search query failures, labeled by error type ' +
    '(semantic error codes like SOURCE_NOT_FOUND, or ClickHouse error types).',
});

// CH error types caused by user-supplied query content — map to 400.
const CH_USER_INPUT_ERRORS = new Set([
  'SYNTAX_ERROR',
  'UNKNOWN_IDENTIFIER',
  'UNKNOWN_TABLE',
  'UNKNOWN_FUNCTION',
  'UNKNOWN_AGGREGATE_FUNCTION',
  'UNKNOWN_TYPE',
  'BAD_ARGUMENTS',
  'CANNOT_CONVERT_TYPE',
  'THERE_IS_NO_COLUMN',
  'NO_COMMON_TYPE',
  'ILLEGAL_TYPE_OF_ARGUMENT',
]);

/**
 * @openapi
 * components:
 *   schemas:
 *     SearchRequest:
 *       type: object
 *       required:
 *         - sourceId
 *       properties:
 *         sourceId:
 *           type: string
 *           description: |
 *             Source ID to query. Call GET /api/v2/sources to list available sources.
 *             The source determines the underlying ClickHouse table (e.g. otel.otel_logs,
 *             otel.otel_traces) and its column schema.
 *           example: "69b46cb0d964ce2d0b9506a8"
 *         startTime:
 *           type: string
 *           format: date-time
 *           description: >
 *             Start of the query window (ISO 8601). Defaults to 15 minutes before
 *             endTime. Must be before endTime.
 *           example: "2026-05-10T00:00:00Z"
 *         endTime:
 *           type: string
 *           format: date-time
 *           description: End of the query window (ISO 8601). Defaults to now.
 *           example: "2026-05-10T01:00:00Z"
 *         where:
 *           type: string
 *           maxLength: 8192
 *           default: ""
 *           description: |
 *             Row filter expression. The language is controlled by whereLanguage.
 *
 *             Lucene examples (default):
 *               SeverityText:ERROR
 *               pipedream.pipeline_name:my-pipeline AND SeverityText:ERROR
 *               Body:timeout
 *
 *             SQL examples (whereLanguage: "sql"):
 *               SeverityText = 'ERROR'
 *               `pipedream.pipeline_name` = 'my-pipeline'
 *           example: "SeverityText:ERROR"
 *         whereLanguage:
 *           type: string
 *           enum: [lucene, sql]
 *           example: lucene
 *           default: lucene
 *           description: Language used for the where filter. Default is lucene.
 *         select:
 *           type: string
 *           maxLength: 4096
 *           default: ""
 *           description: |
 *             Comma-separated list of ClickHouse column expressions to include in
 *             each result row. When omitted the source's default select expression
 *             is used.
 *
 *             Each entry is a ClickHouse SQL expression executed under the team's
 *             database user. Semicolons and subqueries (SELECT keyword) are
 *             rejected; use column references, map lookups, or function calls only.
 *
 *             HyperDX rewrites known attribute column names to their materialized
 *             equivalents automatically; you can still pass the logical name.
 *           example: "Timestamp,SeverityText,Body,pipedream.pipeline_name"
 *         orderBy:
 *           type: string
 *           maxLength: 1024
 *           description: |
 *             ClickHouse ORDER BY expression. When omitted the source's default
 *             ordering (typically timestamp DESC) is used.
 *           example: "Timestamp DESC"
 *         maxResults:
 *           type: integer
 *           minimum: 1
 *           maximum: 2000
 *           default: 100
 *           description: Maximum number of rows to return. Default is 100, max is 2000.
 *         offset:
 *           type: integer
 *           minimum: 0
 *           maximum: 10000
 *           default: 0
 *           description: |
 *             Number of rows to skip (best-effort offset pagination). Default is
 *             0, max is 10000. Offset pagination is non-deterministic when
 *             multiple rows share the same timestamp; for reliable deep paging
 *             filter by the last Timestamp value returned in the previous page
 *             instead of using a large offset.
 *
 *     SearchRow:
 *       type: object
 *       description: >
 *         A single result row. Keys correspond to the requested columns (or the
 *         source default columns when columns was omitted). Values are strings
 *         or numbers as returned by ClickHouse.
 *       additionalProperties: true
 *
 *     SearchResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           description: Array of result rows. Each row is an object with keys corresponding to the requested columns.
 *           items:
 *             $ref: '#/components/schemas/SearchRow'
 *         rows:
 *           type: integer
 *           description: Number of rows in this response (not total matching rows).
 */

// Rejects semicolons and SELECT subqueries in column expressions.
// Word-boundary anchor prevents blocking identifiers like "selectId".
const DISALLOWED_COLUMNS_PATTERN = /;|(?<!\w)SELECT\s/i;

function validateColumnsExpression(value: string): boolean {
  if (!value) return true;
  return !DISALLOWED_COLUMNS_PATTERN.test(value);
}

const searchRequestSchema = z.object({
  sourceId: z
    .string()
    .min(1, { message: 'sourceId is required' })
    .refine(val => ObjectId.isValid(val), {
      message: 'sourceId must be a valid ObjectId',
    })
    .describe(
      'Source ID to query. Call GET /api/v2/sources to list available sources.',
    ),
  startTime: z
    .string()
    .optional()
    .describe(
      'Start of the query window as ISO 8601. Default: 15 minutes ago.',
    ),
  endTime: z
    .string()
    .optional()
    .describe('End of the query window as ISO 8601. Default: now.'),
  where: z
    .string()
    .max(8 * 1024)
    .optional()
    .default('')
    .describe(
      'Row filter in Lucene syntax (default) or SQL (set whereLanguage: "sql"). ' +
        'Examples: "SeverityText:ERROR", "pipedream.pipeline_name:my-pipeline AND SeverityText:ERROR"',
    ),
  whereLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .default('lucene')
    .describe('Language for the where filter. Default: lucene'),
  select: z
    .string()
    .max(4 * 1024)
    .optional()
    .default('')
    .refine(validateColumnsExpression, {
      message:
        'select must not contain semicolons or SELECT subqueries; ' +
        'use column references, map lookups, or scalar functions only',
    })
    .describe(
      'Comma-separated list of column expressions to return. ' +
        'When omitted the source default columns are used. ' +
        'Named attribute columns such as "pipedream.pipeline_name" or "k8s.pod.name" ' +
        'are automatically rewritten to their materialized equivalents when available.',
    ),
  orderBy: z
    .string()
    .max(1024)
    .optional()
    .describe(
      'ORDER BY expression. Defaults to the source timestamp expression DESC.',
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .default(100)
    .describe('Maximum rows to return (1-2000). Default: 100.'),
  offset: z
    .number()
    .int()
    .min(0)
    .max(10_000)
    .optional()
    .default(0)
    .describe(
      'Number of rows to skip for pagination (0-10000). Default: 0. ' +
        'Prefer timestamp-cursor pagination for large datasets.',
    ),
});

/**
 * @openapi
 * /api/v2/search:
 *   post:
 *     summary: Search Raw Logs and Traces
 *     description: |
 *       Fetch individual log or trace rows from a HyperDX source.
 *
 *       This endpoint mirrors the "search" panel mode in the HyperDX UI.
 *       HyperDX applies the same query optimizations used in the UI:
 *         - Named attribute columns (e.g. "pipedream.pipeline_name") are
 *           rewritten to their indexed materialized equivalents when the
 *           source schema exposes them, avoiding slow Map lookups.
 *         - Rows are ordered by timestamp descending (most recent first).
 *         - The source's built-in PREWHERE / partition pruning is applied.
 *
 *       Authentication: Bearer token (personal API key from Team Settings).
 *     operationId: searchEvents
 *     tags: [Search]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SearchRequest'
 *           examples:
 *             recentErrors:
 *               summary: Recent errors for a service
 *               value:
 *                 sourceId: "69b46cb0d964ce2d0b9506a8"
 *                 startTime: "2026-05-10T00:00:00Z"
 *                 endTime: "2026-05-10T01:00:00Z"
 *                 where: "SeverityText:ERROR"
 *                 select: "Timestamp,SeverityText,Body,ServiceName"
 *                 maxResults: 50
 *             pipedreamTaskLogs:
 *               summary: Pipedream task logs with materialized column filter
 *               value:
 *                 sourceId: "69b46cb0d964ce2d0b9506a8"
 *                 startTime: "2026-05-10T00:00:00Z"
 *                 endTime: "2026-05-10T01:00:00Z"
 *                 where: "pipedream.pipeline_name:my-pipeline"
 *                 select: "Timestamp,SeverityText,Body,pipedream.pipeline_name,pipedream.stage_name,pipedream.task_index"
 *                 maxResults: 200
 *             traceSearch:
 *               summary: Slow spans for a service
 *               value:
 *                 sourceId: "69b46cb0d964ce2d0b9508b2"
 *                 startTime: "2026-05-10T00:00:00Z"
 *                 endTime: "2026-05-10T01:00:00Z"
 *                 where: "ServiceName:my-service AND Duration:>1000000000"
 *                 select: "Timestamp,TraceId,SpanId,SpanName,ServiceName,Duration,StatusCode"
 *                 maxResults: 100
 *             paginated:
 *               summary: Paginated fetch
 *               value:
 *                 sourceId: "69b46cb0d964ce2d0b9506a8"
 *                 startTime: "2026-05-10T00:00:00Z"
 *                 endTime: "2026-05-10T01:00:00Z"
 *                 maxResults: 100
 *                 offset: 100
 *     responses:
 *       '200':
 *         description: Matching rows returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SearchResponse'
 *             example:
 *               data:
 *                 - Timestamp: "2026-05-10T00:01:23.456789000Z"
 *                   SeverityText: "ERROR"
 *                   Body: "connection refused: redis:6379"
 *                   ServiceName: "api-service"
 *               rows: 1
 *       '400':
 *         description: Invalid request parameters or query error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       '401':
 *         description: Missing or invalid API key
 *       '404':
 *         description: Source or connection not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 */

function codeToStatus(code: SearchErrorCode): number {
  switch (code) {
    case 'SOURCE_NOT_FOUND':
    case 'CONNECTION_NOT_FOUND':
      return 404;
    default: {
      const _exhaustive: never = code;
      void _exhaustive;
      return 500;
    }
  }
}

const router = express.Router();

router.post(
  '/',
  validateRequest({ body: searchRequestSchema }),
  async (req, res) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const {
        sourceId,
        startTime,
        endTime,
        where,
        whereLanguage,
        select,
        orderBy,
        maxResults,
        offset,
      } = req.body;

      const timeRange = parseTimeRange(startTime, endTime);
      if ('error' in timeRange) {
        return res.status(400).json({ message: timeRange.error });
      }
      const { startDate, endDate } = timeRange;

      const config = externalDashboardSearchRequestSchema.parse({
        displayType: 'search' as const,
        sourceId,
        select,
        where,
        whereLanguage,
        orderBy,
      });

      const result = await recordDuration(searchQueryDuration, () =>
        runSearchConfig({
          teamId: teamId.toString(),
          config,
          startDate,
          endDate,
          maxResults,
          offset,
        }),
      );

      if (result.isError) {
        searchQueryErrors.add(1, { error_type: result.code });
        return res
          .status(codeToStatus(result.code))
          .json({ message: result.message });
      }

      return res.json({ data: result.data, rows: result.data.length });
    } catch (err) {
      if (err instanceof ClickHouseQueryError) {
        const chType = ((err.cause as Record<string, unknown> | undefined)
          ?.type ?? 'UNKNOWN') as string;
        const safeMsg =
          (err.message.split('\n')[0] ?? '').slice(0, 300) || 'Query error';
        searchQueryErrors.add(1, { error_type: chType });
        logger.error({ chType, safeMsg }, '[search] ClickHouse query error');

        if (CH_USER_INPUT_ERRORS.has(chType)) {
          return res.status(400).json({ message: `${chType}: ${safeMsg}` });
        }
        return res.status(500).json({ message: 'Query execution failed' });
      }

      const rawCode =
        err != null && typeof err === 'object'
          ? (err as Record<string, unknown>).statusCode
          : undefined;
      const statusCode =
        typeof rawCode === 'number' && rawCode >= 400 && rawCode <= 599
          ? rawCode
          : 500;
      if (statusCode >= 500) {
        logger.error({ err }, '[search] unexpected error');
        return res
          .status(statusCode)
          .json({ message: 'Internal server error' });
      }
      const msg = err instanceof Error ? err.message : 'Request failed';
      return res.status(statusCode).json({ message: msg });
    }
  },
);

export default router;
