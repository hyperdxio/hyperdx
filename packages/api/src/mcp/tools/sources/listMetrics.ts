import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { trace } from '@opentelemetry/api';
import { z } from 'zod';

import { ClickhouseClient } from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpServerError, mcpUserError } from '@/mcp/utils/errors';
import logger from '@/utils/logger';

import { KIND_TIMED_OUT_ERROR, scanKindsForPage } from './listMetricsPage';
import { enrichEntries, fetchMetricNames } from './listMetricsQueries';
import {
  decodeCursor,
  DEFAULT_LIMIT,
  encodeCursor,
  listMetricsSchema,
} from './listMetricsSchema';
import {
  DISCOVERABLE_METRIC_KINDS,
  type DiscoverableMetricKind,
} from './metricKinds';
import { parseTimeRange } from './metricTimeRange';

// Wall-clock budget for the whole call, matching the 30s cap the MCP query
// tools use.
const LIST_TIMEOUT_MS = 30_000;

// Time held back from the name scan for the unit/description lookup and
// response assembly. Kinds still scanning when it starts are reported as
// timed out and the kinds that finished are returned.
const ENRICH_RESERVE_MS = 4_000;

// Per-query ClickHouse caps. The names cap sits above the scan deadline
// (LIST_TIMEOUT_MS - ENRICH_RESERVE_MS) so a slow kind is aborted and
// reported as timed out, not cut short by ClickHouse. A partial name set
// would look complete and the cursor would skip the names never read.
const NAMES_MAX_EXEC_SECONDS = 28;
const ENRICH_MAX_EXEC_SECONDS = 3;

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerListMetrics({
  context,
  registerTool,
}: ToolRegistrar): void {
  const { teamId } = context;

  registerTool(
    'clickstack_list_metrics',
    {
      title: 'List Metric Names',
      annotations: { readOnlyHint: true },
      description:
        'DISCOVERY: Use this after clickstack_describe_source when you need more metric ' +
        'names than the per-kind sample shows, or when you want to narrow by ' +
        'kind / name pattern / time window. ' +
        'Returns paginated metric names per kind (gauge/sum/histogram/exponential histogram/summary) ' +
        'with optional unit and description (when the OTel-default columns are present). ' +
        'Pass the returned `nextCursor` back unchanged to fetch the next page.\n\n' +
        'Summary metrics are listed for discovery only — they cannot be passed to ' +
        'clickstack_timeseries / clickstack_table; query them with clickstack_sql ' +
        "against the table in the source's metricTables.summary.\n\n" +
        'Workflow: clickstack_list_sources → clickstack_describe_source → ' +
        'clickstack_list_metrics → clickstack_describe_metric → ' +
        'clickstack_timeseries|clickstack_table.',
      inputSchema: listMetricsSchema,
    },
    async rawInput => {
      // Re-parse explicitly: the MCP SDK callback signature widens
      // optional-field types into `unknown`, but the parser produces
      // the typed shape we need for downstream calls.
      const input: z.infer<typeof listMetricsSchema> =
        listMetricsSchema.parse(rawInput);

      const deadlineAt = Date.now() + LIST_TIMEOUT_MS;
      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error('LIST_METRICS_TIMEOUT'));
        }, LIST_TIMEOUT_MS);
      });

      try {
        return await Promise.race([
          listMetricsImpl(
            teamId.toString(),
            input,
            deadlineAt,
            controller.signal,
          ),
          timeoutPromise,
        ]);
      } catch (e) {
        if (e instanceof Error && e.message === 'LIST_METRICS_TIMEOUT') {
          logger.warn(
            { teamId, sourceId: input.sourceId },
            'clickstack_list_metrics timed out',
          );
          return mcpServerError(
            'clickstack_list_metrics timed out. Try narrowing the time window ' +
              '(startTime/endTime), pinning a single `kind`, or adding a namePattern filter.',
          );
        }
        throw e;
      } finally {
        clearTimeout(timeoutId);
      }
    },
  );
}

