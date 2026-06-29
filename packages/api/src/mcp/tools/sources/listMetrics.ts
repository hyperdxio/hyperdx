import {
  chSql,
  concatChSql,
  tableExpr,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import type { McpContext } from '@/mcp/tools/types';
import { withToolTracing } from '@/mcp/utils/tracing';
import logger from '@/utils/logger';

import {
  QUERYABLE_METRIC_KINDS,
  type QueryableMetricKind,
} from './metricKinds';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// ─── Cursor ──────────────────────────────────────────────────────────────────

export type ListMetricsCursorPayload = {
  kind: QueryableMetricKind;
  lastName: string;
};

/** @internal Exported for testing. */
export function encodeCursor(payload: ListMetricsCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/** @internal Exported for testing. */
export function decodeCursor(raw: string): ListMetricsCursorPayload | null {
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.kind === 'string' &&
      typeof parsed.lastName === 'string' &&
      (QUERYABLE_METRIC_KINDS as readonly string[]).includes(parsed.kind)
    ) {
      return {
        kind: parsed.kind as QueryableMetricKind,
        lastName: parsed.lastName,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const listMetricsSchema = z.object({
  sourceId: z
    .string()
    .describe(
      'Source ID. Must reference a metric source — get IDs from clickstack_list_sources.',
    ),
  kind: z
    .enum(QUERYABLE_METRIC_KINDS)
    .optional()
    .describe(
      'Optional metric kind filter. Omit to scan every populated kind on the source ' +
        '(gauge → sum → histogram). Set to narrow results to one kind.',
    ),
  namePattern: z
    .string()
    .optional()
    .describe(
      'Optional ClickHouse ILIKE pattern applied to MetricName server-side. ' +
        'Use % as the wildcard. Examples: "system.cpu.%", "%duration%", "http.server.%".',
    ),
  startTime: z
    .string()
    .optional()
    .describe(
      'Restrict to metrics with data points after this ISO 8601 timestamp. ' +
        'Default: 24 hours before endTime (or now).',
    ),
  endTime: z
    .string()
    .optional()
    .describe('End of the time window as ISO 8601. Default: now.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .default(DEFAULT_LIMIT)
    .describe(
      `Max metrics returned per page. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      'Opaque pagination cursor returned by a previous call as `nextCursor`. ' +
        'Pass it back unchanged to get the next page.',
    ),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

type MetricEntry = {
  name: string;
  kind: QueryableMetricKind;
  unit?: string;
  description?: string;
};

function parseTimeRange(
  startTime?: string,
  endTime?: string,
): { error: string } | { startDate: Date; endDate: Date } {
  const endDate = endTime ? new Date(endTime) : new Date();
  const startDate = startTime
    ? new Date(startTime)
    : new Date(endDate.getTime() - DEFAULT_LOOKBACK_MS);
  if (isNaN(endDate.getTime()) || isNaN(startDate.getTime())) {
    return {
      error: 'Invalid startTime or endTime: must be valid ISO 8601 strings',
    };
  }
  if (startDate >= endDate) {
    return { error: 'endTime must be greater than startTime' };
  }
  return { startDate, endDate };
}

async function fetchMetricsForKind({
  clickhouseClient,
  metadata,
  kind,
  databaseName,
  tableName,
  connectionId,
  startDate,
  endDate,
  namePattern,
  afterName,
  limit,
}: {
  clickhouseClient: ClickhouseClient;
  metadata: ReturnType<typeof getMetadata>;
  kind: QueryableMetricKind;
  databaseName: string;
  tableName: string;
  connectionId: string;
  startDate: Date;
  endDate: Date;
  namePattern: string | undefined;
  afterName: string | undefined;
  limit: number;
}): Promise<MetricEntry[]> {
  // Defensive column-presence check so we don't reference MetricUnit /
  // MetricDescription on non-OTel-default schemas.
  const columns = await metadata.getColumns({
    databaseName,
    tableName,
    connectionId,
  });
  const columnNames = new Set(columns.map(c => c.name));
  const hasUnit = columnNames.has('MetricUnit');
  const hasDescription = columnNames.has('MetricDescription');

  const projections = [
    chSql`MetricName`,
    ...(hasUnit
      ? [chSql`anyLast(${{ Identifier: 'MetricUnit' }}) AS MetricUnit`]
      : []),
    ...(hasDescription
      ? [
          chSql`anyLast(${{ Identifier: 'MetricDescription' }}) AS MetricDescription`,
        ]
      : []),
  ];

  const whereParts = [
    chSql`TimeUnix >= fromUnixTimestamp64Milli(${{ Int64: startDate.getTime() }})`,
    chSql`TimeUnix <= fromUnixTimestamp64Milli(${{ Int64: endDate.getTime() }})`,
    ...(afterName !== undefined
      ? [chSql`MetricName > ${{ String: afterName }}`]
      : []),
    ...(namePattern
      ? [chSql`MetricName ILIKE ${{ String: namePattern }}`]
      : []),
  ];

  const sql = chSql`
    SELECT ${concatChSql(', ', projections)}
    FROM ${tableExpr({ database: databaseName, table: tableName })}
    WHERE ${concatChSql(' AND ', whereParts)}
    GROUP BY MetricName
    ORDER BY MetricName ASC
    LIMIT ${{ Int32: limit }}
  `;

  type Row = {
    MetricName: string;
    MetricUnit?: string;
    MetricDescription?: string;
  };

  const response = await clickhouseClient.query<'JSON'>({
    query: sql.sql,
    query_params: sql.params,
    format: 'JSON',
    connectionId,
  });
  const result = (await response.json()) as { data: Row[] };
  return result.data.map(row => {
    const entry: MetricEntry = { name: row.MetricName, kind };
    if (row.MetricUnit) entry.unit = row.MetricUnit;
    if (row.MetricDescription) entry.description = row.MetricDescription;
    return entry;
  });
}

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerListMetrics(
  server: McpServer,
  context: McpContext,
): void {
  const { teamId } = context;

  server.registerTool(
    'clickstack_list_metrics',
    {
      title: 'List Metric Names',
      description:
        'DISCOVERY: Use this after clickstack_describe_source when you need more metric ' +
        'names than the per-kind sample shows, or when you want to narrow by ' +
        'kind / name pattern / time window. ' +
        'Returns paginated metric names per kind (gauge/sum/histogram) ' +
        'with optional unit and description (when the OTel-default columns are present). ' +
        'Pass the returned `nextCursor` back unchanged to fetch the next page.\n\n' +
        'Workflow: clickstack_list_sources → clickstack_describe_source → ' +
        'clickstack_list_metrics → clickstack_describe_metric → ' +
        'clickstack_timeseries|clickstack_table.',
      inputSchema: listMetricsSchema,
    },
    withToolTracing('clickstack_list_metrics', context, async rawInput => {
      // Re-parse explicitly: the MCP SDK callback signature widens
      // optional-field types into `unknown`, but the parser produces
      // the typed shape we need for downstream calls.
      const input: z.infer<typeof listMetricsSchema> =
        listMetricsSchema.parse(rawInput);
      const source = await getSource(teamId.toString(), input.sourceId);
      if (!source) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Source "${input.sourceId}" not found. Call clickstack_list_sources to see available source IDs.`,
            },
          ],
        };
      }
      if (source.kind !== SourceKind.Metric) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Source "${input.sourceId}" is a "${source.kind}" source, not a metric source. clickstack_list_metrics only works on metric sources — call clickstack_list_sources to find one whose kind is "metric".`,
            },
          ],
        };
      }

      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: timeRange.error }],
        };
      }
      const { startDate, endDate } = timeRange;

      // Decode cursor; reject silently and start over if malformed so a
      // truncated or tampered cursor does not surface internals.
      const cursor = input.cursor ? decodeCursor(input.cursor) : null;
      if (input.cursor && !cursor) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'Invalid cursor. Omit cursor to start over, or pass the exact `nextCursor` value returned by a previous call.',
            },
          ],
        };
      }

      // Resolve which kinds to scan, in order. When a cursor is set,
      // skip kinds before the cursor's kind (already returned) and start
      // the cursor's kind at the lastName-exclusive position.
      const requestedKinds: QueryableMetricKind[] = input.kind
        ? [input.kind]
        : QUERYABLE_METRIC_KINDS.filter(k => Boolean(source.metricTables[k]));
      const startKindIdx = cursor ? requestedKinds.indexOf(cursor.kind) : 0;
      if (startKindIdx < 0) {
        // Cursor points at a kind that's not in scope for this call —
        // safer to error than silently skip.
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Cursor references kind "${cursor!.kind}" but that kind is not in scope for this call. Drop the kind filter or pass a matching cursor.`,
            },
          ],
        };
      }

      const connection = await getConnectionById(
        teamId.toString(),
        source.connection.toString(),
        true,
      );
      if (!connection) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Connection not found for source "${input.sourceId}".`,
            },
          ],
        };
      }

      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });
      const metadata = getMetadata(clickhouseClient);

      const limit = input.limit ?? DEFAULT_LIMIT;
      const databaseName = source.from.databaseName;

      const metrics: MetricEntry[] = [];
      // Per-kind fetch failures, surfaced on the response so the agent
      // can distinguish "kind genuinely has no metrics" from "the fetch
      // for that kind failed" — the two need different recovery steps.
      const partialFailure: { kind: string; error: string }[] = [];
      let nextCursor: string | undefined;
      for (let i = startKindIdx; i < requestedKinds.length; i++) {
        const kind = requestedKinds[i];
        const tableName = source.metricTables[kind];
        if (!tableName) continue;
        const afterName =
          cursor && cursor.kind === kind && i === startKindIdx
            ? cursor.lastName
            : undefined;
        const remaining = limit - metrics.length;
        if (remaining <= 0) break;
        // Fetch one extra row so we can detect more-data-available.
        let kindMetrics: MetricEntry[];
        try {
          kindMetrics = await fetchMetricsForKind({
            clickhouseClient,
            metadata,
            kind,
            databaseName,
            tableName,
            connectionId: source.connection.toString(),
            startDate,
            endDate,
            namePattern: input.namePattern,
            afterName,
            limit: remaining + 1,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          logger.warn(
            { sourceId: input.sourceId, kind, error: message },
            'Failed to list metrics for kind',
          );
          partialFailure.push({
            kind,
            error: message.replace(/\s+/g, ' ').trim().slice(0, 200),
          });
          continue;
        }
        if (kindMetrics.length > remaining) {
          // We hit the cap for this kind; emit cursor pointing at the
          // last returned name and stop iterating further kinds.
          const truncated = kindMetrics.slice(0, remaining);
          metrics.push(...truncated);
          nextCursor = encodeCursor({
            kind,
            lastName: truncated[truncated.length - 1].name,
          });
          break;
        }
        metrics.push(...kindMetrics);
      }

      const responseObj: Record<string, unknown> = {
        metrics,
        ...(nextCursor && { nextCursor }),
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
          'Pass `metricType` + `metricName` from each entry to clickstack_timeseries / clickstack_table. ' +
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
    }),
  );
}
