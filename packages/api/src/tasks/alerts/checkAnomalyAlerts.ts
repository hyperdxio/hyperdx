// --------------------------------------------------------
// -------------- EXECUTE EVERY MINUTE --------------------
// --------------------------------------------------------
import { recordException } from '@hyperdx/node-opentelemetry';
import * as fns from 'date-fns';
import ms from 'ms';

import * as clickhouse from '@/clickhouse';
import Alert, { AlertDocument, AlertState, CheckerType } from '@/models/alert';
import AlertHistory, { IAlertHistory } from '@/models/alertHistory';
import type { Chart } from '@/models/dashboard';
import Dashboard from '@/models/dashboard';
import Team from '@/models/team';
import { fireChannelEvent, roundDownToXMinutes } from '@/tasks/alerts/utils';
import logger from '@/utils/logger';
import { detectAnomaly } from '@/utils/miner';

const AVAILABILITY_THRESHOLD = 0.5;
const COUNT_THRESHOLD = 10;

export const processAlert = async (now: Date, alert: AlertDocument) => {
  try {
    if (alert.source !== 'CUSTOM' && alert.source !== 'CHART') {
      throw new Error(`Unsupported alert source: ${alert.source}`);
    }

    if (alert.checker?.type !== CheckerType.Anomaly) {
      throw new Error(`Unsupported checker type: ${alert.checker?.type}`);
    }

    if (!alert.customConfig && alert.source === 'CUSTOM') {
      throw new Error(
        'Custom query config is required for custom alerts and is missing',
      );
    }

    if (!alert.historyWindow) {
      throw new Error(
        'History window is required for anomaly alerts and is missing',
      );
    }

    // remove these checks once we support multiple series
    if (
      alert.customConfig &&
      alert.source === 'CUSTOM' &&
      alert.customConfig.series.length != 1
    ) {
      throw new Error(
        'Custom alerts currently only support single series custom queries',
      );
    }

    const previous: IAlertHistory | undefined = (
      await AlertHistory.find({ alert: alert._id })
        .sort({ createdAt: -1 })
        .limit(1)
    )[0];

    const windowSizeInMins = ms(alert.interval) / 60000;

    const nowInMinsRoundDown = roundDownToXMinutes(windowSizeInMins)(now);
    if (
      previous &&
      fns.getTime(previous.createdAt) === fns.getTime(nowInMinsRoundDown)
    ) {
      logger.info({
        message: `Skipped to check alert since the time diff is still less than 1 window size`,
        windowSizeInMins,
        nowInMinsRoundDown,
        previous,
        now,
        alert,
      });
      return;
    }

    let series: Chart['series'] = [];
    let dashboard;

    if (alert.source === 'CUSTOM' && alert.customConfig) {
      series = alert.customConfig.series;
    } else if (alert.source === 'CHART' && alert.dashboardId && alert.chartId) {
      dashboard = await Dashboard.findOne(
        {
          _id: alert.dashboardId,
          'charts.id': alert.chartId,
        },
        {
          name: 1,
          charts: {
            $elemMatch: {
              id: alert.chartId,
            },
          },
        },
      );

      if (
        dashboard &&
        Array.isArray(dashboard.charts) &&
        dashboard.charts.length === 1
      ) {
        const chart = dashboard.charts[0];
        series = chart.series;
      } else {
        throw new Error(
          `Chart with id ${alert.chartId} not found in dashboard with id ${alert.dashboardId}`,
        );
      }
    } else {
      throw new Error(
        `Invalid alert source type for anomaly alert: ${alert.source}`,
      );
    }

    // remove this check once we support multiple series
    // this should cover both missing and multiple series for both CUSTOM and CHART sources
    if (series.length != 1) {
      throw new Error(
        `Anomaly Alerts currently only support single series for both CUSTOM and CHART sources but got ${series.length} series`,
      );
    }

    const startTime = fns.subMinutes(nowInMinsRoundDown, alert.historyWindow);
    const endTime = nowInMinsRoundDown;

    const team = await Team.findById(alert.team);

    if (team == null) {
      throw new Error('Team not found');
    }

    const startTimeMs = fns.getTime(startTime);
    const endTimeMs = fns.getTime(endTime);

    const alertData = (
      await clickhouse.getMultiSeriesChart({
        series: series,
        teamId: alert.team.toString(),
        startTime: startTimeMs,
        endTime: endTimeMs,
        tableVersion: team?.logStreamTableVersion,
        granularity: `${windowSizeInMins} minute`,
        maxNumGroups: 123456789, // arbitrarily large number
        seriesReturnType: clickhouse.SeriesReturnType.Column,
      })
    ).data;

    if (!alertData || alertData.length === 0) {
      logger.info({
        message: 'No data found for alert',
        alert,
        startTime,
        endTime,
      });
      return;
    }

    const currentWindowData = alertData[alertData.length - 1];
    const totalCount = currentWindowData['series_0.data'];
    const bucketStart = new Date(currentWindowData['ts_bucket'] * 1000);

    let alertState = AlertState.OK;
    const history = await new AlertHistory({
      alert: alert._id,
      createdAt: nowInMinsRoundDown,
      counts: totalCount,
      state: alertState,
    }).save();

    const formattedAlertData = alertData.map(row => {
      return {
        ts_bucket: row.ts_bucket,
        count: row['series_0.data'], // only single series support for anom currently
      };
    });

    const dataAvailability =
      alertData.filter(row => row['series_0.data'] > 0).length /
      alertData.length;

    const isLowDataAvailability = dataAvailability < AVAILABILITY_THRESHOLD;
    const isLowCurrentWindowCount = totalCount < COUNT_THRESHOLD;

    if (isLowDataAvailability) {
      logger.info({
        message: 'Skipping alert due to low data availability',
        dataAvailability,
        alert,
        alertData,
        currentWindowData,
      });
    }

    if (isLowCurrentWindowCount) {
      logger.info({
        message: 'Skipping alert due to low current window count',
        totalCount,
        alert,
        alertData,
        currentWindowData,
      });
    }

    if (!isLowDataAvailability && !isLowCurrentWindowCount) {
      const detectAnomalyResult = await detectAnomaly(
        formattedAlertData,
        formattedAlertData[formattedAlertData.length - 1],
        undefined,
        alert?.checker?.config,
      );

      logger.info({
        message: 'Anomaly detection results',
        alert,
        detectAnomalyResult,
      });

      if (detectAnomalyResult.is_anomalous) {
        alertState = AlertState.ALERT;
        logger.info({
          message: `Triggering ${alert.channel.type} alarm!`,
          alert,
          totalCount,
          detectAnomalyResult,
        });

        try {
          await fireChannelEvent({
            alert,
            attributes: {},
            endTime: fns.addMinutes(bucketStart, windowSizeInMins),
            startTime: bucketStart,
            totalCount,
            windowSizeInMins,
            team,
            logView: null,
            dashboard: dashboard,
            group: undefined, // TODO: add group support for anomaly alerts
          });
        } catch (e) {
          void recordException(e, {
            mechanism: {
              handled: false,
            },
            attributes: {
              'hyperdx.alert.id': alert.id,
            },
          });
        }
      }
    }

    history.lastValues.push({
      count: totalCount,
      startTime: bucketStart,
    });

    history.state = alertState;
    await history.save();

    alert.state = alertState;
    await alert.save();
  } catch (e) {
    // Uncomment this for better error messages locally
    // console.error(e);
    void recordException(e, {
      mechanism: {
        handled: false,
      },
      attributes: {
        'hyperdx.alert.id': alert.id,
      },
    });
  }
};

export default async () => {
  logger.info('Checking anomaly alerts');

  const now = new Date();

  const alerts = await Alert.find({
    state: { $ne: AlertState.DISABLED },
    'checker.type': CheckerType.Anomaly,
  });

  logger.info(`Going to process ${alerts.length} anomaly alerts`);
  await Promise.all(alerts.map(alert => processAlert(now, alert)));
};
