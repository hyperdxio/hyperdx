import express from 'express';
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import { isNumber, parseInt } from 'lodash';

import * as clickhouse from '@/clickhouse';
import { isUserAuthenticated } from '@/middleware/auth';

const router = express.Router();

router.get('/tags', isUserAuthenticated, async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    // TODO: use cache
    res.json(await clickhouse.getMetricsTags(teamId.toString()));
  } catch (e) {
    const span = opentelemetry.trace.getActiveSpan();
    span?.recordException(e as Error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
    next(e);
  }
});

router.post('/chart', isUserAuthenticated, async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { aggFn, endTime, granularity, groupBy, name, q, startTime } =
      req.body;

    if (teamId == null) {
      return res.sendStatus(403);
    }
    const startTimeNum = parseInt(startTime as string);
    const endTimeNum = parseInt(endTime as string);
    if (!isNumber(startTimeNum) || !isNumber(endTimeNum) || !name) {
      return res.sendStatus(400);
    }

    // FIXME: separate name + dataType
    const [metricName, metricDataType] = (name as string).split(' - ');
    if (metricName == null || metricDataType == null) {
      return res.sendStatus(400);
    }

    res.json(
      await clickhouse.getMetricsChart({
        aggFn: aggFn as clickhouse.AggFn,
        dataType: metricDataType,
        endTime: endTimeNum,
        granularity,
        groupBy: groupBy as string,
        name: metricName,
        q: q as string,
        startTime: startTimeNum,
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

export default router;
