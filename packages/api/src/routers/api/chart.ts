import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import { isNumber } from 'lodash';
import ms from 'ms';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as clickhouse from '@/clickhouse';
import { buildSearchColumnName } from '@/clickhouse/searchQueryParser';
import { getTeam } from '@/controllers/team';
import { SimpleCache } from '@/utils/redis';
import { chartSeriesSchema } from '@/utils/zod';

const router = express.Router();

router.get('/services', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }

    const FIELDS = ['k8s.namespace.name', 'k8s.pod.name', 'k8s.pod.uid'];
    const nowInMs = Date.now();
    const startTime = nowInMs - ms('5d');
    const endTime = nowInMs;

    const propertyTypeMappingsModel =
      await clickhouse.buildLogsPropertyTypeMappingsModel(
        team.logStreamTableVersion,
        teamId.toString(),
        startTime,
        endTime,
      );

    const targetGroupByFields: string[] = ['service'];
    // make sure all custom fields exist
    for (const f of FIELDS) {
      if (buildSearchColumnName(propertyTypeMappingsModel.get(f), f)) {
        targetGroupByFields.push(f);
      }
    }

    const MAX_NUM_GROUPS = 2000;

    const simpleCache = new SimpleCache<
      Awaited<ReturnType<typeof clickhouse.getMultiSeriesChart>>
    >(`chart-services-${teamId}`, ms('10m'), () =>
      clickhouse.getMultiSeriesChart({
        series: [
          {
            aggFn: clickhouse.AggFn.Count,
            groupBy: targetGroupByFields,
            table: 'logs',
            type: 'table',
            where: '',
          },
        ],
        endTime,
        granularity: undefined,
        maxNumGroups: MAX_NUM_GROUPS,
        startTime,
        tableVersion: team.logStreamTableVersion,
        teamId: teamId.toString(),
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      }),
    );

    const results = await simpleCache.get();
    // restructure service maps
    const serviceMap: Record<string, Record<string, string>[]> = {};
    for (const row of results.data) {
      const values = row.group;
      const service = values[0];
      if (!(service in serviceMap)) {
        serviceMap[service] = [];
      }
      const k8sAttrs: Record<string, string> = {};
      for (let i = 1; i < values.length; i++) {
        const field = targetGroupByFields[i];
        const value = values[i];
        k8sAttrs[field] = value;
      }

      // check if k8sAttrs are not empty
      if (Object.keys(k8sAttrs).length > 0) {
        serviceMap[service].push(k8sAttrs);
      }
    }

    res.json({
      data: serviceMap,
    });
  } catch (e) {
    next(e);
  }
});

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
