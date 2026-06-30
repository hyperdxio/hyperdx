import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { McpContext } from '@/mcp/tools/types';
import { withToolTracing } from '@/mcp/utils/tracing';
import logger from '@/utils/logger';
import { trimToolResponse } from '@/utils/trimToolResponse';

import { denoiseSearchResults } from './denoise';
import { buildTile, parseTimeRange, runConfigTile } from './helpers';
import {
  endTimeSchema,
  sourceIdSchema,
  startTimeSchema,
  whereLanguageSchema,
  whereSchema,
} from './schemas';

// ─── Schema ──────────────────────────────────────────────────────────────────

const searchSchema = z.object({
  sourceId: sourceIdSchema,
  where: whereSchema,
  whereLanguage: whereLanguageSchema,
  columns: z
    .string()
    .optional()
    .default('')
    .describe(
      'Comma-separated columns to include in search results. ' +
        'Leave empty for defaults. Example: "Body,ServiceName,Duration"',
    ),
  maxResults: z
    .number()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe(
      'Maximum number of rows to return (1-200). Default: 50. ' +
        'Use smaller values to reduce response size.',
    ),
  denoise: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, automatically removes events matching high-frequency patterns ' +
        '(those accounting for >10% of sampled events) from the results. ' +
        'Useful for cutting through log noise to find unusual or interesting events. ' +
        'Adds ~1-2s of latency for the pattern sampling queries.',
    ),
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerSearch(server: McpServer, context: McpContext) {
  const { teamId } = context;

  server.registerTool(
    'clickstack_search',
    {
      title: 'Search Events',
      description:
        'Browse individual log/event/trace rows. ' +
        'Use this when you need to see raw events, investigate specific log lines, ' +
        'or drill into individual records matching a filter.\n\n' +
        'Requires sourceId — call clickstack_list_sources then clickstack_describe_source first.\n\n' +
        'For aggregated metrics, use clickstack_table instead. ' +
        'For pattern discovery, use clickstack_event_patterns instead.\n\n' +
        'Set denoise=true to automatically filter out high-frequency repetitive patterns, ' +
        'surfacing only unusual or interesting events.\n\n' +
        'Column naming: top-level columns are PascalCase (Duration, StatusCode). ' +
        "Map attributes use bracket syntax: SpanAttributes['http.method'].",
      inputSchema: searchSchema,
    },
    withToolTracing('clickstack_search', context, async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: timeRange.error }],
        };
      }
      const { startDate, endDate } = timeRange;

      const tile = buildTile('MCP Search', 24, 6, {
        displayType: 'search' as const,
        sourceId: input.sourceId,
        select: input.columns,
        where: input.where,
        whereLanguage: input.whereLanguage,
      });

      const result = await runConfigTile(
        teamId.toString(),
        tile,
        startDate,
        endDate,
        {
          maxResults: input.maxResults,
        },
      );

      // ── Denoising post-processing ──
      if (!input.denoise || ('isError' in result && result.isError)) {
        return result;
      }

      // Extract the raw result data from the formatted response.
      // runConfigTile returns { content: [{ type: "text", text: JSON }] }.
      const resultText = result.content?.[0]?.text;
      if (!resultText) return result;

      let parsed: { result?: { data?: Record<string, unknown>[] } };
      try {
        parsed = JSON.parse(resultText);
      } catch {
        return result;
      }

      const resultData = parsed.result;
      const rows = (resultData as Record<string, unknown> | undefined)?.data as
        | Record<string, unknown>[]
        | undefined;
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return result;
      }

      let denoised;
      try {
        denoised = await denoiseSearchResults(
          teamId.toString(),
          input.sourceId,
          startDate,
          endDate,
          rows,
          {
            where: input.where,
            whereLanguage: input.whereLanguage,
          },
        );
      } catch (err) {
        // Denoise is a post-processing enhancement — a failure here must
        // never discard the already-successful search result.
        logger.warn(
          { err, sourceId: input.sourceId },
          'denoiseSearchResults failed; returning raw results',
        );

        const { data: trimmedResult, isTrimmed } = trimToolResponse(resultData);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  result: trimmedResult,
                  denoised: {
                    removedPatterns: [],
                    returnedRowCountBeforeDenoise: rows.length,
                    filteredRowCount: rows.length,
                    skipped: 'denoise_failed',
                  },
                  ...(isTrimmed
                    ? {
                        note: 'Result was trimmed for context size. Narrow the time range or add filters to reduce data.',
                      }
                    : {}),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Replace rows in the result with denoised rows and add metadata.
      // Always emit a `denoised` block when denoise=true so callers can
      // distinguish "no noisy patterns" from "denoise was not requested".
      const denoisedResult = {
        ...resultData,
        data: denoised.rows,
      };
      const { data: trimmedResult, isTrimmed } =
        trimToolResponse(denoisedResult);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                result: trimmedResult,
                denoised: {
                  removedPatterns: denoised.removedPatterns,
                  // rows.length is the count returned by runConfigTile
                  // (already subject to maxResults and trim limits).
                  returnedRowCountBeforeDenoise: rows.length,
                  filteredRowCount: denoised.rows.length,
                  ...(denoised.skipped ? { skipped: denoised.skipped } : {}),
                },
                ...(isTrimmed
                  ? {
                      note: 'Result was trimmed for context size. Narrow the time range or add filters to reduce data.',
                    }
                  : {}),
                ...(denoised.rows.length === 0 && !denoised.skipped
                  ? {
                      hint: 'All events matched noisy patterns and were removed. Try narrowing filters or disabling denoise to see all events.',
                    }
                  : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );
}
