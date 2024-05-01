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

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { endTime, offset, q, startTime, order, limit } = req.query;
    let { extraFields } = req.query;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    if (extraFields == null) {
      extraFields = [];
    }

    if (
      !Array.isArray(extraFields) ||
      (extraFields?.length > 0 && typeof extraFields[0] != 'string')
    ) {
      return res.sendStatus(400);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }

    const MAX_LIMIT = 4000;

    res.json(
      await clickhouse.getLogBatch({
        extraFields: extraFields as string[],
        endTime: parseInt(endTime as string),
        limit: Number.isInteger(Number.parseInt(`${limit}`))
          ? Math.min(MAX_LIMIT, Number.parseInt(`${limit}`))
          : 100,
        offset: parseInt(offset as string),
        q: q as string,
        order: order === 'null' ? null : order === 'asc' ? 'asc' : 'desc',
        startTime: parseInt(startTime as string),
        tableVersion: team.logStreamTableVersion,
        teamId: teamId.toString(),
      }),
    );
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });

    next(e);
  }
});

router.get('/patterns', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { endTime, q, startTime, sampleRate } = req.query;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    if (!endTime || !startTime) {
      return res.sendStatus(400);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }

    const MAX_LOG_BODY_LENGTH = 512;
    const MAX_LOG_GROUPS = 1e4;
    const MAX_SAMPLES = 50;
    const TOTAL_TRENDS_BUCKETS = 15;
    const SAMPLE_RATE = sampleRate ? parseFloat(sampleRate as string) : 1; // TODO: compute this dynamically
    const scaleSampleCounts = (count: number) =>
      Math.round(count / SAMPLE_RATE);

    const msRange = parseInt(endTime as string) - parseInt(startTime as string);
    const interval = clickhouse.msRangeToHistogramInterval(
      msRange,
      TOTAL_TRENDS_BUCKETS,
    );

    const logs = await clickhouse.getLogBatchGroupedByBody({
      bodyMaxLength: MAX_LOG_BODY_LENGTH,
      endTime: parseInt(endTime as string),
      interval,
      limit: MAX_LOG_GROUPS,
      q: q as string,
      sampleRate: SAMPLE_RATE,
      startTime: parseInt(startTime as string),
      tableVersion: team.logStreamTableVersion,
      teamId: teamId.toString(),
    });

    if (logs.data.length === 0) {
      return res.json({ data: [] });
    }

    // use the 1st id as the representative id
    const lines = logs.data.map(log => [log.ids[0], log.body]);
    // TODO: separate patterns by service
    const logsPatternsData = await getLogsPatterns(teamId.toString(), lines);
    type Sample = {
      id: string;
      body: string;
      timestamp: string;
      sort_key: string;
    };
    const result: Record<
      string,
      {
        count: number;
        level: string;
        patternId: string;
        samples: LimitedSizeQueue<Sample>;
        service: string;
        trends: Record<string, number>;
      }
    > = {};
    for (const log of logs.data) {
      const patternId = logsPatternsData.result[log.ids[0]];
      if (patternId) {
        const pattern = logsPatternsData.patterns[patternId];
        if (!(pattern in result)) {
          result[pattern] = {
            count: 0,
            level: log.level,
            patternId,
            samples: new LimitedSizeQueue<Sample>(MAX_SAMPLES),
            service: log.service, // FIXME: multiple services might share the same pattern
            trends: {},
          };
        }

        for (const [idx, timestamp] of log.timestamps.entries()) {
          result[pattern].samples.enqueue({
            body: log.body,
            id: log.ids[idx],
            sort_key: log.sort_keys[idx],
            timestamp,
          });

          // compute trends
          const bucket = log.buckets[idx];
          if (!(bucket in result[pattern].trends)) {
            result[pattern].trends[bucket] = 0;
          }
          result[pattern].trends[bucket] += scaleSampleCounts(1);
        }
        result[pattern].count += scaleSampleCounts(parseInt(log.lines_count));
      }
    }

    res.json({
      data: Object.entries(result)
        .map(([pattern, meta]) => ({
          count: meta.count,
          level: meta.level,
          pattern,
          id: meta.patternId,
          samples: meta.samples
            .toArray()
            .sort(
              (a, b) =>
                new Date(b.timestamp).getTime() -
                new Date(a.timestamp).getTime(),
            ),
          service: meta.service,
          trends: {
            granularity: interval,
            data: Object.entries(meta.trends)
              .map(([bucket, count]) => ({
                bucket,
                count,
              }))
              .sort(
                (a, b) =>
                  new Date(a.bucket).getTime() - new Date(b.bucket).getTime(),
              ),
          },
        }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });

    next(e);
  }
});

