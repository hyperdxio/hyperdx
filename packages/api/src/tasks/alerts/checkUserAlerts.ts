// --------------------------------------------------------
// -------------- EXECUTE EVERY MINUTE --------------------
// --------------------------------------------------------
import { recordException } from '@hyperdx/node-opentelemetry';
import * as fns from 'date-fns';
import { isString } from 'lodash';
import ms from 'ms';
import { z } from 'zod';

import * as clickhouse from '@/clickhouse';
import Alert, { AlertDocument, AlertState, CheckerType } from '@/models/alert';
import AlertHistory, { IAlertHistory } from '@/models/alertHistory';
import Dashboard from '@/models/dashboard';
import Team, { ITeam } from '@/models/team';
import {
  doesExceedThreshold,
  EnhancedDashboard,
  fireChannelEvent,
  getLogViewEnhanced,
  roundDownToXMinutes,
} from '@/tasks/alerts/utils';
import logger from '@/utils/logger';

export const processAlert = async (now: Date, alert: AlertDocument) => {
  try {
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
    const checkStartTime = previous
      ? previous.createdAt
      : fns.subMinutes(nowInMinsRoundDown, windowSizeInMins);
    const checkEndTime = nowInMinsRoundDown;

    // Logs Source
    let checksData:
      | Awaited<ReturnType<typeof clickhouse.checkAlert>>
      | Awaited<ReturnType<typeof clickhouse.getMultiSeriesChartLegacyFormat>>
      | null = null;
    let logView: Awaited<ReturnType<typeof getLogViewEnhanced>> | null = null;
    let targetDashboard: EnhancedDashboard | null = null;
    const team = await Team.findById(alert.team);

    if (team == null) {
      throw new Error('Team not found');
    }

    // Logs Source
    if (alert.source === 'LOG' && alert.logView) {
      logView = await getLogViewEnhanced(alert.logView);
      // TODO: use getLogsChart instead so we can deprecate checkAlert
      checksData = await clickhouse.checkAlert({
        endTime: checkEndTime,
        groupBy: alert.groupBy,
        q: logView.query,
        startTime: checkStartTime,
        tableVersion: logView.team.logStreamTableVersion,
        teamId: logView.team._id.toString(),
        windowSizeInMins,
      });
      logger.info({
        message: 'Received alert metric [LOG source]',
        alert,
        logView,
        checksData,
        checkStartTime,
        checkEndTime,
      });
    }
    // Chart Source
    else if (alert.source === 'CHART' && alert.dashboardId && alert.chartId) {
      const dashboard = await Dashboard.findOne(
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
      ).populate<{
        team: ITeam;
      }>('team');

      if (
        dashboard &&
        Array.isArray(dashboard.charts) &&
        dashboard.charts.length === 1
      ) {
        const chart = dashboard.charts[0];
        // Doesn't work for metric alerts yet
        const MAX_NUM_GROUPS = 20;
        // TODO: assuming that the chart has only 1 series for now
        const firstSeries = chart.series[0];
        if (firstSeries.type === 'time' && firstSeries.table === 'logs') {
          targetDashboard = dashboard;
          const startTimeMs = fns.getTime(checkStartTime);
          const endTimeMs = fns.getTime(checkEndTime);

          checksData = await clickhouse.getMultiSeriesChartLegacyFormat({
            series: chart.series,
            endTime: endTimeMs,
            granularity: `${windowSizeInMins} minute`,
            maxNumGroups: MAX_NUM_GROUPS,
            startTime: startTimeMs,
            tableVersion: dashboard.team.logStreamTableVersion,
            teamId: dashboard.team._id.toString(),
            seriesReturnType: chart.seriesReturnType,
          });
        } else if (
          firstSeries.type === 'time' &&
          firstSeries.table === 'metrics' &&
          firstSeries.field
        ) {
          targetDashboard = dashboard;
          const startTimeMs = fns.getTime(checkStartTime);
          const endTimeMs = fns.getTime(checkEndTime);
          checksData = await clickhouse.getMultiSeriesChartLegacyFormat({
            series: chart.series.map(series => {
              if ('field' in series && series.field != null) {
                const [metricName, rawMetricDataType] =
                  series.field.split(' - ');
                const metricDataType = z
                  .nativeEnum(clickhouse.MetricsDataType)
                  .parse(rawMetricDataType);
                return {
                  ...series,
                  metricDataType,
                  field: metricName,
                };
              }
              return series;
            }),
            endTime: endTimeMs,
            granularity: `${windowSizeInMins} minute`,
            maxNumGroups: MAX_NUM_GROUPS,
            startTime: startTimeMs,
            tableVersion: dashboard.team.logStreamTableVersion,
            teamId: dashboard.team._id.toString(),
            seriesReturnType: chart.seriesReturnType,
          });
        }
      }

      logger.info({
        message: 'Received alert metric [CHART source]',
        alert,
        checksData,
        checkStartTime,
        checkEndTime,
      });
    } else {
      logger.error({
        message: `Unsupported alert source: ${alert.source}`,
        alert,
      });
      return;
    }

    // TODO: support INSUFFICIENT_DATA state
    let alertState = AlertState.OK;
    const history = await new AlertHistory({
      alert: alert._id,
      createdAt: nowInMinsRoundDown,
      state: alertState,
    }).save();

    if (checksData?.rows && checksData?.rows > 0) {
      for (const checkData of checksData.data) {
        // TODO: we might want to fix the null value from the upstream
        // this happens when the ratio is 0/0
        if (checkData.data == null) {
          continue;
        }

        const totalCount = isString(checkData.data)
          ? parseInt(checkData.data)
          : checkData.data;
        const bucketStart = new Date(checkData.ts_bucket * 1000);
        if (
          doesExceedThreshold(
            alert.type === 'presence',
            alert.threshold,
            totalCount,
          )
        ) {
          alertState = AlertState.ALERT;
          logger.info({
            message: `Triggering ${alert.channel.type} alarm!`,
            alert,
            totalCount,
            checkData,
          });

          try {
            await fireChannelEvent({
              alert,
              attributes: checkData.attributes,
              dashboard: targetDashboard,
              endTime: fns.addMinutes(bucketStart, windowSizeInMins),
              group: Array.isArray(checkData.group)
                ? checkData.group.join(', ')
                : checkData.group,
              logView,
              startTime: bucketStart,
              totalCount,
              windowSizeInMins,
              team,
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

          history.counts += 1;
        }
        history.lastValues.push({ count: totalCount, startTime: bucketStart });
      }

      history.state = alertState;
      await history.save();
    }

    alert.state = alertState;
    await alert.save();
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
};

export default async () => {
  const now = new Date();
  const alerts = await Alert.find({
    state: { $ne: AlertState.DISABLED },
    $or: [
      { checker: { $exists: false } },
      { 'checker.type': { $ne: CheckerType.Anomaly } },
    ],
  });
  logger.info(`Going to process ${alerts.length} alerts`);
  await Promise.all(alerts.map(alert => processAlert(now, alert)));
};
