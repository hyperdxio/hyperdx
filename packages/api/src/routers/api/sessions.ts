import type { Row } from '@clickhouse/client';
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import { isNumber, parseInt } from 'lodash';
import { serializeError } from 'serialize-error';

import * as clickhouse from '@/clickhouse';
import { getTeam } from '@/controllers/team';
import logger from '@/utils/logger';

const router = express.Router();

router.get('/', async (req, res, next) => {
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
      await clickhouse.getSessions({
        endTime: endTimeNum,
        limit: 500, // fixed limit for now
        offset: 0, // fixed offset for now
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

router.get('/:sessionId/rrweb', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { sessionId } = req.params;
    const { endTime, limit, offset, startTime } = req.query;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    const startTimeNum = parseInt(startTime as string);
    const endTimeNum = parseInt(endTime as string);
    const limitNum = parseInt(limit as string);
    const offsetNum = parseInt(offset as string);
    if (
      !isNumber(startTimeNum) ||
      !isNumber(endTimeNum) ||
      !isNumber(limitNum) ||
      !isNumber(offsetNum)
    ) {
      return res.sendStatus(400);
    }

    const MAX_LIMIT = 1e6;

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE with client

    const stream = await clickhouse.getRrwebEvents({
      sessionId: sessionId as string,
      startTime: startTimeNum,
      endTime: endTimeNum,
      limit: Math.min(MAX_LIMIT, limitNum),
      offset: offsetNum,
    });

    stream.on('data', rows => {
      res.write(`${rows.map(row => `data: ${row.text}`).join('\n')}\n\n`);
      res.flush();
    });
    stream.on('end', () => {
      logger.info('Stream ended');

      res.write('event: end\ndata:\n\n');
      res.end();
    });
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    // WARNING: no need to call next(e) here, as the stream will be closed
    logger.error({
      message: 'Error while streaming rrweb events',
      error: serializeError(e),
      teamId: req.user?.team,
      query: req.query,
    });
    res.end();
  }
});

export default router;