router.get('/stream', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { endTime, offset, q, startTime, order, limit } = req.query;
    let { extraFields } = req.query;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    if (extraFields == null) {
      extraFields = [];
    }

    if (
      !Array.isArray(extraFields) ||
      (extraFields?.length > 0 && typeof extraFields[0] != 'string')
    ) {
      return res.sendStatus(400);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }

    const MAX_LIMIT = 4000;

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE with client

    // TODO: verify query
    const stream = await clickhouse.getLogStream({
      extraFields: extraFields as string[],
      endTime: parseInt(endTime as string),
      limit: Number.isInteger(Number.parseInt(`${limit}`))
        ? Math.min(MAX_LIMIT, Number.parseInt(`${limit}`))
        : 100,
      offset: parseInt(offset as string),
      order: order === 'null' ? null : order === 'asc' ? 'asc' : 'desc',
      q: q as string,
      startTime: parseInt(startTime as string),
      tableVersion: team.logStreamTableVersion,
      teamId: teamId.toString(),
    });

    let resultCount = 0;

    if (stream == null) {
      logger.info('No results found for query');

      res.write('event: end\ndata:\n\n');
      res.end();
    } else {
      stream.on('data', (rows: Row[]) => {
        resultCount += rows.length;
        logger.info(`Sending ${rows.length} rows`);

        res.write(`${rows.map(row => `data: ${row.text}`).join('\n')}\n\n`);
        res.flush();
      });
      stream.on('end', () => {
        res.write('event: end\ndata:\n\n');
        res.end();
      });
    }
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    // WARNING: no need to call next(e) here, as the stream will be closed
    logger.error({
      message: 'Error streaming logs',
      error: serializeError(e),
      teamId: req.user?.team,
      query: req.query,
    });
    res.end();
  }
});

router.get('/propertyTypeMappings', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }

    const nowInMs = Date.now();
    const propertyTypeMappingsModel =
      await clickhouse.buildLogsPropertyTypeMappingsModel(
        team.logStreamTableVersion,
        teamId.toString(),
        nowInMs - ms('1d'),
        nowInMs,
      );

    res.json({
      data: [
        ...propertyTypeMappingsModel.currentPropertyTypeMappings,
        ...Object.entries(omit(customColumnMapType, ['<implicit>'])),
      ],
    });
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    next(e);
  }
});

router.get('/chart/histogram', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { endTime, field, q, startTime } = req.query;
    if (teamId == null || typeof field !== 'string' || field == '') {
      return res.sendStatus(403);
    }
    const startTimeNum = parseInt(startTime as string);
    const endTimeNum = parseInt(endTime as string);
    if (!isNumber(startTimeNum) || !isNumber(endTimeNum)) {
      return res.sendStatus(400);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }

    res.json(
      await clickhouse.getChartHistogram({
        bins: 20,
        endTime: endTimeNum,
        field: field as string,
        q: q as string,
        startTime: startTimeNum,
        tableVersion: team.logStreamTableVersion,
        teamId: teamId.toString(),
      }),
    );
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    next(e);
  }
});

// This endpoint needs to be generalized replaced once use-case matures
router.post(
  '/chart/spanPerformance',
  validateRequest({
    body: z.object({
      parentSpanWhere: z.string().max(1024),
      childrenSpanWhere: z.string().max(1024),
      endTime: z.number(),
      startTime: z.number(),
      maxGroups: z.optional(z.number().min(1).max(20)),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const {
        endTime,
        startTime,
        parentSpanWhere,
        childrenSpanWhere,
        maxGroups,
      } = req.body;

      if (teamId == null) {
        return res.sendStatus(403);
      }

      const team = await getTeam(teamId);
      if (team == null) {
        return res.sendStatus(403);
      }

      const propertyTypeMappingsModel =
        await clickhouse.buildLogsPropertyTypeMappingsModel(
          team.logStreamTableVersion,
          teamId.toString(),
          startTime,
          endTime,
        );

      res.json(
        await clickhouse.getSpanPerformanceChart({
          endTime: endTime,
          maxNumGroups: maxGroups ?? 20,
          startTime: startTime,
          tableVersion: team.logStreamTableVersion,
          teamId: teamId.toString(),
          parentSpanWhere,
          childrenSpanWhere,
          propertyTypeMappingsModel,
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
  '/chart',
  validateRequest({
    query: z.object({
      aggFn: z.nativeEnum(clickhouse.AggFn),
      endTime: z.string(),
      field: z.string().optional(),
      granularity: z.nativeEnum(clickhouse.Granularity).optional(),
      groupBy: z.string().optional(),
      q: z.string().optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
      startTime: z.string(),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const {
        aggFn,
        endTime,
        field,
        granularity,
        groupBy,
        q,
        startTime,
        sortOrder,
      } = req.query;
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

      // TODO: hacky way to make sure the cache is update to date
      if (
        !clickhouse.doesLogsPropertyExist(field, propertyTypeMappingsModel) ||
        !clickhouse.doesLogsPropertyExist(groupBy, propertyTypeMappingsModel)
      ) {
        logger.warn({
          message: `getChart: Property type mappings cache is out of date (${field}, ${groupBy}})`,
        });
        await propertyTypeMappingsModel.refresh();
      }

      // TODO: expose this to the frontend
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
          sortOrder,
          startTime: startTimeNum,
          tableVersion: team.logStreamTableVersion,
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

router.get('/histogram', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { endTime, q, startTime } = req.query;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    const startTimeNum = parseInt(startTime as string);
    const endTimeNum = parseInt(endTime as string);
    if (!isNumber(startTimeNum) || !isNumber(endTimeNum)) {
      return res.sendStatus(400);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }

    res.json(
      await clickhouse.getHistogram(
        team.logStreamTableVersion,
        teamId.toString(),
        q as string,
        startTimeNum,
        endTimeNum,
      ),
    );
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });

    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const logId = req.params.id;
    const { sortKey } = req.query;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    if (!sortKey) {
      return res.sendStatus(400);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }

    res.json(
      await clickhouse.getLogById(
        team.logStreamTableVersion,
        teamId.toString(),
        sortKey as string,
        logId,
      ),
    );
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });

    next(e);
  }
});

export default router;
