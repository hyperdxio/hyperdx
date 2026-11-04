import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { trace } from '@opentelemetry/api';

import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
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
import { errorGroupExpressions } from './errorGroups';
import { fetchServiceStats, type QueryContext } from './queries';
import { buildReport, rankServices } from './report';
import {
  comparisonWindow,
  DEFAULT_WINDOW_MS,
  serviceHealthSchema,
} from './schema';
import { loadHealthSource } from './source';

const TOOL_NAME = 'clickstack_service_health';
const MAX_ERROR_SERVICES = 100;

const TIMEOUT_SUFFIX =
  'Service health aggregates every span in both windows. Retry with a ' +
  'shorter startTime/endTime window, list specific services, add a where ' +
  'filter, or set topErrorsPerService:0 to skip the error breakdown.';

const DESCRIPTION =
  'One-call health report for every service on a trace source: throughput, ' +
  'error rate, p50/p95/p99 latency and top error groups, compared with the ' +
  'same window yesterday and ranked worst first. Each service gets a status ' +
  '(critical / degraded / healthy), flags, and a one-line summary of which ' +
  'changes crossed a threshold. New or growing error groups come first, ' +
  'with first/last-seen times; operations with no prior traffic are listed ' +
  'as likely rollouts.\n\n' +
  'USE THIS FIRST for status checks, "is X healthy", post-deploy checks, and ' +
  'as the entry point for triage.\n\n' +
  'It is per service and per window. To follow up:\n' +
  '  - clickstack_timeseries by minute to see when a change happened\n' +
  '  - clickstack_table grouped by span name for per-endpoint shifts\n' +
  '  - clickstack_emerging_signals on the log source for new log patterns\n' +
  'For a flagged service, check its own runtime metrics (memory, GC, CPU, ' +
  'restarts by pod) on the metric source before blaming dependencies, then ' +
  'use clickstack_event_deltas and ' +
  'clickstack_trace_top_time_consuming_operations.\n\n' +
  'CALIBRATION: flags fire only past fixed thresholds (see `usage` in the ' +
  'response). Small swings on a healthy service are normal variance. An ' +
  'all-healthy report is a valid answer.\n\n' +
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
      annotations: READ_ONLY_TOOL,
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

        const {
          currentErrors,
          comparisonErrorCounts,
          newOperations,
          coverageNote,
        } = await collectErrors(ctx, {
          current,
          comparison,
          // Novelty can lift a service into the top N, so assess errors
          // beyond it rather than only for services already ranked there.
          shown: ranked.slice(0, MAX_ERROR_SERVICES),
          perService: input.topErrorsPerService,
          groupExprs,
          minRequests: input.minRequests,
          totalServices: ranked.length,
        });

        const report = buildReport({
          ranked,
          current,
          comparison,
          comparisonMode,
          comparisonNote,
          coverageNote,
          spanKind: input.spanKind,
          topN: input.topN,
          errorGroupBy: groupExprs,
          currentErrors,
          comparisonErrorCounts,
          newOperations,
          spanNameKey: source.spanNameExpression,
          metricSourceId: source.metricSourceId,
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
