import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import { isNumber, parseInt } from 'lodash';
import ms from 'ms';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as clickhouse from '@/clickhouse';
import { getTeam } from '@/controllers/team';
import { validateUserAccessKey } from '@/middleware/auth';
import { Api400Error, Api403Error } from '@/utils/errors';
import rateLimiter from '@/utils/rateLimiter';

const router = express.Router();

const rateLimiterKeyGenerator = (req: express.Request) => {
  return req.headers.authorization || req.ip;
};

const getDefaultRateLimiter = () =>
  rateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per `window`
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: rateLimiterKeyGenerator,
  });

router.get('/', validateUserAccessKey, (req, res, next) => {
  res.json({
    version: 'v1',
    user: req.user?.toJSON(),
  });
});

router.get(
  '/logs/properties',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  async (req, res, next) => {
    try {
      const teamId = req.user?.team.toString();
      if (teamId == null) {
        throw new Api403Error('Forbidden');
      }

      const team = await getTeam(teamId);
      if (team == null) {
        throw new Api403Error('Forbidden');
      }

      const nowInMs = Date.now();
      const propertyTypeMappingsModel =
        await clickhouse.buildLogsPropertyTypeMappingsModel(
          team.logStreamTableVersion,
          teamId,
          nowInMs - ms('1d'),
          nowInMs,
        );

      const data = [...propertyTypeMappingsModel.currentPropertyTypeMappings];
      res.json({
        data,
        rows: data.length,
      });
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

router.get(
  '/logs/chart',
  getDefaultRateLimiter(),
  validateRequest({
    query: z.object({
      aggFn: z.nativeEnum(clickhouse.AggFn),
      endTime: z.string(),
      field: z.string().optional(),
      granularity: z.nativeEnum(clickhouse.Granularity).optional(),
      groupBy: z.string().optional(),
      q: z.string().optional(),
      startTime: z.string(),
    }),
  }),
  validateUserAccessKey,
  async (req, res, next) => {
    try {
      const teamId = req.user?.team.toString();
      const { aggFn, endTime, field, granularity, groupBy, q, startTime } =
        req.query;
      if (teamId == null) {
        throw new Api403Error('Forbidden');
      }
      const startTimeNum = parseInt(startTime);
      const endTimeNum = parseInt(endTime);
      if (!isNumber(startTimeNum) || !isNumber(endTimeNum)) {
        throw new Api400Error('startTime and endTime must be numbers');
      }

      const team = await getTeam(teamId);
      if (team == null) {
        throw new Api403Error('Forbidden');
      }

      const propertyTypeMappingsModel =
        await clickhouse.buildLogsPropertyTypeMappingsModel(
          team.logStreamTableVersion,
          teamId,
          startTimeNum,
          endTimeNum,
        );

      // TODO: expose this to the frontend ?
      const MAX_NUM_GROUPS = 20;

      res.json(
        await clickhouse.getLogsChart({
          aggFn,
          endTime: endTimeNum,
          // @ts-expect-error
          field,
          granularity,
          // @ts-expect-error
          groupBy,
          maxNumGroups: MAX_NUM_GROUPS,
          propertyTypeMappingsModel,
          // @ts-expect-error
          q,
          startTime: startTimeNum,
          tableVersion: team.logStreamTableVersion,
          teamId,
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

router.get(
  '/metrics/tags',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        throw new Api403Error('Forbidden');
      }
      const tags = await clickhouse.getMetricsTags(teamId.toString());
      res.json({
        data: tags.data.map(tag => ({
          // FIXME: unify the return type of both internal and external APIs
          name: tag.name.split(' - ')[0], // FIXME: we want to separate name and data type into two columns
          type: tag.data_type,
          tags: tag.tags,
        })),
        meta: tags.meta,
        rows: tags.rows,
      });
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

router.post(
  '/metrics/chart',
  getDefaultRateLimiter(),
  validateRequest({
    body: z.object({
      aggFn: z.nativeEnum(clickhouse.AggFn),
      endTime: z.number().int().min(0),
      granularity: z.nativeEnum(clickhouse.Granularity),
      groupBy: z.string().optional(),
      name: z.string().min(1),
      type: z.nativeEnum(clickhouse.MetricsDataType),
      q: z.string().optional(),
      startTime: z.number().int().min(0),
    }),
  }),
  validateUserAccessKey,
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { aggFn, endTime, granularity, groupBy, name, q, startTime, type } =
        req.body;

      if (teamId == null) {
        throw new Api403Error('Forbidden');
      }

      if (startTime > endTime) {
        throw new Api400Error('startTime must be less than endTime');
      }

      res.json(
        await clickhouse.getMetricsChart({
          aggFn,
          dataType: type,
          endTime,
          granularity,
          groupBy,
          name,
          // @ts-expect-error
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
