import { serializeError } from 'serialize-error';

import { AggFn } from '@/clickhouse';
import Alert, {
  AlertChannel,
  AnomalyModel,
  CheckerType,
  SystemAlertName,
} from '@/models/alert';
import Team from '@/models/team';
import logger from '@/utils/logger';

type SystemAlertConfig = {
  name: SystemAlertName;
  where: string;
  message: string;
  models: AnomalyModel[];
  interval: string;
};

const SYSTEM_ALERT_CONFIGS: SystemAlertConfig[] = [
  {
    name: SystemAlertName.ANOMALOUS_ERRORS,
    where: 'level:"error" span.kind:"server"',
    message: [
      `Alert for ${SystemAlertName.ANOMALOUS_ERRORS}`,
      'Observed {{value}} requests with errors returned in the past {{granularity}}(s).',
    ].join('\n\n'),
    models: [
      {
        name: 'zscore',
        enabled: true,
        params: {
          threshold: 10,
        },
      },
    ],
    interval: '5m',
  },
  {
    name: SystemAlertName.ANOMALOUS_REQUESTS,
    where: 'level:"ok" span.kind:"server"',
    message: [
      `Alert for ${SystemAlertName.ANOMALOUS_REQUESTS}`,
      'Observed {{value}} requests returned in the past {{granularity}}(s).',
    ].join('\n\n'),
    models: [
      {
        name: 'zscore',
        enabled: true,
        params: {
          threshold: 10,
        },
      },
    ],
    interval: '5m',
  },
  {
    name: SystemAlertName.ANOMALOUS_ERROR_EVENTS,
    where: 'level:error',
    message: [
      `Alert for ${SystemAlertName.ANOMALOUS_ERROR_EVENTS}`,
      'Observed {{value}} error logs returned in the past {{granularity}}(s).',
    ].join('\n\n'),
    models: [
      {
        name: 'zscore',
        enabled: true,
        params: {
          threshold: 10,
        },
      },
    ],
    interval: '5m',
  },
];

async function createAlertIfMissing(
  teamId: string,
  channel: AlertChannel,
  config: SystemAlertConfig,
): Promise<void> {
  const { name, where, message, models, interval } = config;
  try {
    await Alert.create({
      team: teamId,
      isSystem: true,
      name: name,
      interval: interval,
      threshold: 1,
      type: 'presence',
      cron: '* * * * *',
      timezone: 'UTC',
      source: 'CUSTOM',
      channel: channel,
      checker: {
        type: CheckerType.Anomaly,
        config: {
          mode: 'any',
          models: models,
        },
      },
      customConfig: {
        series: [
          {
            table: 'logs',
            type: 'table',
            where: where,
            aggFn: AggFn.Count,
            groupBy: [],
          },
        ],
      },
      historyWindow: 1440,
      message: message,
    });
  } catch (e) {
    logger.error({
      message: 'error creating system alert',
      teamId,
      config,
      error: serializeError(e),
    });
  }
}

export default async () => {
  const teams = await Team.find({});
  logger.info(`Checking system alerts for ${teams.length} teams`);
  const promises: Promise<void>[] = [];

  for (const team of teams) {
    logger.info(`Processing team ${team.id}`);
    const teamId = team.id;

    for (const systemAlertConfig of SYSTEM_ALERT_CONFIGS) {
      const existingAlert = await Alert.findOne(
        {
          team: teamId,
          isSystem: true,
          source: 'CUSTOM',
          name: systemAlertConfig.name,
        },
        {},
      );

      if (!existingAlert) {
        logger.info(
          `Team ${teamId} is missing ${systemAlertConfig.name}, creating one`,
        );

        const defaultChannel: AlertChannel = {
          type: 'webhook',
          webhookId: 'YOUR_WEBHOOK_ID',
        };

        const alertPromise = createAlertIfMissing(
          teamId,
          defaultChannel,
          systemAlertConfig,
        );

        promises.push(alertPromise);
      }
    }
    await Promise.all(promises);
  }
};
