import type { Row } from '@clickhouse/client';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse';
import { getMetadata } from '@hyperdx/common-utils/dist/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import { isNumber, parseInt } from 'lodash';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as clickhouse from '@/clickhouse';
import { getConnectionById } from '@/controllers/connection';
import { getTeam } from '@/controllers/team';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { Source } from '@/models/source';
import logger from '@/utils/logger';
import { objectIdSchema } from '@/utils/zod';

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

router.get(
  '/:sessionId/rrweb',
  validateRequest({
    params: z.object({
      sessionId: z.string(),
    }),
    query: z.object({
      sourceId: objectIdSchema,
      startTime: z.string(),
      endTime: z.string(),
      limit: z.string(),
      offset: z.string(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const { endTime, sourceId, limit, offset, startTime } = req.query;

      const { teamId } = getNonNullUserWithTeam(req);

      const source = await Source.findById(sourceId);

      if (!source) {
        res.status(404).send('Source not found');
        return;
      }

      const connection = await getConnectionById(
        teamId.toString(),
        source.connection.toString(),
        true,
      );

      if (!connection) {
        res.status(404).send('Connection not found');
        return;
      }

      const MAX_LIMIT = 1e6;

      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders(); // flush the headers to establish SSE with client

      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });

      const metadata = getMetadata(clickhouseClient);
      const query = await renderChartConfig(
        {
          // FIXME: add mappings to session source
          select: [
            {
              valueExpression: `${source.implicitColumnExpression}`,
              alias: 'b',
            },
            {
              valueExpression: `JSONExtractRaw(${source.implicitColumnExpression}, CAST('type', 'String'))`,
              alias: 't',
            },
            {
              valueExpression: `${source.eventAttributesExpression}['rr-web.chunk']`,
              alias: 'ck',
            },
            {
              valueExpression: `${source.eventAttributesExpression}['rr-web.total-chunks']`,
              alias: 'tcks',
            },
          ],
          // dateRange: [new Date(startTime), new Date(endTime)],
          from: source.from,
          whereLanguage: 'lucene',
          where: `${source.resourceAttributesExpression}.rum.sessionId:"${sessionId}"`,
          timestampValueExpression: source.timestampValueExpression,
          implicitColumnExpression: source.implicitColumnExpression,
          connection: connection.id,
          orderBy: `${source.timestampValueExpression}, ck ASC`,
          limit: {
            limit: Math.min(MAX_LIMIT, parseInt(limit)),
            offset: parseInt(offset),
          },
        },
        metadata,
      );

      const resultSet = await clickhouseClient.query({
        query: query.sql,
        query_params: query.params,
        format: 'JSONEachRow',
        clickhouse_settings: {
          wait_end_of_query: 0,
          send_progress_in_http_headers: 0,
        },
      });
      const stream = resultSet.stream();

      stream.on('data', (rows: Row[]) => {
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
  },
);

export default router;
