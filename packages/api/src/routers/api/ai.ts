import {
  AssistantLineTableConfigSchema,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { APICallError, generateObject } from 'ai';
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
import { Api500Error } from '@/utils/errors';
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
      const model = await getAIModel();
      if (!model) {
        return res.status(500).json({
          error: 'No AI model provider configured',
        });
      }
      const { teamId } = getNonNullUserWithTeam(req);

      const { text, sourceId } = req.body;

      const source = await getSource(teamId.toString(), sourceId);

      if (source == null) {
        logger.error({ message: 'invalid source id', sourceId, teamId });
        return res.status(400).json({
          error: 'Invalid source',
        });
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

The ${source.kind === SourceKind.Log ? 'log level' : 'span status code'} is stored in ${source.severityTextExpression}.
You can identify services via ${source.serviceNameExpression}
${
  source.kind === SourceKind.Trace
    ? `Duration of spans can be queried via ${source.durationExpression} which is expressed in 10^-${source.durationPrecision} seconds of precision.
Span names under ${source.spanNameExpression} and span kinds under ${source.spanKindExpression}`
    : `The log body can be queried via ${source.bodyExpression}`
}
Various log/span-specific attributes as a Map can be found under ${source.eventAttributesExpression} while resource attributes that follow the OpenTelemetry semantic convention can be found under ${source.resourceAttributesExpression}
You must use the full field name ex. "column['key']" or "column.key" as it appears.

The following is a list of properties and example values that exist in the source:
${JSON.stringify(keyValues)}

There may be additional properties that you can use as well:
${JSON.stringify(allFieldsWithKeys.slice(0, 200).map(f => ({ field: f.key, type: f.type })))}
`;

      logger.info(prompt);

      try {
        const result = await generateObject({
          model,
          schema: AssistantLineTableConfigSchema,
          experimental_telemetry: { isEnabled: true },
          prompt,
        });

        const chartConfig = getChartConfigFromResolvedConfig(
          result.object,
          source,
        );

        return res.json(chartConfig);
      } catch (err) {
        console.log(err);
        if (err instanceof APICallError) {
          throw new Api500Error(`AI Provider Error: ${err.message}`);
        }
        throw err;
      }
    } catch (e) {
      next(e);
    }
  },
);

export default router;
