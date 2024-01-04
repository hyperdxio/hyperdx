import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import { isNumber, parseInt } from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as clickhouse from '@/clickhouse';
import { getTeam } from '@/controllers/team';
import logger from '@/utils/logger';
import { chartSeriesSchema } from '@/utils/zod';

const router = express.Router();

router.post(
  '/series',
  validateRequest({
    body: z.object({
      series: z.array(chartSeriesSchema),
      endTime: z.number(),
      granularity: z.nativeEnum(clickhouse.Granularity).optional(),
      startTime: z.number(),
      seriesReturnType: z.optional(z.nativeEnum(clickhouse.SeriesReturnType)),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { endTime, granularity, startTime, seriesReturnType, series } =
        req.body;

      if (teamId == null) {
        return res.sendStatus(403);
      }
      if (!isNumber(startTime) || !isNumber(endTime)) {
        return res.sendStatus(400);
      }

      const team = await getTeam(teamId);
      if (team == null) {
        return res.sendStatus(403);
      }

      // TODO: expose this to the frontend
      const MAX_NUM_GROUPS = 20;

      res.json(
        await clickhouse.getMultiSeriesChart({
          series,
          endTime: endTime,
          granularity,
          maxNumGroups: MAX_NUM_GROUPS,
          startTime: startTime,
          tableVersion: team.logStreamTableVersion,
          teamId: teamId.toString(),
          seriesReturnType,
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
