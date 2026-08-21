import {
  AssistantLineTableConfigSchema,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { APICallError, generateText, Output } from 'ai';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  getAIMetadata,
  getAIModel,
  getChartConfigFromResolvedConfig,
} from '@/controllers/ai';
import { getSource } from '@/controllers/sources';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { Api404Error, Api500Error } from '@/utils/errors';
import { withOperationMetrics } from '@/utils/instrumentation';
import logger from '@/utils/logger';
import rateLimiter from '@/utils/rateLimiter';
import { redactSecrets } from '@/utils/redactSecrets';
import { objectIdSchema } from '@/utils/zod';

import {
  buildSystemPrompt,
  SUMMARIZE_MAX_OUTPUT_TOKENS,
  SUMMARIZE_MAX_RESPONSE_CHARS,
  SUMMARIZE_PROVIDER_TIMEOUT_MS,
  SUMMARIZE_RATE_LIMIT_MAX,
  SUMMARIZE_RATE_LIMIT_WINDOW_MS,
  summarizeBodySchema,
  wrapInDataTags,
} from './aiSummarize';

const router = express.Router();

router.post(
  '/assistant',
  validateRequest({
    body: z.object({
      text: z.string().min(1).max(10000),
      sourceId: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const model = getAIModel();

      const { teamId } = getNonNullUserWithTeam(req);

      const { text, sourceId } = req.body;

      const source = await getSource(teamId.toString(), sourceId);

      if (source == null) {
        logger.error({ message: 'invalid source id', sourceId, teamId });
        throw new Api404Error('Invalid source');
      }

      const { allFieldsWithKeys, keyValues } = await getAIMetadata(source);

      const prompt = `You are an AI assistant that helps users create chart configurations for an observability platform called HyperDX.

The user wants to create a chart based on the following description:
${text}

Generate a visualization or search that matches their request. The chart should query logs, metrics, or traces from a ClickHouse database.

Here are some guidelines:
- Use appropriate display types: 'line' for time series, 'table' for tabular data
- Use appropriate aggregate functions depending on user's request: 'count', 'sum', 'avg', 'min', 'max', 'count_distinct'
- If the user is requesting for a specific set of data (ex. "frontend service", filter the condition by the appropriate property based on the below properties ex. \`ServiceName = 'frontend'\`)
- Pick an appropriate time range based on the user's request if one can be inferred from the request.

The user is looking to do a query on their data source named: ${source.name} of type ${source.kind}.

${
  source.kind === SourceKind.Log
    ? `The log level is stored in ${source.severityTextExpression}.`
    : source.kind === SourceKind.Trace
      ? `The span status code is stored in ${source.statusCodeExpression}.`
      : ''
}
${'serviceNameExpression' in source ? `You can identify services via ${source.serviceNameExpression}` : ''}
${
  source.kind === SourceKind.Trace
    ? `Duration of spans can be queried via ${source.durationExpression} which is expressed in 10^-${source.durationPrecision} seconds of precision.
Span names under ${source.spanNameExpression} and span kinds under ${source.spanKindExpression}`
    : 'bodyExpression' in source
      ? `The log body can be queried via ${source.bodyExpression}`
      : ''
}
${
  source.kind === SourceKind.Trace || source.kind === SourceKind.Log
    ? `Various log/span-specific attributes as a Map can be found under ${source.eventAttributesExpression} while resource attributes that follow the OpenTelemetry semantic convention can be found under ${source.resourceAttributesExpression}
You must use the full field name ex. "column['key']" or "column.key" as it appears.`
    : ''
}

The following is a list of properties and example values that exist in the source:
${JSON.stringify(keyValues)}

There may be additional properties that you can use as well:
${JSON.stringify(allFieldsWithKeys.slice(0, 200).map(f => ({ field: f.key, type: f.type })))}
`;

      logger.info(prompt);

      // The AI generation call is the externally-dependent, latency-defining
      // part of the assistant, so it carries the SLO signal. Source lookup /
      // validation above are client-side concerns and intentionally excluded.
      const chartConfig = await withOperationMetrics(
        'ai.assistant',
        async () => {
          try {
            const result = await generateText({
              model,
              output: Output.object({
                schema: AssistantLineTableConfigSchema,
              }),
              experimental_telemetry: { isEnabled: true },
              prompt,
            });

            return getChartConfigFromResolvedConfig(result.output, source);
          } catch (err) {
            if (err instanceof APICallError) {
              throw new Api500Error(
                `AI Provider Error. Status: ${err.statusCode}. Message: ${err.message}`,
              );
            }
            throw err;
          }
        },
        { source_kind: source.kind },
      );

      return res.json(chartConfig);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/summarize
//
// Generate a natural-language summary of a log, trace, or pattern using the
// configured LLM. Prompts are registered per-kind in ./aiSummarize.ts.
//
// User content is redacted of obvious secrets and wrapped in <data>...</data>
// tags so the model can separate data from instructions. Rate-limited per
// authenticated user (falls back to authorization header / IP for callers
// without an attached user, e.g. tests). Rate-limit / output-cap / timeout
// constants live alongside the schema in ./aiSummarize.ts.
// ---------------------------------------------------------------------------

const summarizeRateLimiter = rateLimiter({
  windowMs: SUMMARIZE_RATE_LIMIT_WINDOW_MS,
  max: SUMMARIZE_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Validation failures and provider errors should not consume the per-user
  // budget. Without this, a buggy client (or any caller spamming `{}` bodies)
  // could lock a legitimate user out for the rest of the window without ever
  // invoking the model.
  skipFailedRequests: true,
  // The /ai router is mounted behind isUserAuthenticated, so req.user is set
  // in production and the user-id branch is the only one taken. The header /
  // IP fallback exists for the test harness and as defense-in-depth if the
  // mount ever changes.
  keyGenerator: req => {
    const userId = req.user?._id?.toString();
    if (userId) return `user:${userId}`;
    return req.headers.authorization ?? req.ip ?? 'unknown';
  },
});

router.post(
  '/summarize',
  summarizeRateLimiter,
  validateRequest({ body: summarizeBodySchema }),
  async (req, res, next) => {
    try {
      const model = getAIModel();
      const { kind, content, tone } = req.body;

      const systemPrompt = buildSystemPrompt(kind, tone);
      const wrappedPrompt = wrapInDataTags(redactSecrets(content));

      try {
        const result = await generateText({
          model,
          system: systemPrompt,
          experimental_telemetry: { isEnabled: true },
          maxOutputTokens: SUMMARIZE_MAX_OUTPUT_TOKENS,
          prompt: wrappedPrompt,
          // Bound the wall-clock so a slow/stuck provider does not pin
          // concurrent connections per replica indefinitely.
          abortSignal: AbortSignal.timeout(SUMMARIZE_PROVIDER_TIMEOUT_MS),
        });

        // Defense-in-depth: maxOutputTokens is provider-honored only. Cap
        // the rendered response so a misbehaving model cannot forward an
        // arbitrarily long body to the client.
        const summary = result.text.slice(0, SUMMARIZE_MAX_RESPONSE_CHARS);
        return res.json({ summary });
      } catch (err) {
        if (err instanceof APICallError) {
          logger.error({
            message: 'AI provider error during summarize',
            statusCode: err.statusCode,
            providerMessage: err.message,
          });
          // Return a generic message to the client; the provider's raw
          // statusCode/message (vendor IDs, internal request IDs, content
          // policy classifications, occasionally echoed prompt fragments)
          // stays in the structured log above.
          throw new Api500Error('AI Provider Error');
        }
        throw err;
      }
    } catch (e) {
      next(e);
    }
  },
);

export default router;
