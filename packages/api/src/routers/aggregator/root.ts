import express from 'express';
import groupBy from 'lodash/groupBy';

import * as config from '../../config';
import logger from '../../utils/logger';
import {
  bulkInsertRrwebEvents,
  bulkInsertTeamLogStream,
  bulkInsertTeamMetricStream,
} from '../../clickhouse';
import {
  extractApiKey,
  vectorLogParser,
  vectorMetricParser,
  vectorRrwebParser,
} from '../../utils/logParser';
import { getTeamByApiKey } from '../../controllers/team';

import type { VectorLog, VectorMetric } from '../../utils/logParser';

const router = express.Router();

const bulkInsert = async (
  hdxTelemetry: string | undefined,
  apiKey: string,
  data: (VectorLog | VectorMetric)[],
) => {
  const team = await getTeamByApiKey(apiKey);
  if (team) {
    switch (hdxTelemetry) {
      case 'metric':
        await bulkInsertTeamMetricStream(
          vectorMetricParser.parse(data as VectorMetric[]),
        );
        break;
      default: {
        const rrwebEvents = [];
        const logs = [];
        for (const log of data) {
          if (log.hdx_platform === 'rrweb') {
            rrwebEvents.push(log);
          } else {
            logs.push(log);
          }
        }
        const promises = [
          bulkInsertTeamLogStream(
            team.logStreamTableVersion,
            team._id.toString(),
            vectorLogParser.parse(logs as VectorLog[]),
          ),
        ];
        if (rrwebEvents.length > 0) {
          promises.push(
            bulkInsertRrwebEvents(
              vectorRrwebParser.parse(rrwebEvents as VectorLog[]),
            ),
          );
        }
        await Promise.all(promises);
        break;
      }
    }
  }
};

router.get('/health', (_, res) => {
  res.send({ data: 'OK', version: config.CODE_VERSION });
});

// bulk insert logs
router.post('/', async (req, res, next) => {
  const { telemetry } = req.query;
  const hdxTelemetry = (telemetry ?? 'log') as string;
  try {
    const logs: (VectorLog | VectorMetric)[] = req.body;
    if (!Array.isArray(logs)) {
      return res.sendStatus(400);
    }
    // TODO: move this to the end of the request so vector will buffer the logs
    // Need to check request.timeout_secs config
    res.sendStatus(200);

    logger.info({
      message: `Received ${hdxTelemetry}`,
      size: JSON.stringify(logs).length,
      n: logs.length,
    });

    const filteredLogs = logs
      .map(log => ({
        ...log,
        hdx_apiKey: extractApiKey(log),
      }))
      // check hdx_platform values ?
      .filter(log => log.hdx_platform && log.hdx_apiKey);

    if (logs.length - filteredLogs.length > 0) {
      // TEMP: DEBUGGING (remove later)
      const droppedLogs = logs
        .map(log => ({
          ...log,
          hdx_apiKey: extractApiKey(log),
        }))
        .filter(log => !log.hdx_platform || !log.hdx_apiKey);
      logger.info({
        message: `Dropped ${hdxTelemetry}`,
        n: filteredLogs.length,
        diff: logs.length - filteredLogs.length,
        droppedLogs,
      });
    }

    if (filteredLogs.length > 0) {
      const groupedLogs = groupBy(filteredLogs, 'hdx_apiKey');
      await Promise.all(
        Object.entries(groupedLogs).map(([apiKey, logs]) =>
          bulkInsert(hdxTelemetry, apiKey, logs),
        ),
      );
    }
  } catch (e) {
    next(e);
  }
});

export default router;
