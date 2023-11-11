import express from 'express';
import ms from 'ms';
import { getHours, getMinutes } from 'date-fns';

import Alert, {
  AlertChannel,
  AlertInterval,
  AlertType,
  AlertSource,
} from '../../models/alert';
import * as clickhouse from '../../clickhouse';
import { SQLSerializer } from '../../clickhouse/searchQueryParser';
import { getTeam } from '../../controllers/team';
import { isUserAuthenticated } from '../../middleware/auth';

const router = express.Router();

const getCron = (interval: AlertInterval) => {
  const now = new Date();
  const nowMins = getMinutes(now);
  const nowHours = getHours(now);

  switch (interval) {
    case '1m':
      return '* * * * *';
    case '5m':
      return '*/5 * * * *';
    case '15m':
      return '*/15 * * * *';
    case '30m':
      return '*/30 * * * *';
    case '1h':
      return `${nowMins} * * * *`;
    case '6h':
      return `${nowMins} */6 * * *`;
    case '12h':
      return `${nowMins} */12 * * *`;
    case '1d':
      return `${nowMins} ${nowHours} * * *`;
  }
};

const createAlert = async ({
  channel,
  groupBy,
  interval,
  logViewId,
  threshold,
  type,
}: {
  channel: AlertChannel;
  groupBy?: string;
  interval: AlertInterval;
  logViewId: string;
  threshold: number;
  type: AlertType;
}) => {
  return new Alert({
    channel,
    cron: getCron(interval),
    groupBy,
    interval,
    source: AlertSource.LOG,
    logView: logViewId,
    threshold,
    timezone: 'UTC', // TODO: support different timezone
    type,
  }).save();
};

// create an update alert function based off of the above create alert function
const updateAlert = async ({
  channel,
  groupBy,
  id,
  interval,
  logViewId,
  threshold,
  type,
}: {
  channel: AlertChannel;
  groupBy?: string;
  id: string;
  interval: AlertInterval;
  logViewId: string;
  threshold: number;
  type: AlertType;
}) => {
  return Alert.findByIdAndUpdate(
    id,
    {
      channel,
      cron: getCron(interval),
      groupBy: groupBy ?? null,
      interval,
      source: AlertSource.LOG,
      logView: logViewId,
      threshold,
      timezone: 'UTC', // TODO: support different timezone
      type,
    },
    {
      returnDocument: 'after',
    },
  );
};

router.post('/', isUserAuthenticated, async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { channel, groupBy, interval, logViewId, threshold, type } = req.body;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    if (!channel || !threshold || !interval || !type) {
      return res.sendStatus(400);
    }
    if (!['slack', 'email', 'pagerduty', 'webhook'].includes(channel.type)) {
      return res.sendStatus(400);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }

    // validate groupBy property
    if (groupBy) {
      const nowInMs = Date.now();
      const propertyTypeMappingsModel =
        await clickhouse.buildLogsPropertyTypeMappingsModel(
          team.logStreamTableVersion,
          teamId.toString(),
          nowInMs - ms('1d'),
          nowInMs,
        );
      const serializer = new SQLSerializer(propertyTypeMappingsModel);
      const { found } = await serializer.getColumnForField(groupBy);
      if (!found) {
        return res.sendStatus(400);
      }
    }

    res.json({
      data: await createAlert({
        channel,
        groupBy,
        interval,
        logViewId,
        threshold,
        type,
      }),
    });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', isUserAuthenticated, async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { id: alertId } = req.params;
    const { channel, interval, logViewId, threshold, type, groupBy } = req.body;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    if (!channel || !threshold || !interval || !type || !alertId) {
      return res.sendStatus(400);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }

    // validate groupBy property
    if (groupBy) {
      const nowInMs = Date.now();
      const propertyTypeMappingsModel =
        await clickhouse.buildLogsPropertyTypeMappingsModel(
          team.logStreamTableVersion,
          teamId.toString(),
          nowInMs - ms('1d'),
          nowInMs,
        );
      const serializer = new SQLSerializer(propertyTypeMappingsModel);
      const { found } = await serializer.getColumnForField(groupBy);
      if (!found) {
        return res.sendStatus(400);
      }
    }

    res.json({
      data: await updateAlert({
        channel,
        groupBy,
        id: alertId,
        interval,
        logViewId,
        threshold,
        type,
      }),
    });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', isUserAuthenticated, async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { id: alertId } = req.params;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    if (!alertId) {
      return res.sendStatus(400);
    }
    await Alert.findByIdAndDelete(alertId);
    res.sendStatus(200);
  } catch (e) {
    next(e);
  }
});

export default router;
