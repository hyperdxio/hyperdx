import express from 'express';
import { isNumber, parseInt } from 'lodash';
import ms from 'ms';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as clickhouse from '@/clickhouse';
import { checkTeamId } from '@/controllers/team';
import { validateUserAccessKey } from '@/middleware/auth';
import { annotateSpanOnError, Api400Error, Api403Error } from '@/utils/errors';
import rateLimiter from '@/utils/rateLimiter';
import { SimpleCache } from '@/utils/redis';

import { AlertChannelRouter } from './alertChannels';
import { SavedSearchesRouter } from './savedSearches';

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

router.use('/alert-channels', AlertChannelRouter);
router.use('/searches', SavedSearchesRouter);

router.get(
  '/logs/properties',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const { teamId, team } = await checkTeamId(req);

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
  }),
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
  annotateSpanOnError(async (req, res, next) => {
    const { teamId, team } = await checkTeamId(req);
    const { endTime, field, granularity, groupBy, q, startTime } =
      req.query as Record<string, string>;
    const { aggFn } = req.query as Record<string, clickhouse.AggFn>;
    const startTimeNum = parseInt(startTime as string);
    const endTimeNum = parseInt(endTime as string);
    if (!isNumber(startTimeNum) || !isNumber(endTimeNum)) {
      throw new Api400Error('startTime and endTime must be numbers');
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

        field,
        granularity,

        groupBy,
        maxNumGroups: MAX_NUM_GROUPS,
        propertyTypeMappingsModel,

        q,
        startTime: startTimeNum,
        tableVersion: team.logStreamTableVersion,
        teamId,
      }),
    );
  }),
);

router.get(
  '/metrics/tags',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const { teamId } = await checkTeamId(req);

    const nowInMs = Date.now();
    const simpleCache = new SimpleCache<
      Awaited<ReturnType<typeof clickhouse.getMetricsTags>>
    >(`metrics-tags-${teamId}`, ms('10m'), () =>
      clickhouse.getMetricsTags({
        // FIXME: fix it 5 days ago for now
        startTime: nowInMs - ms('5d'),
        endTime: nowInMs,
        teamId: teamId.toString(),
      }),
    );
    const tags = await simpleCache.get();
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
  }),
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
  annotateSpanOnError(async (req, res, next) => {
    const { teamId } = await checkTeamId(req);
    const { aggFn, endTime, granularity, groupBy, name, q, startTime, type } =
      req.body;

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
        q,
        startTime,
        teamId: teamId.toString(),
      }),
    );
  }),
);

export default router;
