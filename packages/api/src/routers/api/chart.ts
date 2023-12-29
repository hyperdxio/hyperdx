import type { Row } from '@clickhouse/client';
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import { isNumber, omit, parseInt } from 'lodash';
import ms from 'ms';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as clickhouse from '@/clickhouse';
import { customColumnMapType } from '@/clickhouse/searchQueryParser';
import { getTeam } from '@/controllers/team';
import logger from '@/utils/logger';
import { getLogsPatterns } from '@/utils/miner';
import { LimitedSizeQueue } from '@/utils/queue';
import { chartSeriesSchema } from '@/utils/zod';

const router = express.Router();

router.post(
  '/series',
  validateRequest({
    query: z.object({
      endTime: z.string(),
      granularity: z.nativeEnum(clickhouse.Granularity).optional(),
      startTime: z.string(),
      seriesReturnType: z.optional(z.nativeEnum(clickhouse.SeriesReturnType)),
    }),
    body: z.object({
      series: z.array(chartSeriesSchema),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { endTime, granularity, startTime, seriesReturnType } = req.query;
      const { series } = req.body;

      if (teamId == null) {
        return res.sendStatus(403);
      }
      const startTimeNum = parseInt(startTime);
      const endTimeNum = parseInt(endTime);
      if (!isNumber(startTimeNum) || !isNumber(endTimeNum)) {
        return res.sendStatus(400);
      }

      const team = await getTeam(teamId);
      if (team == null) {
        return res.sendStatus(403);
      }

      const propertyTypeMappingsModel =
        await clickhouse.buildLogsPropertyTypeMappingsModel(
          team.logStreamTableVersion,
          teamId.toString(),
          startTimeNum,
          endTimeNum,
        );

      const propertySet = new Set<string>();
      series.map(s => {
        if ('field' in s && s.field != null) {
          propertySet.add(s.field);
        }
        if ('groupBy' in s && s.groupBy.length > 0) {
          s.groupBy.map(g => propertySet.add(g));
        }
      });

      // Hack to refresh property cache if needed
      const properties = Array.from(propertySet);

      if (
        properties.some(p => {
          return !clickhouse.doesLogsPropertyExist(
            p,
            propertyTypeMappingsModel,
          );
        })
      ) {
        logger.warn({
          message: `getChart: Property type mappings cache is out of date (${properties.join(
            ', ',
          )})`,
        });
        await propertyTypeMappingsModel.refresh();
      }

      // TODO: expose this to the frontend
      const MAX_NUM_GROUPS = 20;

      res.json(
        await clickhouse.getMultiSeriesChart({
          series,
          endTime: endTimeNum,
          granularity,
          maxNumGroups: MAX_NUM_GROUPS,
          propertyTypeMappingsModel,
          startTime: startTimeNum,
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
