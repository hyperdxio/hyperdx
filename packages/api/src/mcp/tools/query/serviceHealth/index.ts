import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { trace } from '@opentelemetry/api';

import { PREFER_BUILDER_OVER_SQL_NUDGE } from '@/mcp/tools/query/builderCatalog';
import {
  clickHouseErrorResult,
  isQueryOutOfTime,
  parseTimeRange,
} from '@/mcp/tools/query/helpers';
import { getMcpClickhouseClient } from '@/mcp/tools/trace/shared';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';
import { trimToolResponse } from '@/utils/trimToolResponse';

import { collectErrors } from './collect';
import { resolveComparison } from './comparison';
import {
  errorGroupExpressions,
  fetchServiceStats,
  type QueryContext,
} from './queries';
import { buildReport, rankServices } from './report';
import {
  comparisonWindow,
  DEFAULT_WINDOW_MS,
  serviceHealthSchema,
} from './schema';
import { loadHealthSource } from './source';

const TOOL_NAME = 'clickstack_service_health';

const TIMEOUT_SUFFIX =
  'Service health aggregates every span in both windows. Retry with a ' +
  'shorter startTime/endTime window, list specific services, add a where ' +
  'filter, or set topErrorsPerService:0 to skip the error breakdown.';

const DESCRIPTION =
  'One-call health report for every service on a trace source: throughput, ' +
  'error rate, p50/p95/p99 latency and top error groups, each compared with ' +
  'the same window yesterday (configurable), ranked worst first with a ' +
  'status (critical / degraded / healthy) and the flags that explain it. ' +
  'Error groups that are new or growing versus the comparison are listed ' +
  'first.\n\n' +
  'USE THIS FIRST for status checks, "how are my services doing", "is X ' +
  'healthy", post-deploy checks, and as the entry point for triage. It ' +
  'replaces several clickstack_table / clickstack_timeseries calls.\n\n' +
  'sourceId is the "id" of a kind="trace" source from ' +
  'clickstack_list_sources (a 24-character hex string), not its name or ' +
  'table.\n\n' +
  'This report is per service and per window, so it cannot show WHEN ' +
  'something happened inside the window, or per-endpoint shifts. For a ' +
  'status report, follow up with:\n' +
  '  - clickstack_timeseries (error count and p99 by minute) to place a ' +
  'new error group or latency change in time: a one-minute burst that ' +
  'recovered is not an ongoing problem\n' +
  '  - clickstack_table grouped by span name to spot new or shifting ' +
  'endpoints\n' +
  '  - clickstack_emerging_signals on the related log source for new log ' +
  'patterns, which span data does not show\n' +
  'For triage of a flagged service, check its own runtime metrics first ' +
  '(memory, GC, CPU, restarts: clickstack_list_metrics then ' +
  'clickstack_timeseries on the metric source, grouped by pod or instance). ' +
  'Slow or failing spans are often a symptom of the service itself, not ' +
  'its dependencies. Then use clickstack_event_deltas to find what ' +
  'separates its failing or slow spans, and ' +
  'clickstack_trace_top_time_consuming_operations for slow downstream ' +
  'calls.\n\n' +
  'Requires serviceName and statusCode expressions on the source (see ' +
  'clickstack_describe_source). Counts server spans by default.\n\n' +
  'CALIBRATION: flags only fire past fixed thresholds (see `usage` in the ' +
  'response). A healthy service with small swings is steady, not a ' +
  'regression and needs no action. An all-healthy report is a ' +
  'valid answer.\n\n' +
  PREFER_BUILDER_OVER_SQL_NUDGE;

export function registerServiceHealth({
  context,
  registerTool,
}: ToolRegistrar) {
  const teamId = context.teamId.toString();

  registerTool(
    TOOL_NAME,
    {
      title: 'Service Health',
      annotations: { readOnlyHint: true },
      description: DESCRIPTION,
      inputSchema: serviceHealthSchema,
    },
    async input => {
      const range = parseTimeRange(
        input.startTime,
        input.endTime,
        DEFAULT_WINDOW_MS,
      );
      if ('error' in range) return mcpUserError(range.error);
      const current = { start: range.startDate, end: range.endDate };
      const requested = comparisonWindow(current, input.comparison);
      if (requested && requested.end > current.start) {
        return mcpUserError(
          `The window is longer than the "${input.comparison}" shift, so the ` +
            'two windows overlap. Shorten the window or use ' +
            'comparison:"previous_period".',
        );
      }

      const source = await loadHealthSource(teamId, input.sourceId, TOOL_NAME);
      if ('isError' in source) return source;
      const client = await getMcpClickhouseClient(teamId, source.connection);
      if (!client) {
        return mcpUserError(
          `Connection not found for source: ${input.sourceId}`,
        );
      }
      const groupExprs = errorGroupExpressions(
        source,
        input.errorGroupBy,
        splitAndTrimWithBracket,
      );

      const abort = new AbortController();
      const ctx: QueryContext = {
        client,
        metadata: getMetadata(client),
        source,
        input,
        signal: abort.signal,
      };

      try {
        const [cur, requestedCmp] = await Promise.all([
          fetchServiceStats(ctx, current),
          requested ? fetchServiceStats(ctx, requested) : null,
        ]);
        const { comparison, cmp, comparisonMode, comparisonNote } =
          await resolveComparison(ctx, {
            current,
            requested,
            requestedMode: input.comparison,
            curHasData: cur.stats.size > 0,
            requestedCmp,
          });
        const ranked = rankServices(
          cur.stats,
          cmp?.stats ?? null,
          input.minRequests,
        );

        const { currentErrors, comparisonErrorCounts, newOperations } =
          await collectErrors(ctx, {
            current,
            comparison,
            shown: ranked.slice(0, input.topN),
            perService: input.topErrorsPerService,
            groupExprs,
          });

        const report = buildReport({
          ranked,
          current,
          comparison,
          comparisonMode,
          comparisonNote,
          spanKind: input.spanKind,
          topN: input.topN,
          errorGroupBy: groupExprs,
          currentErrors,
          comparisonErrorCounts,
          newOperations,
          spanNameKey: source.spanNameExpression,
          metricSourceId: source.metricSourceId,
          mvUsed: cur.mvUsed || !!cmp?.mvUsed,
        });

        trace.getActiveSpan()?.setAttributes({
          'hyperdx.source.id': source.id,
          'mcp.service_health.comparison': input.comparison,
          'mcp.service_health.comparison_used': comparisonMode,
          'mcp.service_health.span_kind': input.spanKind,
          'mcp.service_health.window_ms':
            current.end.getTime() - current.start.getTime(),
          'mcp.service_health.services_assessed': ranked.length,
          'mcp.service_health.critical_count':
            report.summary.statusCounts.critical,
          'mcp.service_health.degraded_count':
            report.summary.statusCounts.degraded,
          'mcp.service_health.mv_used': report.summary.materializedViewUsed,
        });

        const { data, isTrimmed } = trimToolResponse(report);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                isTrimmed
                  ? {
                      ...data,
                      note: 'Trimmed for context size. Lower topN or topErrorsPerService.',
                    }
                  : data,
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        abort.abort();
        return clickHouseErrorResult(e, {
          prefix: 'Failed to compute service health',
          suffix: isQueryOutOfTime(e) ? TIMEOUT_SUFFIX : undefined,
        });
      }
    },
  );
}