async function listMetricsImpl(
  teamId: string,
  input: z.infer<typeof listMetricsSchema>,
  deadlineAt: number,
  signal: AbortSignal,
) {
  const source = await getSource(teamId, input.sourceId);
  if (!source) {
    return mcpUserError(
      `Source "${input.sourceId}" not found. Call clickstack_list_sources to see available source IDs.`,
    );
  }
  if (source.kind !== SourceKind.Metric) {
    return mcpUserError(
      `Source "${input.sourceId}" is a "${source.kind}" source, not a metric source. clickstack_list_metrics only works on metric sources — call clickstack_list_sources to find one whose kind is "metric".`,
    );
  }

  const timeRange = parseTimeRange(input.startTime, input.endTime);
  if ('error' in timeRange) {
    return mcpUserError(timeRange.error);
  }
  const { startDate, endDate } = timeRange;

  // Decode cursor; reject silently and start over if malformed so a
  // truncated or tampered cursor does not surface internals.
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && !cursor) {
    return mcpUserError(
      'Invalid cursor. Omit cursor to start over, or pass the exact `nextCursor` value returned by a previous call.',
    );
  }

  // Resolve which kinds to scan, in order. When a cursor is set,
  // skip kinds before the cursor's kind (already returned) and start
  // the cursor's kind at the lastName-exclusive position.
  const requestedKinds: DiscoverableMetricKind[] = (
    input.kind ? [input.kind] : DISCOVERABLE_METRIC_KINDS
  ).filter(k => Boolean(source.metricTables[k]));
  const startKindIdx = cursor ? requestedKinds.indexOf(cursor.kind) : 0;
  if (startKindIdx < 0) {
    // Cursor points at a kind that's not in scope for this call —
    // safer to error than silently skip.
    return mcpUserError(
      `Cursor references kind "${cursor!.kind}" but that kind is not in scope for this call. Drop the kind filter or pass a matching cursor.`,
    );
  }

  const connection = await getConnectionById(
    teamId,
    source.connection.toString(),
    true,
  );
  if (!connection) {
    return mcpUserError(`Connection not found for source "${input.sourceId}".`);
  }

  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });
  const metadata = getMetadata(clickhouseClient);

  const limit = input.limit ?? DEFAULT_LIMIT;
  const databaseName = source.from.databaseName;

  const connectionId = source.connection.toString();

  // Kinds before the cursor's kind were already returned on earlier pages.
  const scanKinds = requestedKinds.slice(startKindIdx).map((kind, i) => ({
    kind,
    afterName: i === 0 ? cursor?.lastName : undefined,
  }));
  const page = await scanKindsForPage({
    kinds: scanKinds,
    limit,
    deadlineAt: deadlineAt - ENRICH_RESERVE_MS,
    signal,
    fetchNames: ({ kind, afterName }, kindSignal) =>
      fetchMetricNames({
        clickhouseClient,
        databaseName,
        tableName: source.metricTables[kind]!,
        connectionId,
        startDate,
        endDate,
        namePattern: input.namePattern,
        afterName,
        // One extra row detects that more names remain for this kind.
        limit: limit + 1,
        maxExecutionSeconds: NAMES_MAX_EXEC_SECONDS,
        signal: kindSignal,
      }),
  });
  for (const failure of page.partialFailure) {
    logger.warn(
      { sourceId: input.sourceId, kind: failure.kind, error: failure.error },
      'Failed to list metrics for kind',
    );
  }

  const enrichSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(Math.max(0, deadlineAt - Date.now() - 500)),
  ]);
  const metrics = await enrichEntries({
    entries: page.entries,
    clickhouseClient,
    metadata,
    databaseName,
    metricTables: source.metricTables,
    connectionId,
    startDate,
    endDate,
    maxExecutionSeconds: ENRICH_MAX_EXEC_SECONDS,
    signal: enrichSignal,
  });

  const nextCursor = page.next && encodeCursor(page.next);
  // Per-kind failures are surfaced so the agent can tell "kind has no
  // metrics" apart from "the fetch for that kind failed or timed out".
  const partialFailure = page.partialFailure;
  trace.getActiveSpan()?.setAttributes({
    'mcp.list_metrics.kinds_scanned': scanKinds.length,
    'mcp.list_metrics.kinds_failed': partialFailure.length,
    'mcp.list_metrics.kinds_timed_out': partialFailure.filter(
      f => f.error === KIND_TIMED_OUT_ERROR,
    ).length,
    'mcp.list_metrics.result_count': metrics.length,
  });

  const responseObj: Record<string, unknown> = {
    metrics,
    ...(nextCursor && { nextCursor }),
    ...(metrics.some(m => m.kind === 'summary') && {
      summaryNote:
        'summary metrics cannot be queried with clickstack_timeseries / clickstack_table — ' +
        "use clickstack_sql against the table in the source's metricTables.summary.",
    }),
    ...(partialFailure.length > 0 && {
      partialFailure,
      hint:
        'Listing failed for some metric kinds — results may be incomplete. ' +
        'Retry the call; if the failure persists, narrow startTime/endTime or pin a single `kind`.',
    }),
    ...(metrics.length === 0 &&
      partialFailure.length === 0 && {
        hint:
          'No metrics matched. Try widening the time window (startTime/endTime), ' +
          'removing the namePattern filter, or omitting `kind` to scan every populated metric table.',
      }),
    usage:
      'Pass `metricType` + `metricName` from each entry to clickstack_timeseries / clickstack_table ' +
      '(summary metrics excepted — query those with clickstack_sql). ' +
      'For per-metric attribute keys and sampled values, call clickstack_describe_metric.',
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(responseObj, null, 2),
      },
    ],
  };
}
