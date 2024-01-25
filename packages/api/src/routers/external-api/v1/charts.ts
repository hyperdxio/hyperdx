import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as clickhouse from '@/clickhouse';
import { getTeam } from '@/controllers/team';
import { translateExternalSeriesToInternalSeries } from '@/utils/externalApi';
import { externalQueryChartSeriesSchema } from '@/utils/zod';

const router = express.Router();

router.post(
  '/series',
  validateRequest({
    body: z.object({
      series: z.array(externalQueryChartSeriesSchema).refine(
        series => {
          const groupByFields = series[0].groupBy;
          return series.every(s => _.isEqual(s.groupBy, groupByFields));
        },
        {
          message: 'All series must have the same groupBy fields',
        },
      ),
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

      const internalSeries = series.map(s =>
        translateExternalSeriesToInternalSeries({
          type: 'time', // just to reuse the same fn
          ...s,
        }),
      );

      if (teamId == null) {
        return res.sendStatus(403);
      }

      const team = await getTeam(teamId);
      if (team == null) {
        return res.sendStatus(403);
      }

      const MAX_NUM_GROUPS = 20;

      const chResponse = await clickhouse.getMultiSeriesChart({
        series: internalSeries,
        endTime: endTime,
        granularity,
        maxNumGroups: MAX_NUM_GROUPS,
        startTime: startTime,
        tableVersion: team.logStreamTableVersion,
        teamId: teamId.toString(),
        seriesReturnType,
      });

      res.json({
        data: chResponse.data.map(d => {
          // @ts-ignore
          const { rank, rank_order_by_value, ts_bucket, ...rowData } = d;
          return {
            ...rowData,
            ts_bucket: ts_bucket * 1000,
          };
        }),
      });
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

export default router;
