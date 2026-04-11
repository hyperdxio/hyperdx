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
import logger from '@/utils/logger';
import { objectIdSchema } from '@/utils/zod';

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

      try {
        const result = await generateText({
          model,
          output: Output.object({
            schema: AssistantLineTableConfigSchema,
          }),
          experimental_telemetry: { isEnabled: true },
          prompt,
        });

        const chartConfig = getChartConfigFromResolvedConfig(
          result.output,
          source,
        );

        return res.json(chartConfig);
      } catch (err) {
        if (err instanceof APICallError) {
          throw new Api500Error(
            `AI Provider Error. Status: ${err.statusCode}. Message: ${err.message}`,
          );
        }
        throw err;
      }
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /ai/summarize — generate a natural-language summary of a log, trace, or
// pattern using the configured LLM.
// ---------------------------------------------------------------------------

const summarizeBodySchema = z.object({
  type: z.enum(['event', 'pattern']),
  content: z.string().min(1).max(50000),
});

router.post(
  '/summarize',
  validateRequest({ body: summarizeBodySchema }),
  async (req, res, next) => {
    try {
      const model = getAIModel();
      const { type, content } = req.body;

      const systemPrompt =
        type === 'pattern'
          ? `You are an expert observability engineer. The user will provide a log/trace pattern (a templatized message with occurrence count and sample events). Write a concise, actionable summary (2-4 sentences) that explains:
1. What the pattern represents (the operation or behaviour).
2. Whether it looks healthy, degraded, or erroneous.
3. A concrete next step the operator could take.

Be direct and technical. Do not use bullet points. Do not repeat the raw pattern verbatim — paraphrase.`
          : `You are an expert observability engineer. The user will provide a single log or trace event (including body, attributes, severity, timing, etc.). Write a concise, actionable summary (2-4 sentences) that explains:
1. What happened in this event.
2. Whether it looks healthy or problematic (and why).
3. A concrete next step the operator could take if there is an issue.

Be direct and technical. Do not use bullet points. Do not repeat the raw event verbatim — paraphrase.`;

      try {
        const result = await generateText({
          model,
          system: systemPrompt,
          experimental_telemetry: { isEnabled: true },
          prompt: content,
        });

        return res.json({ summary: result.text });
      } catch (err) {
        if (err instanceof APICallError) {
          throw new Api500Error(
            `AI Provider Error. Status: ${err.statusCode}. Message: ${err.message}`,
          );
        }
        throw err;
      }
    } catch (e) {
      next(e);
    }
  },
);

export default router;
