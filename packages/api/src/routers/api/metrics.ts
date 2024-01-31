import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import ms from 'ms';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as clickhouse from '@/clickhouse';
import { SimpleCache } from '@/utils/redis';

const router = express.Router();

router.get('/names', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const nowInMs = Date.now();
    const simpleCache = new SimpleCache<
      Awaited<ReturnType<typeof clickhouse.getMetricsNames>>
    >(
      `metrics-names-${teamId}`,
      ms('10m'),
      () =>
        clickhouse.getMetricsNames({
          // FIXME: fix it 5 days ago for now
          startTime: nowInMs - ms('5d'),
          endTime: nowInMs,
          teamId: teamId.toString(),
        }),
      result => {
        if (result.rows != null) {
          return result.rows > 0;
        }
        return false;
      },
    );
    res.json(await simpleCache.get());
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    next(e);
  }
});

router.get(
  '/tags',
  validateRequest({
    query: z.object({
      name: z.string().min(1).max(1024),
      dataType: z.nativeEnum(clickhouse.MetricsDataType),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      const { name, dataType } = req.query;
      const nowInMs = Date.now();
      const simpleCache = new SimpleCache<
        Awaited<ReturnType<typeof clickhouse.getMetricsTags>>
      >(
        `metrics-tags-${teamId}`,
        ms('10m'),
        () =>
          clickhouse.getMetricsTags({
            dataType,
            name,
            // FIXME: fix it 5 days ago for now
            startTime: nowInMs - ms('5d'),
            endTime: nowInMs,
            teamId: teamId.toString(),
          }),
        result => {
          if (result.rows != null) {
            return result.rows > 0;
          }
          return false;
        },
      );
      res.json(await simpleCache.get());
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

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
