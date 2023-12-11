import express from 'express';
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import { validateRequest } from 'zod-express-middleware';
import { z } from 'zod';

import * as clickhouse from '@/clickhouse';

const router = express.Router();

router.get('/tags', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    res.json(await clickhouse.getMetricsTags(teamId.toString()));
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    next(e);
  }
});

router.post(
  '/chart',
  validateRequest({
    body: z.object({
      aggFn: z.nativeEnum(clickhouse.AggFn),
      endTime: z.number().int().min(0),
      granularity: z.nativeEnum(clickhouse.Granularity),
      groupBy: z.string().optional(),
      name: z.string().min(1),
      type: z.nativeEnum(clickhouse.MetricsDataType),
      q: z.string(),
      startTime: z.number().int().min(0),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { aggFn, endTime, granularity, groupBy, name, q, startTime, type } =
        req.body;

      if (teamId == null) {
        return res.sendStatus(403);
      }

      res.json(
        await clickhouse.getMetricsChart({
          aggFn,
          dataType: type,
          endTime,
          granularity,
          groupBy,
          name,
          q,
          startTime,
          teamId: teamId.toString(),
        }),
      );
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

export default router;
